const Agreement = require('../models/Agreement');
const Property = require('../models/Property');
const User = require('../models/User');
const Clause = require('../models/Clause');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { generateAgreementPDF, generateAgreementPDFBuffer } = require('../utils/pdfGenerator');
const { sendEmail } = require('../utils/emailService');
const { uploadAgreementPDF, isS3Configured, getAgreementPDFStream } = require('../utils/s3Service');
const AgreementTemplate = require('../models/AgreementTemplate');

const normalizeTier = (tier) => (
  ['free', 'pro', 'enterprise'].includes(String(tier || '').trim().toLowerCase())
    ? String(tier).trim().toLowerCase()
    : 'free'
);

// @desc    Create a draft agreement directly (landlord only)
// @route   POST /api/agreements
// @access  Private (Landlord)
const createAgreement = async (req, res) => {
  try {
    const {
      tenantId,
      propertyId,
      startDate,
      endDate,
      rentAmount,
      depositAmount,
      signerOrder,
      pdfTheme,
      agreementTemplate,
    } = req.body;

    const subscriptionTier = normalizeTier(req.user?.subscriptionTier);

    // Validate tenant exists and has tenant role
    const tenant = await User.findById(tenantId);
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(400).json({ message: 'tenantId must refer to a valid tenant account' });
    }

    // Validate property ownership
    const property = await Property.findById(propertyId);
    if (!property) return res.status(404).json({ message: 'Property not found' });
    if (property.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not own this property' });
    }

    // Validate dates
    if (new Date(endDate) <= new Date(startDate)) {
      return res.status(400).json({ message: 'endDate must be after startDate' });
    }

    if (agreementTemplate) {
      if (subscriptionTier !== 'enterprise') {
        return res.status(403).json({ message: 'Agreement templates in drafting are available on the Enterprise plan only' });
      }

      const template = await AgreementTemplate.findOne({
        _id: agreementTemplate,
        landlord: req.user._id,
        status: 'approved',
        isArchived: false,
      }).select('_id');

      if (!template) {
        return res.status(400).json({ message: 'agreementTemplate must be an approved template you own' });
      }
    }

    if (pdfTheme && subscriptionTier !== 'enterprise') {
      return res.status(403).json({ message: 'Pro and Free tiers use the admin global default PDF theme' });
    }

    const agreement = await Agreement.create({
      landlord: req.user._id,
      tenant: tenantId,
      property: propertyId,
      status: 'draft',
      signerOrder: signerOrder || 'landlord_first',
      term: { startDate: new Date(startDate), endDate: new Date(endDate) },
      financials: { rentAmount, depositAmount },
      signatures: { landlord: { signed: false }, tenant: { signed: false } },
      auditLog: [{ action: 'CREATED', actor: req.user._id, details: 'Agreement created directly by landlord' }],
      pdfTheme: pdfTheme || null,
      agreementTemplate: agreementTemplate || null,
    });

    return res.status(201).json(agreement);
  } catch (error) {
    logger.error('createAgreement error', { message: error.message });
    return res.status(500).json({ message: error.message });
  }
};


// @desc    Sign an agreement
// @route   PUT /api/agreements/:id/sign
// @access  Private (Landlord or Tenant)
// [FIX #5] Enforces signerOrder: landlord_first | tenant_first | any
const signAgreement = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id)
      .populate('landlord', 'name email')
      .populate('tenant', 'name email')
      .populate('property', 'title');

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found' });
    }

    const userId = req.user._id.toString();
    const isLandlord = agreement.landlord._id.toString() === userId;
    const isTenant = agreement.tenant._id.toString() === userId;

    if (!isLandlord && !isTenant) {
      return res.status(403).json({ message: 'Not authorized to sign this agreement' });
    }

    // ─── Prevent double-signing ───────────────────────────────────────────
    if (isLandlord && agreement.signatures.landlord.signed) {
      return res.status(400).json({ message: 'You have already signed this agreement' });
    }
    if (isTenant && agreement.signatures.tenant.signed) {
      return res.status(400).json({ message: 'You have already signed this agreement' });
    }

    // ─── [FIX #5] Enforce signerOrder ────────────────────────────────────
    const order = agreement.signerOrder || 'landlord_first';

    if (order === 'landlord_first' && isTenant && !agreement.signatures.landlord.signed) {
      return res.status(400).json({
        message: 'The landlord must sign this agreement before the tenant can sign.',
      });
    }
    if (order === 'tenant_first' && isLandlord && !agreement.signatures.tenant.signed) {
      return res.status(400).json({
        message: 'The tenant must sign this agreement before the landlord can sign.',
      });
    }
    // order === 'any': no restriction — fall through

    // ─── Stamp the signature ─────────────────────────────────────────────
    const signatureData = {
      signed: true,
      signedAt: new Date(),
      ipAddress: req.ip,
      drawData: req.body?.drawData || null,
    };

    if (isLandlord) {
      agreement.signatures.landlord = signatureData;
      if (!agreement.signatures.tenant.signed) {
        agreement.status = 'sent'; // waiting for tenant
      }
    }

    if (isTenant) {
      agreement.signatures.tenant = signatureData;
    }

    // ─── Both signed → awaiting payment ──────────────────────────────────
    const landlordSigned = isLandlord ? true : agreement.signatures.landlord.signed;
    const tenantSigned = isTenant ? true : agreement.signatures.tenant.signed;

    if (landlordSigned && tenantSigned) {
      agreement.status = 'signed';

      sendEmail(
        agreement.landlord.email,
        'agreementSigned',
        agreement.landlord.name,
        agreement.tenant.name,
        agreement.property.title
      );

      agreement.auditLog.push({
        action: 'FULLY_SIGNED',
        actor: req.user._id,
        ipAddress: req.ip,
        details: 'Both parties signed. Awaiting security deposit payment to activate.',
      });

      // Async S3 upload — does not block response
      if (isS3Configured()) {
        generateAgreementPDFBuffer(agreement, agreement.landlord, agreement.tenant, agreement.property)
          .then((pdfBuffer) => uploadAgreementPDF(pdfBuffer, agreement._id.toString()))
          .then((s3Key) =>
            Agreement.findByIdAndUpdate(agreement._id, {
              documentUrl: s3Key,
              documentVersion: (agreement.documentVersion || 0) + 1,
            })
          )
          .catch((err) =>
            logger.error('S3 upload failed for agreement', { agreementId: agreement._id, err: err.message })
          );
      }
    } else {
      agreement.auditLog.push({
        action: isLandlord ? 'SIGNED_LANDLORD' : 'SIGNED_TENANT',
        actor: req.user._id,
        ipAddress: req.ip,
        details: `Signed by ${req.user.name} at ${new Date().toISOString()}`,
      });
    }

    await agreement.save();

    res.json({
      message: landlordSigned && tenantSigned
        ? 'Agreement fully signed. Awaiting payment to activate.'
        : 'Agreement signed successfully',
      status: agreement.status,
      signatures: agreement.signatures,
    });
  } catch (error) {
    logger.error('signAgreement error', { err: error.message, stack: error.stack });
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get Agreements
// @route   GET /api/agreements
// @access  Private (Landlord or Tenant)
const getAgreements = async (req, res) => {
  try {
    const { role, _id: userId } = req.user;

    let query;
    if (role === 'admin' || role === 'law_reviewer') {
      query = {};
    } else if (role === 'property_manager') {
      const managedProperties = await require('../models/Property')
        .find({ managedBy: userId })
        .select('_id');
      const propIds = managedProperties.map((p) => p._id);
      query = { property: { $in: propIds } };
    } else {
      query = { $or: [{ landlord: userId }, { tenant: userId }] };
    }

    const agreements = await Agreement.find(query)
      .populate('property', 'title address')
      .populate('landlord', 'name email')
      .populate('tenant', 'name email')
      .sort('-createdAt');

    res.json(agreements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Generate PDF for an Agreement
// @route   GET /api/agreements/:id/pdf
// @access  Private (Landlord or Tenant)
const downloadAgreementPDF = async (req, res) => {
  try {
    const currency = (req.query.currency || req.headers['x-currency'] || 'USD').toString().toUpperCase();

    const agreement = await Agreement.findById(req.params.id)
      .populate('landlord', 'name email')
      .populate('tenant', 'name email')
      .populate('property')
      .populate('pdfTheme')
      .populate('agreementTemplate');

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found' });
    }

    const isAdmin = req.user.role === 'admin';
    if (
      !isAdmin &&
      agreement.landlord._id.toString() !== req.user._id.toString() &&
      agreement.tenant._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=agreement-${agreement._id}.pdf`);

    if (agreement.documentUrl && isS3Configured()) {
      const stream = await getAgreementPDFStream(agreement.documentUrl);

      agreement.auditLog.push({
        action: 'PDF_DOWNLOADED',
        actor: req.user._id,
        ipAddress: req.ip,
        details: 'PDF served from S3 document vault',
      });
      await agreement.save();

      if (stream && typeof stream.pipe === 'function') {
        return stream.pipe(res);
      }
    }

    agreement.auditLog.push({
      action: 'PDF_DOWNLOADED',
      actor: req.user._id,
      ipAddress: req.ip,
      details: 'PDF generated on demand',
    });
    await agreement.save();

    await generateAgreementPDF(agreement, agreement.landlord, agreement.tenant, agreement.property, res, { currency });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ─── RENEWAL WORKFLOW ──────────────────────────────────────────────────────────

// @desc   Propose a lease renewal (Landlord initiates)
// @route  POST /api/agreements/:id/renew
// @access Private (Landlord)
const proposeRenewal = async (req, res) => {
  try {
    const { newEndDate, newRentAmount, notes } = req.body;
    const agreement = await Agreement.findById(req.params.id)
      .populate('tenant', 'name email')
      .populate('property', 'title');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });
    if (agreement.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the landlord can propose renewal' });
    }
    if (!['active', 'expired'].includes(agreement.status)) {
      return res.status(400).json({ message: 'Only active or expired agreements can be renewed' });
    }

    agreement.renewalProposal = {
      proposedBy: req.user._id,
      newEndDate: newEndDate || null,
      newRentAmount: newRentAmount || agreement.financials.rentAmount,
      notes: notes || '',
      status: 'pending',
      proposedAt: new Date(),
    };

    agreement.auditLog.push({
      action: 'RENEWAL_PROPOSED',
      actor: req.user._id,
      ipAddress: req.ip,
      details: `Renewal proposed until ${newEndDate}. New rent: $${newRentAmount || agreement.financials.rentAmount}`,
    });

    await agreement.save();

    await sendEmail(
      agreement.tenant.email,
      'renewalProposed',
      agreement.tenant.name,
      agreement.property.title,
      newEndDate,
      newRentAmount || agreement.financials.rentAmount
    );

    // BUG-05: Queue in-app notification so tenant sees it on notifications page
    try {
      const notificationQueue = require('../queues/notificationQueue');
      await notificationQueue.add(`RENEWAL_PROPOSED-${agreement._id}`, {
        type: 'RENEWAL_PROPOSED',
        data: {
          agreementId: agreement._id.toString(),
          tenantId: agreement.tenant._id.toString(),
          tenantEmail: agreement.tenant.email,
          tenantName: agreement.tenant.name,
          propertyTitle: agreement.property.title,
          newEndDate,
          newRentAmount: newRentAmount || agreement.financials.rentAmount,
        },
      });
    } catch (notifyErr) {
      logger.error('RENEWAL_PROPOSED notification queue error', { err: notifyErr.message });
    }

    res.json({ message: 'Renewal proposal sent to tenant', agreement });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc   Tenant responds to renewal proposal
// @route  PUT /api/agreements/:id/renew/respond
// @access Private (Tenant)
const respondToRenewal = async (req, res) => {
  try {
    const { accept } = req.body;
    const agreement = await Agreement.findById(req.params.id)
      .populate('landlord', 'name email')
      .populate('tenant', 'name email')
      .populate('property');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });
    if ((agreement.tenant._id || agreement.tenant).toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the tenant can respond to renewal' });
    }
    if (!agreement.renewalProposal || agreement.renewalProposal.status !== 'pending') {
      return res.status(400).json({ message: 'No pending renewal proposal found' });
    }

    if (accept) {
      const proposal = agreement.renewalProposal;
      const oldEndDate = new Date(agreement.term.endDate);

      agreement.term.endDate = proposal.newEndDate || agreement.term.endDate;
      agreement.financials.rentAmount = proposal.newRentAmount || agreement.financials.rentAmount;
      agreement.status = 'active';
      agreement.renewalProposal.status = 'accepted';

      // NEW-08: durationMonths should reflect the EXTENSION length, not total tenure
      const newEnd = new Date(agreement.term.endDate);
      const extensionMonths =
        (newEnd.getFullYear() - oldEndDate.getFullYear()) * 12 +
        (newEnd.getMonth() - oldEndDate.getMonth());
      agreement.term.durationMonths = extensionMonths;

      // NEW-06: Append new rentSchedule entries for the extended period
      const newRent = agreement.financials.rentAmount;
      for (let i = 1; i <= extensionMonths; i++) {
        const dueDate = new Date(oldEndDate);
        dueDate.setMonth(oldEndDate.getMonth() + i);
        agreement.rentSchedule.push({ dueDate, amount: newRent, status: 'pending' });
      }

      agreement.auditLog.push({
        action: 'RENEWAL_ACCEPTED',
        actor: req.user._id,
        details: `Tenant accepted renewal until ${agreement.term.endDate}. Extended by ${extensionMonths} months, ${extensionMonths} new schedule entries added.`,
      });
    } else {
      agreement.renewalProposal.status = 'rejected';

      // Only expire if the lease term has actually ended.
      // A rejected renewal on a still-active lease should not immediately expire it —
      // the lease continues until its natural end date.
      const leaseEnded = agreement.term && agreement.term.endDate && new Date(agreement.term.endDate) <= new Date();
      if (leaseEnded) {
        agreement.status = 'expired';
        // BUG-04: Mark property vacant only when the lease has actually ended
        await Property.findByIdAndUpdate(agreement.property?._id || agreement.property, { status: 'vacant' });
      }

      agreement.auditLog.push({
        action: 'RENEWAL_REJECTED',
        actor: req.user._id,
        details: leaseEnded
          ? 'Tenant declined renewal — lease expired (end date passed)'
          : 'Tenant declined renewal — lease remains active until end date',
      });
    }

    // NEW-02: Queue RENEWAL_RESPONDED for landlord on BOTH accept and reject
    try {
      const notificationQueue = require('../queues/notificationQueue');
      const landlordUser = await User.findById(agreement.landlord).select('name email phoneNumber smsOptIn');
      if (landlordUser) {
        await notificationQueue.add(`RENEWAL_RESPONDED-${agreement._id}`, {
          type: 'RENEWAL_RESPONDED',
          data: {
            agreementId: agreement._id.toString(),
            landlordId: landlordUser._id.toString(),
            landlordEmail: landlordUser.email,
            landlordName: landlordUser.name,
            landlordPhone: landlordUser.phoneNumber,
            landlordSmsOptIn: landlordUser.smsOptIn,
            accepted: Boolean(accept),
            propertyTitle: agreement.property?.title || '',
          },
        });
      }
    } catch (notifyErr) {
      logger.error('RENEWAL_RESPONDED notification queue error', { err: notifyErr.message });
    }

    await agreement.save();

    if (accept && agreement.signatures?.landlord?.signed && agreement.signatures?.tenant?.signed && isS3Configured()) {
      try {
        const pdfBuffer = await generateAgreementPDFBuffer(
          agreement,
          agreement.landlord,
          agreement.tenant,
          agreement.property
        );
        const s3Key = await uploadAgreementPDF(pdfBuffer, agreement._id.toString());

        agreement.documentUrl = s3Key;
        agreement.documentVersion = (agreement.documentVersion || 0) + 1;
        await agreement.save();
      } catch (uploadErr) {
        logger.error('renewal PDF upload failed', { agreementId: agreement._id, err: uploadErr.message });
      }
    }

    res.json({ message: accept ? 'Renewal accepted — lease extended!' : 'Renewal declined', agreement });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get approved clauses (for agreement builder clause picker)
// @route   GET /api/agreements/clauses
// @access  Private (Landlord, PM, Admin)
const getAvailableClauses = async (req, res) => {
  try {
    const { category, jurisdiction } = req.query;
    const filter = { isApproved: true, isArchived: false };
    if (category) filter.category = category;
    if (jurisdiction) filter.jurisdiction = jurisdiction;

    const clauses = await Clause.find(filter)
      .select('title body category jurisdiction isDefault usageCount condition')
      .sort({ isDefault: -1, usageCount: -1 });

    res.json(clauses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Add / replace clauseSet on a draft agreement
// @route   PUT /api/agreements/:id/clauses
// @access  Private (Landlord who owns the agreement)
// [FIX #4] Snapshots the clause condition alongside title + body
const updateAgreementClauses = async (req, res) => {
  try {
    const { clauseIds } = req.body;

    if (!Array.isArray(clauseIds)) {
      return res.status(400).json({ message: 'clauseIds must be an array' });
    }

    const subscriptionTier = normalizeTier(req.user?.subscriptionTier);
    const clauseLimit = subscriptionTier === 'free' ? 2 : Number.POSITIVE_INFINITY;
    if (Number.isFinite(clauseLimit) && clauseIds.length > clauseLimit) {
      return res.status(403).json({ message: `Free plan can include up to ${clauseLimit} clauses per agreement` });
    }

    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    if (agreement.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the landlord can update clauses' });
    }
    if (!['draft', 'sent'].includes(agreement.status)) {
      return res.status(400).json({ message: 'Clauses can only be updated on draft or sent agreements' });
    }

    const clauses = await Clause.find({ _id: { $in: clauseIds }, isApproved: true, isArchived: false });

    // [FIX #4] Snapshot the condition alongside title + body
    agreement.clauseSet = clauses.map((c) => ({
      clauseId: c._id,
      title: c.title,
      body: c.body,
      condition: c.condition || null,
    }));

    await Clause.updateMany({ _id: { $in: clauseIds } }, { $inc: { usageCount: 1 } });

    agreement.auditLog.push({
      action: 'CLAUSES_UPDATED',
      actor: req.user._id,
      ipAddress: req.ip,
      details: `${clauses.length} clause(s) attached to agreement`,
    });

    await agreement.save();
    res.json({ message: 'Clause set updated', clauseSet: agreement.clauseSet });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get signed agreement document URL (pre-signed S3 link)
// @route   GET /api/agreements/:id/document-url
// @access  Private (Tenant, Landlord, Admin)
const getDocumentUrl = async (req, res) => {
  try {
    const { getAgreementPDFUrl, isS3Configured: checkS3 } = require('../utils/s3Service');

    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    const userId = req.user._id.toString();
    const isParty = agreement.landlord.toString() === userId || agreement.tenant.toString() === userId;
    if (!isParty && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (!agreement.documentUrl) {
      return res.status(404).json({ message: 'No stored document found. Please download the PDF directly.' });
    }

    if (!checkS3()) {
      return res.status(503).json({ message: 'Document vault not configured on this server.' });
    }

    const url = await getAgreementPDFUrl(agreement.documentUrl);
    res.json({ url, expiresIn: 3600 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Send DocuSign-style signing invitation emails with secure tokens
// @route   POST /api/agreements/:id/send-signing-invites
// @access  Private (Landlord on this agreement)
const sendSigningInvites = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id)
      .populate('tenant', 'name email')
      .populate('landlord', 'name email')
      .populate('property', 'title');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    const isLandlord = agreement.landlord._id.toString() === req.user._id.toString();
    if (!isLandlord && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the landlord can send signing invitations' });
    }

    if (!['draft', 'sent', 'pending_signature'].includes(agreement.status)) {
      return res.status(400).json({ message: 'Agreement must be in draft or pending signature status to send invitations' });
    }

    const landlordToken = crypto.randomBytes(32).toString('hex');
    const tenantToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    agreement.signingTokens = agreement.signingTokens.filter(
      (t) => !['landlord', 'tenant'].includes(t.party)
    );
    agreement.signingTokens.push(
      { party: 'landlord', token: landlordToken, expiresAt, used: false },
      { party: 'tenant', token: tenantToken, expiresAt, used: false }
    );

    agreement.status = 'pending_signature';
    agreement.auditLog.push({
      action: 'SIGNING_INVITES_SENT',
      actor: req.user._id,
      timestamp: new Date(),
      details: `Signing invitations sent to ${agreement.landlord.email} and ${agreement.tenant.email}`,
    });
    await agreement.save();

    const baseUrl = process.env.CLIENT_URL || 'http://localhost:3000';

    await sendEmail(
      agreement.landlord.email,
      'signingInvite',
      agreement.landlord.name,
      agreement.property.title,
      `${baseUrl}/sign/${agreement._id}?token=${landlordToken}&party=landlord`
    );

    await sendEmail(
      agreement.tenant.email,
      'signingInvite',
      agreement.tenant.name,
      agreement.property.title,
      `${baseUrl}/sign/${agreement._id}?token=${tenantToken}&party=tenant`
    );

    res.json({
      message: 'Signing invitations sent successfully',
      sentTo: [agreement.landlord.email, agreement.tenant.email],
      expiresAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Sign agreement via secure token (DocuSign-style link)
// @route   POST /api/agreements/:id/sign-via-token
// @access  Public (token-authenticated)
const signViaToken = async (req, res) => {
  try {
    const { token, party } = req.body;
    if (!token || !party) return res.status(400).json({ message: 'Token and party are required' });

    const agreement = await Agreement.findById(req.params.id)
      .populate('tenant', 'name email')
      .populate('landlord', 'name email')
      .populate('property', 'title');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    const signingToken = agreement.signingTokens.find(
      (t) => t.party === party && t.token === token && !t.used
    );

    if (!signingToken) {
      return res.status(400).json({ message: 'Invalid or already used signing token' });
    }

    if (new Date() > signingToken.expiresAt) {
      return res.status(400).json({ message: 'Signing link has expired. Please request a new invitation.' });
    }

    signingToken.used = true;
    signingToken.usedAt = new Date();

    const sig = agreement.signatures[party];
    sig.signed = true;
    sig.signedAt = new Date();
    sig.ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    sig.drawData = req.body?.drawData || null;

    const bothSigned = agreement.signatures.landlord.signed && agreement.signatures.tenant.signed;
    if (bothSigned) {
      agreement.status = 'signed';
      agreement.auditLog.push({
        action: 'AGREEMENT_FULLY_SIGNED',
        timestamp: new Date(),
        details: 'Both parties signed via secure token links. Agreement is fully executed.',
      });
    } else {
      agreement.status = 'sent';
      agreement.auditLog.push({
        action: 'PARTIAL_SIGNATURE',
        timestamp: new Date(),
        details: `${party} signed via secure token link.`,
      });
    }

    await agreement.save();

    res.json({
      message: bothSigned ? 'Agreement fully signed by all parties' : `Signature recorded for ${party}`,
      status: agreement.status,
      bothSigned,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get full version history for an agreement
// @route   GET /api/agreements/:id/version-history
// @access  Private (parties on agreement or admin)
const getVersionHistory = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id)
      .populate('versionHistory.savedBy', 'name email role')
      .populate('auditLog.actor', 'name email role');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    const userId = req.user._id.toString();
    const isTenant = agreement.tenant?.toString() === userId;
    const isLandlord = agreement.landlord?.toString() === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isTenant && !isLandlord && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json({
      agreementId: agreement._id,
      currentVersion: agreement.versionHistory.length,
      versionHistory: agreement.versionHistory.sort((a, b) => b.version - a.version),
      auditLog: agreement.auditLog.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Internal helper — saves version snapshot
const saveVersionSnapshot = async (agreementId, userId, reason = 'Manual save') => {
  const agreement = await Agreement.findById(agreementId);
  if (!agreement) return;

  const nextVersion = (agreement.versionHistory.length || 0) + 1;
  agreement.versionHistory.push({
    version: nextVersion,
    savedAt: new Date(),
    savedBy: userId,
    reason,
    snapshot: {
      clauses: (agreement.clauseSet || []).map((c) => c.title || c.clauseId?.toString() || ''),
      financials: agreement.financials,
      term: agreement.term,
      status: agreement.status,
    },
  });
  await agreement.save();
  return nextVersion;
};


// @desc    Manually snapshot the current agreement state
// @route   POST /api/agreements/:id/snapshot
// @access  Private (landlord or admin)
const snapshotAgreement = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    const isLandlord = agreement.landlord?.toString() === req.user._id.toString();
    if (!isLandlord && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const version = await saveVersionSnapshot(
      req.params.id,
      req.user._id,
      req.body.reason || 'Manual snapshot'
    );

    res.json({ message: 'Version snapshot saved', version });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get inline PDF preview URL
// @route   GET /api/agreements/:id/preview
// @access  Private (parties on agreement or admin)
const getAgreementPreview = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id)
      .populate('property', 'title address')
      .populate('tenant', 'name email')
      .populate('landlord', 'name email')
      .populate('pdfTheme');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    const userId = req.user._id.toString();
    const isTenant = agreement.tenant?._id.toString() === userId;
    const isLandlord = agreement.landlord?._id.toString() === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isTenant && !isLandlord && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (agreement.documentUrl && isS3Configured()) {
      const { getAgreementPDFUrl } = require('../utils/s3Service');
      const url = await getAgreementPDFUrl(agreement.documentUrl, 1800);
      return res.json({ url, source: 's3', expiresIn: 1800 });
    }

    const pdfBuffer = await generateAgreementPDFBuffer(agreement, agreement.landlord, agreement.tenant, agreement.property);
    const base64 = pdfBuffer.toString('base64');

    res.json({
      source: 'generated',
      base64,
      mimeType: 'application/pdf',
      filename: `agreement-${agreement._id}.pdf`,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Public PDF preview — validates the signing token, no Bearer auth required
// @route   GET /api/agreements/:id/preview/public
// @access  Public (signing-token authenticated)
// NEW-03: The sign page is an unauthenticated flow; the standard /preview route
// requires a Bearer token which doesn't exist for unsigned users.
const getAgreementPreviewPublic = async (req, res) => {
  try {
    const { token, party } = req.query;
    if (!token || !party) {
      return res.status(400).json({ message: 'token and party query params are required' });
    }

    const agreement = await Agreement.findById(req.params.id)
      .populate('property', 'title address')
      .populate('tenant', 'name email')
      .populate('landlord', 'name email');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    // Validate the signing token
    const signingToken = agreement.signingTokens?.find(
      (t) => t.party === party && t.token === token && !t.used
    );
    if (!signingToken) {
      return res.status(401).json({ message: 'Invalid or already used signing token' });
    }
    if (new Date() > signingToken.expiresAt) {
      return res.status(401).json({ message: 'Signing link has expired' });
    }

    if (agreement.documentUrl && isS3Configured()) {
      const { getAgreementPDFUrl } = require('../utils/s3Service');
      const url = await getAgreementPDFUrl(agreement.documentUrl, 1800);
      return res.json({ url, source: 's3', expiresIn: 1800 });
    }

    const pdfBuffer = await generateAgreementPDFBuffer(agreement, agreement.landlord, agreement.tenant, agreement.property);
    const base64 = pdfBuffer.toString('base64');

    res.json({
      source: 'generated',
      base64,
      mimeType: 'application/pdf',
      filename: `agreement-${agreement._id}.pdf`,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get a single agreement by ID (party or admin only)
// @route   GET /api/agreements/:id
// @access  Private
const getAgreementById = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id)
      .populate('landlord', 'name email phoneNumber')
      .populate('tenant', 'name email phoneNumber')
      .populate('property', 'title address financials specs type images');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    const userId = req.user._id.toString();
    const isLandlord = agreement.landlord?._id?.toString() === userId;
    const isTenant = agreement.tenant?._id?.toString() === userId;
    const isAdmin = req.user.role === 'admin';
    const isPM = req.user.role === 'property_manager';

    if (!isLandlord && !isTenant && !isAdmin && !isPM) {
      return res.status(403).json({ message: 'Not authorized to view this agreement' });
    }

    return res.json(agreement);
  } catch (error) {
    logger.error('getAgreementById error', { message: error.message });
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update rent escalation settings for an agreement
// @route   PUT /api/agreements/:id/escalation
// @access  Private (Landlord only)
const updateEscalation = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    if (agreement.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the landlord can update escalation settings' });
    }

    const { enabled, percentage } = req.body;

    if (typeof enabled === 'boolean') agreement.rentEscalation.enabled = enabled;

    if (percentage !== undefined) {
      const pct = Number(percentage);
      if (isNaN(pct) || pct < 0 || pct > 50) {
        return res.status(400).json({ message: 'Percentage must be between 0 and 50' });
      }
      agreement.rentEscalation.percentage = pct;
    }

    // If enabling, set next scheduled date to one year from the lease start
    if (enabled && !agreement.rentEscalation.nextScheduledAt) {
      const nextDate = new Date(agreement.term.startDate);
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      agreement.rentEscalation.nextScheduledAt = nextDate;
    }

    agreement.auditLog.push({
      action: 'ESCALATION_UPDATED',
      actor: req.user._id,
      ipAddress: req.ip,
      details: `Rent escalation ${enabled ? 'enabled' : 'updated'} at ${percentage ?? agreement.rentEscalation.percentage}%`,
    });

    await agreement.save();
    return res.json({ message: 'Escalation settings updated', rentEscalation: agreement.rentEscalation });
  } catch (error) {
    logger.error('updateEscalation error', { message: error.message });
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createAgreement,
  getAgreements,
  getAgreementById,
  downloadAgreementPDF,
  signAgreement,
  proposeRenewal,
  respondToRenewal,
  getAvailableClauses,
  updateAgreementClauses,
  getDocumentUrl,
  sendSigningInvites,
  signViaToken,
  getVersionHistory,
  snapshotAgreement,
  getAgreementPreview,
  getAgreementPreviewPublic,
  saveVersionSnapshot,
  updateEscalation,
};