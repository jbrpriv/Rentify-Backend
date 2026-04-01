const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Agreement = require('../models/Agreement');
const Payment = require('../models/Payment');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');
const { generateReceiptPDFBuffer } = require('../utils/pdfGenerator');
const { uploadReceiptPDF, isS3Configured, getReceiptPDFUrl } = require('../utils/s3Service');

/**
 * paymentController.js — Rent Payments & Stripe Integration
 *
 * Handles:
 *   - Initial deposit + first month checkout (createCheckoutSession)
 *   - Monthly rent checkout (createRentCheckoutSession, getActiveCheckoutUrl)
 *   - Stripe webhook processing (handleStripeWebhook)
 *   - Payment history and rent schedule queries
 *   - Receipt PDF generation and download
 *   - Automatic payment retry via BullMQ queue
 *
 * Only Stripe is supported. PayPal and Razorpay integrations were removed.
 * Gateway: GET /api/payments/gateways always returns Stripe only.
 */

// @desc    List available payment gateways
// @route   GET /api/payments/gateways
// @access  Private
const getAvailableGateways = (_req, res) => {
  res.json({
    gateways: [{ id: 'stripe', name: 'Stripe', enabled: !!process.env.STRIPE_SECRET_KEY }],
  });
};


// @desc    Download or stream a payment receipt PDF
// @route   GET /api/payments/:paymentId/receipt
// @access  Private — tenant (own payments), landlord (their properties), admin
const downloadReceipt = async (req, res) => {
  try {
    const currency = (req.query.currency || req.headers['x-currency'] || 'USD').toString().toUpperCase();

    const payment = await Payment.findById(req.params.paymentId)
      .populate('tenant', 'name email')
      .populate('landlord', 'name email')
      .populate('property', 'title address')
      .populate('agreement');

    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    // ── Access control ──────────────────────────────────────────────────────
    const uid = req.user._id.toString();
    const isTenant = payment.tenant?._id.toString() === uid;
    const isLandlord = payment.landlord?._id.toString() === uid;
    const isAdmin = req.user.role === 'admin';

    if (!isTenant && !isLandlord && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to access this receipt' });
    }

    // ── If we have an S3 key, return a signed URL ────────────────────────────
    if (currency === 'USD' && payment.receiptUrl && isS3Configured()) {
      try {
        const signedUrl = await getReceiptPDFUrl(payment.receiptUrl);
        return res.json({ url: signedUrl });
      } catch (s3Err) {
        logger.warn('S3 signed URL failed, falling back to on-demand generation', { err: s3Err.message });
        // Fall through to on-demand generation
      }
    }

    // ── On-demand generation (receiptUrl missing or signed URL failed) ───────
    const tenant = payment.tenant;
    const property = payment.property;

    if (!tenant || !property) {
      return res.status(422).json({ message: 'Receipt cannot be generated — missing tenant or property data' });
    }

    const pdfBuffer = await generateReceiptPDFBuffer(payment, tenant, property, { currency });

    // If S3 is configured, upload now, backfill receiptUrl, and return a signed URL.
    // This handles the common case where the webhook's fire-and-forget upload silently
    // failed, leaving receiptUrl null on the Payment document.
    if (isS3Configured()) {
      try {
        const key = await uploadReceiptPDF(pdfBuffer, payment._id.toString());
        await Payment.findByIdAndUpdate(payment._id, { receiptUrl: key });
        const signedUrl = await getReceiptPDFUrl(key);
        return res.json({ url: signedUrl });
      } catch (s3Err) {
        logger.warn('On-demand S3 upload failed, falling back to inline stream', { err: s3Err.message });
      }
    }

    // True last-resort fallback: stream binary PDF (S3 completely unavailable)
    const filename = `receipt-${payment.receiptNumber || payment._id}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });
    return res.send(pdfBuffer);

  } catch (error) {
    logger.error('Receipt download failed', { err: error.message });
    res.status(500).json({ message: error.message });
  }
};
// ─── Shared rent-schedule builder ────────────────────────────────────────────
// Reused by Stripe webhook and the schedule seed path.
function buildRentSchedule(agreement, firstMonthPaidIntent = null) {
  const schedule = [];
  const startDate = new Date(agreement.term.startDate);
  const duration = agreement.term.durationMonths || 12;

  const isEscalationEnabled = agreement.rentEscalation?.enabled;
  const escalationPct = agreement.rentEscalation?.percentage || 0;
  const baseRent = agreement.financials.rentAmount;

  for (let i = 0; i < duration; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(startDate.getMonth() + i);

    let currentAmount = baseRent;
    if (isEscalationEnabled && escalationPct > 0) {
      const yearsPassed = Math.floor(i / 12);
      for (let y = 0; y < yearsPassed; y++) {
        currentAmount = Math.round(currentAmount * (1 + escalationPct / 100));
      }
    }

    schedule.push({
      dueDate,
      amount: currentAmount,
      status: i === 0 ? 'paid' : 'pending',
      paidDate: i === 0 ? new Date() : null,
      paidAmount: i === 0 ? currentAmount : null,
      lateFeeApplied: false,
      lateFeeAmount: 0,
      stripePaymentIntent: i === 0 ? firstMonthPaidIntent : null,
    });
  }

  return schedule;
}


// @desc    Create Stripe Checkout Session for Deposit + 1st Month Rent
// @route   POST /api/payments/create-checkout-session
// @access  Private (Tenant)
const createCheckoutSession = async (req, res) => {
  try {
    const { agreementId } = req.body;
    const agreement = await Agreement.findById(agreementId)
      .populate('property', 'title')
      .populate('tenant', 'name email')
      .populate('landlord', 'name');

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found' });
    }

    if (agreement.tenant._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to pay for this agreement' });
    }

    if (agreement.isPaid) {
      return res.status(400).json({ message: 'Initial payment has already been made' });
    }

    if (agreement.status !== 'signed') {
      return res.status(400).json({ message: 'Agreement must be fully signed before payment' });
    }

    const rentAmount = agreement.financials.rentAmount || 0;
    const depositAmount = agreement.financials.depositAmount || 0;
    const petDeposit = agreement.petPolicy?.allowed ? (agreement.petPolicy?.deposit || 0) : 0;
    const totalAmount = rentAmount + depositAmount + petDeposit;
    const totalAmountCents = Math.round(totalAmount * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: process.env.STRIPE_CURRENCY || 'usd',
            product_data: {
              name: petDeposit > 0 ? 'Security Deposit + Pet Deposit + 1st Month Rent' : 'Security Deposit + 1st Month Rent',
              description: `Property: ${agreement.property.title}`,
            },
            unit_amount: totalAmountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/dashboard/my-lease?success=true`,
      cancel_url: `${process.env.CLIENT_URL}/dashboard/my-lease?canceled=true`,
      metadata: { agreementId: agreement._id.toString() },
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Handle Stripe Webhooks
// @route   POST /api/payments/webhook
const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ─── Initial deposit + 1st month rent ─────────────────────────────────────
  if (
    event.type === 'checkout.session.completed' &&
    event.data.object?.metadata?.paymentType !== 'monthly_rent'
  ) {
    const session = event.data.object;
    const { agreementId } = session.metadata;

    const agreement = await Agreement.findById(agreementId)
      .populate('tenant', 'name email phoneNumber smsOptIn')
      .populate('landlord', 'name email')
      .populate('property', 'title address');

    if (!agreement) {
      logger.error('Webhook: Agreement not found', { agreementId });
      return res.json({ received: true });
    }

    const schedule = buildRentSchedule(agreement, session.payment_intent);

    const initialPayment = await Payment.create({
      agreement: agreementId,
      tenant: agreement.tenant._id,
      landlord: agreement.landlord._id,
      property: agreement.property._id,
      amount: session.amount_total / 100,
      type: 'initial',
      status: 'paid',
      paidAt: new Date(),
      dueDate: new Date(agreement.term.startDate),
      stripePaymentIntent: session.payment_intent,
      stripeSessionId: session.id,
    });

    if (isS3Configured()) {
      generateReceiptPDFBuffer(
        initialPayment,
        { name: agreement.tenant.name, email: agreement.tenant.email },
        agreement.property
      )
        .then((buf) => uploadReceiptPDF(buf, initialPayment._id.toString()))
        .then((key) => Payment.findByIdAndUpdate(initialPayment._id, { receiptUrl: key }))
        .catch((err) => logger.error('Receipt PDF upload failed', { err: err.message }));
    }

    await Agreement.findByIdAndUpdate(agreementId, {
      status: 'active',
      isPaid: true,
      rentSchedule: schedule,
      $push: {
        auditLog: {
          action: 'LEASE_ACTIVATED',
          timestamp: new Date(),
          details: 'Security deposit and 1st month rent paid. Lease activated and schedule generated.',
        },
      },
    });

    if (agreement.property?._id) {
      await require('../models/Property').findByIdAndUpdate(agreement.property._id, {
        status: 'occupied',
        isListed: false,
      });
    }

    sendEmail(
      agreement.tenant.email,
      'paymentConfirmed',
      agreement.tenant.name,
      agreement.property.title,
      session.amount_total / 100
    );

    if (agreement.tenant.smsOptIn && agreement.tenant.phoneNumber) {
      sendSMS(
        agreement.tenant.phoneNumber,
        'rentDueReminder',
        agreement.property.title,
        agreement.financials.rentAmount,
        new Date()
      );
    }

    logger.info('Lease activated', { agreementId });

    // BUG-05: Queue in-app LEASE_ACTIVATED notification for both parties
    try {
      const notificationQueue = require('../queues/notificationQueue');
      await notificationQueue.add(`LEASE_ACTIVATED-${agreementId}`, {
        type: 'LEASE_ACTIVATED',
        data: {
          agreementId,
          tenantId: agreement.tenant._id.toString(),
          landlordId: agreement.landlord._id.toString(),
          propertyTitle: agreement.property.title,
        },
      });
    } catch (notifyErr) {
      logger.error('LEASE_ACTIVATED notification queue error', { err: notifyErr.message });
    }
  }

  // ─── Monthly rent payment ─────────────────────────────────────────────────
  if (
    event.type === 'checkout.session.completed' &&
    event.data.object?.metadata?.paymentType === 'monthly_rent'
  ) {
    const session = event.data.object;
    const { agreementId, scheduleIndex, month } = session.metadata;

    const agreement = await Agreement.findById(agreementId)
      .populate('tenant', 'name email phoneNumber smsOptIn')
      .populate('landlord', 'name email')
      .populate('property', 'title address');

    if (!agreement) {
      logger.error('Webhook: Agreement not found for monthly rent', { agreementId });
      return res.json({ received: true });
    }

    const idx = parseInt(scheduleIndex, 10);
    const entry = agreement.rentSchedule?.[idx];

    if (entry && entry.status !== 'paid') {
      entry.status = 'paid';
      entry.paidDate = new Date();
      entry.paidAmount = session.amount_total / 100;
      entry.stripePaymentIntent = session.payment_intent;
      entry.checkoutUrl = null;

      const monthlyPayment = await Payment.create({
        agreement: agreementId,
        tenant: agreement.tenant._id,
        landlord: agreement.landlord._id,
        property: agreement.property._id,
        amount: session.amount_total / 100,
        type: 'rent',
        status: 'paid',
        paidAt: new Date(),
        dueDate: entry.dueDate,
        lateFeeIncluded: (entry.lateFeeAmount || 0) > 0,
        lateFeeAmount: entry.lateFeeAmount || 0,
        stripePaymentIntent: session.payment_intent,
        stripeSessionId: session.id,
      });

      if (isS3Configured()) {
        generateReceiptPDFBuffer(
          monthlyPayment,
          { name: agreement.tenant.name, email: agreement.tenant.email },
          agreement.property
        )
          .then((buf) => uploadReceiptPDF(buf, monthlyPayment._id.toString()))
          .then((key) => Payment.findByIdAndUpdate(monthlyPayment._id, { receiptUrl: key }))
          .catch((err) => logger.error('Receipt PDF upload failed', { err: err.message }));
      }

      agreement.auditLog.push({
        action: 'RENT_PAID',
        details: `Monthly rent paid for ${month}. Amount: ${session.amount_total / 100}`,
        timestamp: new Date(),
      });

      await agreement.save();

      sendEmail(
        agreement.tenant.email,
        'paymentConfirmed',
        agreement.tenant.name,
        agreement.property.title,
        session.amount_total / 100
      );

      // Send SMS: payment received confirmation for the current payment
      if (agreement.tenant.smsOptIn && agreement.tenant.phoneNumber) {
        sendSMS(
          agreement.tenant.phoneNumber,
          'paymentReceived',
          agreement.property.title,
          session.amount_total / 100,
          month
        );
        // Also send reminder for the NEXT unpaid month
        const nextEntry = agreement.rentSchedule?.find(
          (e, i) => i > idx && e.status !== 'paid'
        );
        if (nextEntry) {
          sendSMS(
            agreement.tenant.phoneNumber,
            'rentDueReminder',
            agreement.property.title,
            nextEntry.amount,
            new Date(nextEntry.dueDate)
          );
        }
      }

      logger.info('Monthly rent paid', { agreementId, month });
    }
  }

  // ─── Payment failed ───────────────────────────────────────────────────────
  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    logger.error('Payment failed', { paymentIntentId: paymentIntent.id });

    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntent.id,
      limit: 1,
    });

    const session = sessions.data[0];
    if (session?.metadata?.agreementId) {
      const failedAgreement = await Agreement.findById(session.metadata.agreementId)
        .populate('tenant', 'name email phoneNumber smsOptIn');

      if (failedAgreement?.tenant) {
        const { tenant } = failedAgreement;

        sendEmail(tenant.email, 'paymentFailed', tenant.name, session.metadata.agreementId);

        if (tenant.smsOptIn && tenant.phoneNumber) {
          sendSMS(tenant.phoneNumber, 'paymentFailed', session.metadata.agreementId);
        }

        let failedPayment = await Payment.findOne({ stripePaymentIntent: paymentIntent.id });

        if (!failedPayment) {
          failedPayment = await Payment.create({
            agreement: session.metadata.agreementId,
            tenant: failedAgreement.tenant._id,
            landlord: failedAgreement.landlord,
            property: failedAgreement.property,
            amount: paymentIntent.amount / 100,
            type: 'rent',
            status: 'failed',
            gateway: 'stripe',
            stripePaymentIntent: paymentIntent.id,
            dueDate: new Date(),
          });
        } else {
          await Payment.findByIdAndUpdate(failedPayment._id, { status: 'failed' });
        }

        const retryCount = failedPayment.retryCount || 0;
        if (retryCount < 3) {
          try {
            const { Queue } = require('bullmq');
            const { redisConnection } = require('../config/redis');
            const retryQueue = new Queue('payment-retry', { connection: redisConnection });
            const delayMs = Math.pow(2, retryCount) * 60 * 60 * 1000; // 1h, 2h, 4h

            await retryQueue.add(
              'retry-payment',
              {
                paymentId: failedPayment._id.toString(),
                agreementId: session.metadata.agreementId,
                attempt: retryCount + 1,
              },
              { delay: delayMs, attempts: 1 }
            );

            await Payment.findByIdAndUpdate(failedPayment._id, {
              retryCount: retryCount + 1,
              nextRetryAt: new Date(Date.now() + delayMs),
              status: 'retry_scheduled',
            });

            logger.info('Payment retry scheduled', {
              paymentId: failedPayment._id,
              attempt: retryCount + 1,
              delayHours: delayMs / 3600000,
            });
          } catch (retryErr) {
            logger.error('Failed to schedule payment retry', { err: retryErr.message });
          }
        } else {
          logger.warn('Max retries reached for payment', { paymentId: failedPayment._id });
        }
      }
    }
  }

  res.json({ received: true });
};


// @desc    Get rent schedule for an agreement
// @route   GET /api/payments/schedule/:agreementId
// @access  Private (Tenant or Landlord on this agreement)
const getRentSchedule = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.agreementId)
      .populate('property', 'title address')
      .populate('tenant', 'name')
      .populate('landlord', 'name');

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found' });
    }

    const userId = req.user._id.toString();
    const isTenant = agreement.tenant._id.toString() === userId;
    const isLandlord = agreement.landlord._id.toString() === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isTenant && !isLandlord && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const schedule = agreement.rentSchedule || [];
    const paid = schedule.filter((e) => e.status === 'paid').length;
    const overdue = schedule.filter((e) => e.status === 'overdue' || e.status === 'late_fee_applied').length;
    const pending = schedule.filter((e) => e.status === 'pending').length;
    const totalLateFees = schedule.reduce((sum, e) => sum + (e.lateFeeAmount || 0), 0);

    res.json({
      agreement: {
        _id: agreement._id,
        property: agreement.property,
        tenant: agreement.tenant,
        landlord: agreement.landlord,
        term: agreement.term,
        financials: agreement.financials,
        status: agreement.status,
      },
      schedule,
      summary: { total: schedule.length, paid, pending, overdue, totalLateFees },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get payment history (role-filtered; supports ?agreementId, ?type, ?status, ?page, ?limit)
// @route   GET /api/payments/history | GET /api/payments
// @access  Private
const getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status, agreementId } = req.query;
    const filter = {};

    // Scope results to the authenticated user's role
    if (req.user.role === 'tenant') {
      filter.tenant = req.user._id;
    } else if (req.user.role === 'landlord') {
      filter.landlord = req.user._id;
    } else if (req.user.role === 'property_manager') {
      const managedProperties = await require('../models/Property')
        .find({ managedBy: req.user._id })
        .select('_id');
      filter.property = { $in: managedProperties.map((p) => p._id) };
    }
    // admin: no additional scope — sees all payments

    // Optional narrow-down filters
    if (agreementId) filter.agreement = agreementId;
    if (type) filter.type = type;
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate('tenant', 'name email')
        .populate('landlord', 'name')
        .populate('property', 'title address')
        .sort('-paidAt')
        .skip(skip)
        .limit(Number(limit)),
      Payment.countDocuments(filter),
    ]);

    res.json({
      payments,
      pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Create Stripe Checkout Session for a specific monthly rent payment
// @route   POST /api/payments/pay-rent
// @access  Private (Tenant)
const createRentCheckoutSession = async (req, res) => {
  try {
    const { agreementId, scheduleIndex } = req.body;

    if (scheduleIndex === undefined) {
      return res.status(400).json({ message: 'scheduleIndex is required' });
    }

    const agreement = await Agreement.findById(agreementId)
      .populate('property', 'title')
      .populate('tenant', 'name email')
      .populate('landlord', 'name');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    if (agreement.tenant._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (agreement.status !== 'active') {
      return res.status(400).json({ message: 'Agreement must be active to pay rent' });
    }

    const entry = agreement.rentSchedule?.[scheduleIndex];
    if (!entry) return res.status(404).json({ message: 'Rent schedule entry not found' });

    if (entry.status === 'paid') {
      return res.status(400).json({ message: "This month's rent has already been paid" });
    }

    // Component 0: Idempotency guard — block duplicate Payment record for same rent month
    const existingPaid = await Payment.findOne({
      agreement: agreementId,
      dueDate: entry.dueDate,
      status: 'paid',
      type: 'rent',
    });
    if (existingPaid) {
      return res.status(400).json({ message: "This month's rent is already paid" });
    }

    const totalAmount = entry.amount + (entry.lateFeeAmount || 0);
    const currency = process.env.STRIPE_CURRENCY || 'usd';
    const month = new Date(entry.dueDate).toLocaleString('default', { month: 'long', year: 'numeric' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Monthly Rent — ${month}`,
              description: `Property: ${agreement.property.title}${entry.lateFeeAmount ? ` (incl. $${entry.lateFeeAmount} late fee)` : ''}`,
            },
            unit_amount: Math.round(totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/dashboard/payments?success=true&month=${encodeURIComponent(month)}`,
      cancel_url: `${process.env.CLIENT_URL}/dashboard/payments?canceled=true`,
      metadata: {
        agreementId: agreement._id.toString(),
        scheduleIndex: String(scheduleIndex),
        paymentType: 'monthly_rent',
        month,
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get the pre-generated (or on-demand) Stripe checkout URL for the next unpaid month
// @route   GET /api/payments/active-checkout/:agreementId
// @access  Private (Tenant)
const getActiveCheckoutUrl = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.agreementId)
      .populate('property', 'title')
      .populate('tenant', 'name email');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    if (agreement.tenant._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (agreement.status !== 'active') {
      return res.status(400).json({ message: 'Agreement is not active' });
    }

    const idx = agreement.rentSchedule.findIndex((e) => e.status !== 'paid');
    const entry = agreement.rentSchedule[idx];

    if (!entry) {
      return res.status(200).json({ message: 'All rent payments are up to date', url: null });
    }

    if (entry.checkoutUrl) {
      return res.json({ url: entry.checkoutUrl, scheduleIndex: idx });
    }

    const totalAmount = entry.amount + (entry.lateFeeAmount || 0);
    const currency = process.env.STRIPE_CURRENCY || 'usd';
    const month = new Date(entry.dueDate).toLocaleString('default', { month: 'long', year: 'numeric' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Monthly Rent — ${month}`,
              description: `Property: ${agreement.property?.title || 'N/A'}${entry.lateFeeAmount ? ` (incl. $${entry.lateFeeAmount} late fee)` : ''}`,
            },
            unit_amount: Math.round(totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/dashboard/payments?success=true&month=${encodeURIComponent(month)}`,
      cancel_url: `${process.env.CLIENT_URL}/dashboard/payments?canceled=true`,
      customer_email: agreement.tenant?.email,
      metadata: {
        agreementId: agreement._id.toString(),
        scheduleIndex: String(idx),
        paymentType: 'monthly_rent',
        month,
      },
    });

    agreement.rentSchedule[idx].checkoutUrl = session.url;
    await agreement.save();

    res.json({ url: session.url, scheduleIndex: idx });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Queue a failed payment for retry (up to 3 attempts with backoff)
// @route   POST /api/payments/retry/:paymentId
// @access  Private (Tenant or Admin)
const retryFailedPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId)
      .populate('agreement')
      .populate('tenant', 'name email');

    if (!payment) return res.status(404).json({ message: 'Payment record not found' });

    const isTenant = payment.tenant._id.toString() === req.user._id.toString();
    if (!isTenant && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (payment.status === 'paid') {
      return res.status(400).json({ message: 'Payment already completed' });
    }

    const retryCount = payment.retryCount || 0;
    if (retryCount >= 3) {
      return res.status(400).json({ message: 'Maximum retry attempts (3) reached. Please contact support.' });
    }

    let retryQueue;
    try {
      const { Queue } = require('bullmq');
      const { redisConnection } = require('../config/redis');
      retryQueue = new Queue('payment-retry', { connection: redisConnection });
    } catch (_) { retryQueue = null; }

    if (retryQueue) {
      const delayMs = Math.pow(2, retryCount) * 60 * 1000; // 1min, 2min, 4min

      await retryQueue.add(
        'retry-payment',
        {
          paymentId: payment._id.toString(),
          agreementId: payment.agreement._id?.toString(),
          attempt: retryCount + 1,
        },
        { delay: delayMs, attempts: 1 }
      );

      await Payment.findByIdAndUpdate(payment._id, {
        retryCount: retryCount + 1,
        nextRetryAt: new Date(Date.now() + delayMs),
        status: 'retry_scheduled',
      });

      res.json({
        message: `Retry scheduled (attempt ${retryCount + 1}/3)`,
        nextRetryAt: new Date(Date.now() + delayMs),
        retryCount: retryCount + 1,
      });
    } else {
      res.json({
        message: 'Retry queue unavailable — please use the checkout link below',
        redirect: `${process.env.CLIENT_URL}/dashboard/payments?agreementId=${payment.agreement._id}`,
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


module.exports = {
  createCheckoutSession,
  createRentCheckoutSession,
  handleStripeWebhook,
  getRentSchedule,
  getPaymentHistory,
  getActiveCheckoutUrl,
  getAvailableGateways,
  retryFailedPayment,
  downloadReceipt,
};