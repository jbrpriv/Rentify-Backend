const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Agreement = require('../models/Agreement');
const Payment = require('../models/Payment');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');
const { generateReceiptPDFBuffer } = require('../utils/pdfGenerator');
const { uploadReceiptPDF, isS3Configured } = require('../utils/s3Service');

// ─── Optional gateway initialisers ───────────────────────────────────────────
let Razorpay, paypal;
try {
  Razorpay = require('razorpay');
} catch (_) { /* razorpay package not installed — gateway disabled */ }
try {
  paypal = require('@paypal/checkout-server-sdk');
} catch (_) { /* paypal package not installed — gateway disabled */ }

// ─── Razorpay helper ─────────────────────────────────────────────────────────
function getRazorpayClient() {
  if (!Razorpay || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// ─── PayPal helper ───────────────────────────────────────────────────────────
function getPayPalClient() {
  if (!paypal || !process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return null;
  const env = process.env.NODE_ENV === 'production'
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
  return new paypal.core.PayPalHttpClient(env);
}

// @desc    List available payment gateways
// @route   GET /api/payments/gateways
// @access  Private
const getAvailableGateways = (req, res) => {
  const gateways = [{ id: 'stripe', name: 'Stripe', enabled: !!process.env.STRIPE_SECRET_KEY }];
  if (getRazorpayClient()) gateways.push({ id: 'razorpay', name: 'Razorpay', enabled: true });
  if (getPayPalClient()) gateways.push({ id: 'paypal', name: 'PayPal', enabled: true });
  res.json({ gateways });
};

// @desc    Create Razorpay order for initial deposit + rent
// @route   POST /api/payments/razorpay/create-order
// @access  Private (Tenant)
const createRazorpayOrder = async (req, res) => {
  const rzp = getRazorpayClient();
  if (!rzp) return res.status(503).json({ message: 'Razorpay gateway not configured' });

  try {
    const { agreementId } = req.body;
    const agreement = await Agreement.findById(agreementId)
      .populate('property', 'title')
      .populate('tenant', 'name email')
      .populate('landlord', 'name');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });
    if (agreement.tenant._id.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized' });
    if (agreement.isPaid) return res.status(400).json({ message: 'Already paid' });
    if (agreement.status !== 'signed') return res.status(400).json({ message: 'Agreement must be signed first' });

    const totalAmount = (agreement.financials.rentAmount + agreement.financials.depositAmount) * 100;

    const order = await rzp.orders.create({
      amount: Math.round(totalAmount),
      currency: process.env.RAZORPAY_CURRENCY || 'INR',
      receipt: `agr_${agreementId}`,
      notes: { agreementId: agreementId.toString(), type: 'initial' },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      prefill: {
        name: agreement.tenant.name,
        email: agreement.tenant.email,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Verify Razorpay payment signature and activate agreement
// @route   POST /api/payments/razorpay/verify
// @access  Private (Tenant)
const verifyRazorpayPayment = async (req, res) => {
  const rzp = getRazorpayClient();
  if (!rzp) return res.status(503).json({ message: 'Razorpay gateway not configured' });

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, agreementId } = req.body;

    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid payment signature — possible tampering detected' });
    }

    const agreement = await Agreement.findById(agreementId)
      .populate('tenant', 'name email phoneNumber smsOptIn')
      .populate('landlord', 'name email')
      .populate('property', 'title');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    // Build rent schedule
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
          currentAmount = Math.round(currentAmount * (1 + (escalationPct / 100)));
        }
      }

      schedule.push({
        dueDate, amount: currentAmount,
        status: i === 0 ? 'paid' : 'pending',
        paidDate: i === 0 ? new Date() : null,
        paidAmount: i === 0 ? currentAmount : null,
        lateFeeApplied: false, lateFeeAmount: 0,
      });
    }

    await Payment.create({
      agreement: agreementId, tenant: agreement.tenant._id, landlord: agreement.landlord._id,
      property: agreement.property._id,
      amount: (agreement.financials.rentAmount + agreement.financials.depositAmount),
      type: 'initial', status: 'paid', paidAt: new Date(),
      dueDate: startDate, gateway: 'razorpay',
      gatewayPaymentId: razorpay_payment_id, gatewayOrderId: razorpay_order_id,
    });

    await Agreement.findByIdAndUpdate(agreementId, {
      status: 'active', isPaid: true, rentSchedule: schedule,
      $push: {
        auditLog: {
          action: 'LEASE_ACTIVATED', timestamp: new Date(),
          details: `Initial payment completed via Razorpay. Payment ID: ${razorpay_payment_id}`
        }
      },
    });

    await require('../models/Property').findByIdAndUpdate(agreement.property._id, {
      status: 'occupied', isListed: false,
    });

    sendEmail(agreement.tenant.email, 'paymentConfirmed', agreement.tenant.name,
      agreement.property.title, agreement.financials.rentAmount + agreement.financials.depositAmount);

    res.json({ message: 'Payment verified and lease activated', status: 'active' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create PayPal order for initial payment
// @route   POST /api/payments/paypal/create-order
// @access  Private (Tenant)
const createPayPalOrder = async (req, res) => {
  const ppClient = getPayPalClient();
  if (!ppClient) return res.status(503).json({ message: 'PayPal gateway not configured' });

  try {
    const { agreementId } = req.body;
    const agreement = await Agreement.findById(agreementId)
      .populate('property', 'title')
      .populate('tenant', 'name email');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });
    if (agreement.tenant._id.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized' });
    if (agreement.isPaid) return res.status(400).json({ message: 'Already paid' });

    const totalAmount = (agreement.financials.rentAmount + agreement.financials.depositAmount).toFixed(2);
    const currency = process.env.PAYPAL_CURRENCY || 'USD';

    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: currency, value: totalAmount },
        description: `Security Deposit + 1st Month Rent — ${agreement.property.title}`,
        custom_id: agreementId.toString(),
      }],
      application_context: {
        return_url: `${process.env.CLIENT_URL}/dashboard/my-lease?success=true&gateway=paypal`,
        cancel_url: `${process.env.CLIENT_URL}/dashboard/my-lease?canceled=true`,
      },
    });

    const response = await ppClient.execute(request);
    const approveLink = response.result.links.find(l => l.rel === 'approve');

    res.json({
      orderId: response.result.id,
      approveUrl: approveLink?.href,
      totalAmount,
      currency,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Capture PayPal order after user approves
// @route   POST /api/payments/paypal/capture
// @access  Private (Tenant)
const capturePayPalOrder = async (req, res) => {
  const ppClient = getPayPalClient();
  if (!ppClient) return res.status(503).json({ message: 'PayPal gateway not configured' });

  try {
    const { orderId, agreementId } = req.body;

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const response = await ppClient.execute(request);

    if (response.result.status !== 'COMPLETED') {
      return res.status(400).json({ message: 'PayPal capture failed', status: response.result.status });
    }

    const agreement = await Agreement.findById(agreementId)
      .populate('tenant', 'name email phoneNumber smsOptIn')
      .populate('landlord', 'name email')
      .populate('property', 'title');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    const captureId = response.result.purchase_units?.[0]?.payments?.captures?.[0]?.id;

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
          currentAmount = Math.round(currentAmount * (1 + (escalationPct / 100)));
        }
      }

      schedule.push({
        dueDate, amount: currentAmount,
        status: i === 0 ? 'paid' : 'pending',
        paidDate: i === 0 ? new Date() : null,
        paidAmount: i === 0 ? currentAmount : null,
        lateFeeApplied: false, lateFeeAmount: 0,
      });
    }

    await Payment.create({
      agreement: agreementId, tenant: agreement.tenant._id, landlord: agreement.landlord._id,
      property: agreement.property._id,
      amount: (agreement.financials.rentAmount + agreement.financials.depositAmount),
      type: 'initial', status: 'paid', paidAt: new Date(), dueDate: startDate,
      gateway: 'paypal', gatewayPaymentId: captureId, gatewayOrderId: orderId,
    });

    await Agreement.findByIdAndUpdate(agreementId, {
      status: 'active', isPaid: true, rentSchedule: schedule,
      $push: {
        auditLog: {
          action: 'LEASE_ACTIVATED', timestamp: new Date(),
          details: `Initial payment captured via PayPal. Capture ID: ${captureId}`
        }
      },
    });

    await require('../models/Property').findByIdAndUpdate(agreement.property._id, {
      status: 'occupied', isListed: false,
    });

    sendEmail(agreement.tenant.email, 'paymentConfirmed', agreement.tenant.name,
      agreement.property.title, agreement.financials.rentAmount + agreement.financials.depositAmount);

    res.json({ message: 'PayPal payment captured and lease activated', status: 'active' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── Failed Payment Retry Logic ───────────────────────────────────────────────
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

    // Enqueue retry via BullMQ if available, otherwise redirect to checkout
    let retryQueue;
    try {
      const { Queue } = require('bullmq');
      const { redisConnection } = require('../config/redis');
      retryQueue = new Queue('payment-retry', { connection: redisConnection });
    } catch (_) { retryQueue = null; }

    if (retryQueue) {
      const delayMs = Math.pow(2, retryCount) * 60 * 1000; // 1min, 2min, 4min backoff
      await retryQueue.add(
        'retry-payment',
        { paymentId: payment._id.toString(), agreementId: payment.agreement._id?.toString(), attempt: retryCount + 1 },
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
      // Fallback: return a new checkout URL
      res.json({
        message: 'Retry queue unavailable — please use the checkout link below',
        redirect: `${process.env.CLIENT_URL}/dashboard/payments?agreementId=${payment.agreement._id}`,
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

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

    // Only the tenant on this agreement can pay
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
    const totalAmount = rentAmount + depositAmount;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: process.env.STRIPE_CURRENCY || 'pkr',
            product_data: {
              name: `Security Deposit + 1st Month Rent`,
              description: `Property: ${agreement.property.title}`,
            },
            unit_amount: totalAmount * 100,
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
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed' && event.data.object?.metadata?.paymentType !== 'monthly_rent') {
    const session = event.data.object;
    const { agreementId } = session.metadata;

    const agreement = await Agreement.findById(agreementId)
      .populate('tenant', 'name email phoneNumber smsOptIn')
      .populate('landlord', 'name email')
      .populate('property', 'title');

    if (!agreement) {
      console.error(`Webhook: Agreement ${agreementId} not found`);
      return res.json({ received: true });
    }

    // Generate full rent schedule
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
          currentAmount = Math.round(currentAmount * (1 + (escalationPct / 100)));
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
        stripePaymentIntent: i === 0 ? session.payment_intent : null,
      });
    }

    // Save a standalone Payment record for this initial payment
    const initialPayment = await Payment.create({
      agreement: agreementId,
      tenant: agreement.tenant._id,
      landlord: agreement.landlord._id,
      property: agreement.property._id,
      amount: session.amount_total / 100,
      type: 'initial',
      status: 'paid',
      paidAt: new Date(),
      dueDate: startDate,
      stripePaymentIntent: session.payment_intent,
      stripeSessionId: session.id,
    });

    // Generate + upload receipt PDF asynchronously (non-blocking)
    if (isS3Configured()) {
      generateReceiptPDFBuffer(
        initialPayment,
        { name: agreement.tenant.name, email: agreement.tenant.email },
        agreement.property
      ).then((buf) => uploadReceiptPDF(buf, initialPayment._id.toString()))
        .then((key) => Payment.findByIdAndUpdate(initialPayment._id, { receiptUrl: key }))
        .catch((err) => console.error('Receipt PDF upload failed:', err.message));
    }

    // Activate the agreement
    await Agreement.findByIdAndUpdate(agreementId, {
      status: 'active',
      isPaid: true,
      rentSchedule: schedule,
      $push: {
        paymentHistory: {
          amount: session.amount_total / 100,
          status: 'paid',
          stripePaymentIntent: session.payment_intent,
        },
        auditLog: {
          action: 'LEASE_ACTIVATED',
          timestamp: new Date(),
          details: 'Security deposit and 1st month rent paid. Lease activated and schedule generated.',
        },
      },
    });

    // Mark property as occupied and unlist it
    if (agreement.property?._id) {
      await require('../models/Property').findByIdAndUpdate(agreement.property._id, {
        status: 'occupied',
        isListed: false,
      });
    }

    // Notify tenant via email + SMS
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
        'rentDueReminder', // Reuse closest template
        agreement.property.title,
        agreement.financials.rentAmount,
        new Date()
      );
    }

    console.log(`💰 Payment confirmed & Lease ACTIVATED: ${agreementId}`);
  }

  // ─── Monthly rent payment completed ───────────────────────────────────────
  if (event.type === 'checkout.session.completed' &&
    event.data.object?.metadata?.paymentType === 'monthly_rent') {
    const session = event.data.object;
    const { agreementId, scheduleIndex, month } = session.metadata;

    const agreement = await Agreement.findById(agreementId)
      .populate('tenant', 'name email phoneNumber smsOptIn')
      .populate('landlord', 'name email')
      .populate('property', 'title');

    if (!agreement) {
      console.error(`Webhook: Agreement ${agreementId} not found for monthly rent`);
      return res.json({ received: true });
    }

    const idx = parseInt(scheduleIndex, 10);
    const entry = agreement.rentSchedule?.[idx];
    if (entry && entry.status !== 'paid') {
      entry.status = 'paid';
      entry.paidDate = new Date();
      entry.paidAmount = session.amount_total / 100;
      entry.stripePaymentIntent = session.payment_intent;
      entry.checkoutUrl = null; // Clear stale URL — this session is consumed

      // Save a standalone Payment record
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

      // Generate + upload receipt PDF asynchronously (non-blocking)
      if (isS3Configured()) {
        generateReceiptPDFBuffer(
          monthlyPayment,
          { name: agreement.tenant.name, email: agreement.tenant.email },
          agreement.property
        ).then((buf) => uploadReceiptPDF(buf, monthlyPayment._id.toString()))
          .then((key) => Payment.findByIdAndUpdate(monthlyPayment._id, { receiptUrl: key }))
          .catch((err) => console.error('Receipt PDF upload failed:', err.message));
      }

      agreement.auditLog.push({
        action: 'RENT_PAID',
        details: `Monthly rent paid for ${month}. Amount: ${session.amount_total / 100}`,
        timestamp: new Date(),
      });

      await agreement.save();

      // Notify tenant
      sendEmail(
        agreement.tenant.email,
        'paymentConfirmed',
        agreement.tenant.name,
        agreement.property.title,
        session.amount_total / 100
      );
      console.log(`💰 Monthly rent paid for agreement ${agreementId}, month ${month}`);
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    console.error(`❌ Payment failed: ${paymentIntent.id}`);

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

        // Notify tenant by email
        sendEmail(tenant.email, 'paymentFailed', tenant.name, session.metadata.agreementId);

        // Notify tenant by SMS if opted in
        if (tenant.smsOptIn && tenant.phoneNumber) {
          sendSMS(tenant.phoneNumber, 'paymentFailed', session.metadata.agreementId);
        }

        // ── Auto-schedule retry via BullMQ ──────────────────────────────────
        // Find or create the Payment record for this failed intent
        let failedPayment = await Payment.findOne({
          stripePaymentIntent: paymentIntent.id,
        });

        if (!failedPayment) {
          // Create a minimal failed payment record so retryFailedPayment can operate on it
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
            const delayMs = Math.pow(2, retryCount) * 60 * 60 * 1000; // 1h, 2h, 4h backoff

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

            console.log(`🔄 Payment retry scheduled (attempt ${retryCount + 1}/3) in ${delayMs / 3600000}h for payment ${failedPayment._id}`);
          } catch (retryErr) {
            console.error('Failed to schedule payment retry:', retryErr.message);
          }
        } else {
          console.log(`⛔ Max retries reached for payment ${failedPayment._id} — manual intervention required`);
        }

        console.log(`📧 Payment failure notification sent to tenant ${tenant.email}`);
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

    // Compute summary stats
    const schedule = agreement.rentSchedule || [];
    const paid = schedule.filter(e => e.status === 'paid').length;
    const overdue = schedule.filter(e => e.status === 'overdue' || e.status === 'late_fee_applied').length;
    const pending = schedule.filter(e => e.status === 'pending').length;

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
      summary: {
        total: schedule.length,
        paid,
        pending,
        overdue,
        totalLateFees,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get payment history
// @route   GET /api/payments/history
// @access  Private (Tenant sees own | Landlord sees incoming | Admin sees all)
const getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status } = req.query;
    const filter = {};

    if (req.user.role === 'tenant') {
      filter.tenant = req.user._id;
    } else if (req.user.role === 'landlord') {
      filter.landlord = req.user._id;
    } else if (req.user.role === 'property_manager') {
      // PM sees payments for their managed properties
      const managedProperties = await require('../models/Property')
        .find({ managedBy: req.user._id })
        .select('_id');
      filter.property = { $in: managedProperties.map(p => p._id) };
    }
    // Admin sees all — no filter

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
    if (!entry) {
      return res.status(404).json({ message: 'Rent schedule entry not found' });
    }

    if (entry.status === 'paid') {
      return res.status(400).json({ message: 'This month\'s rent has already been paid' });
    }

    // Calculate total including any late fee already applied
    const totalAmount = entry.amount + (entry.lateFeeAmount || 0);
    const currency = process.env.STRIPE_CURRENCY || 'pkr';

    const month = new Date(entry.dueDate).toLocaleString('default', { month: 'long', year: 'numeric' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Monthly Rent — ${month}`,
              description: `Property: ${agreement.property.title}${entry.lateFeeAmount ? ` (incl. Rs. ${entry.lateFeeAmount} late fee)` : ''}`,
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

// @desc    Get the pre-generated Stripe checkout URL for the next unpaid month.
//          If the scheduler hasn't run yet (or the URL expired), falls back to
//          creating a fresh session on-demand so the tenant is never blocked.
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

    // Find the first unpaid schedule entry
    const idx = agreement.rentSchedule.findIndex(e => e.status !== 'paid');
    const entry = agreement.rentSchedule[idx];

    if (!entry) {
      return res.status(200).json({ message: 'All rent payments are up to date', url: null });
    }

    // Return cached URL if present (scheduler already created it)
    if (entry.checkoutUrl) {
      return res.json({ url: entry.checkoutUrl, scheduleIndex: idx });
    }

    // Fallback: create on-demand (same logic as createRentCheckoutSession)
    const totalAmount = entry.amount + (entry.lateFeeAmount || 0);
    const currency = process.env.STRIPE_CURRENCY || 'pkr';
    const month = new Date(entry.dueDate).toLocaleString('default', {
      month: 'long', year: 'numeric',
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Monthly Rent — ${month}`,
              description: `Property: ${agreement.property?.title || 'N/A'}${entry.lateFeeAmount ? ` (incl. Rs. ${entry.lateFeeAmount} late fee)` : ''
                }`,
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

    // Cache it so subsequent calls are instant
    agreement.rentSchedule[idx].checkoutUrl = session.url;
    await agreement.save();

    res.json({ url: session.url, scheduleIndex: idx });
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
  createRazorpayOrder,
  verifyRazorpayPayment,
  createPayPalOrder,
  capturePayPalOrder,
  retryFailedPayment,
};