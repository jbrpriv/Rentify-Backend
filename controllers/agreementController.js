const Agreement = require('../models/Agreement');
const Property = require('../models/Property');
const User = require('../models/User');
const Clause = require('../models/Clause');
const { generateAgreementPDF, generateAgreementPDFBuffer } = require('../utils/pdfGenerator');
const { sendEmail } = require('../utils/emailService');
const { uploadAgreementPDF, isS3Configured } = require('../utils/s3Service');

// @desc    Create a new rental agreement
// @route   POST /api/agreements
// @access  Private (Landlord)
const createAgreement = async (req, res) => {
  try {
    const { tenantId, propertyId, startDate, endDate, rentAmount, depositAmount } = req.body;

    // 1. Verify Property belongs to Landlord
    const property = await Property.findById(propertyId);
    if (!property || property.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to lease this property' });
    }

    // 2. Validate tenant exists and has the correct role (Bug 7 / M4)
    const tenant = await User.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }
    if (tenant.role !== 'tenant') {
      return res.status(400).json({ message: 'Provided userId does not belong to a tenant account' });
    }

    // 3. Compute lease duration in months (Bug 2 / C2)
    const start = new Date(startDate);
    const end = new Date(endDate);
    const durationMonths =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());

    if (durationMonths <= 0) {
      return res.status(400).json({ message: 'endDate must be after startDate' });
    }

    // 4. Create Agreement Record
    const agreement = await Agreement.create({
      landlord: req.user._id,
      tenant: tenantId,
      property: propertyId,
      term: { startDate, endDate, durationMonths },
      financials: { rentAmount, depositAmount },
      auditLog: [{
        action: 'CREATED',
        actor: req.user._id,
        ipAddress: req.ip,
        details: 'Initial Draft Created'
      }]
    });

    const populated = await Agreement.findById(agreement._id)
      .populate('landlord', 'name')
      .populate('tenant', 'name email')
      .populate('property', 'title');

    sendEmail(
      populated.tenant.email,
      'agreementCreated',
      populated.tenant.name,
      populated.landlord.name,
      populated.property.title,
      agreement.term.startDate,
      agreement.term.endDate,
      agreement.financials.rentAmount
    );

    res.status(201).json(agreement);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Sign an agreement
// @route   PUT /api/agreements/:id/sign
// @access  Private (Landlord or Tenant)
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

    // Prevent double signing
    if (isLandlord && agreement.signatures.landlord.signed) {
      return res.status(400).json({ message: 'You have already signed this agreement' });
    }
    if (isTenant && agreement.signatures.tenant.signed) {
      return res.status(400).json({ message: 'You have already signed this agreement' });
    }

    // Stamp the signature
    const signatureData = {
      signed: true,
      signedAt: new Date(),
      ipAddress: req.ip,
    };

    if (isLandlord) {
      agreement.signatures.landlord = signatureData;
      agreement.status = 'sent'; // Landlord signed first, waiting for tenant
    }

    if (isTenant) {
      agreement.signatures.tenant = signatureData;
    }

    // If BOTH have signed → wait for payment (status: 'signed')
    const landlordSigned = isLandlord ? true : agreement.signatures.landlord.signed;
    const tenantSigned = isTenant ? true : agreement.signatures.tenant.signed;

    if (landlordSigned && tenantSigned) {
      agreement.status = 'signed'; // Awaiting Stripe payment to become active

      // Notify landlord that tenant has signed
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

      // ─── S3 Document Vault (H3) ────────────────────────────────────────────
      // Upload a permanent signed copy to S3 now that both parties have signed.
      // Done asynchronously — we don't block the HTTP response.
      if (isS3Configured()) {
        generateAgreementPDFBuffer(agreement, agreement.landlord, agreement.tenant, agreement.property)
          .then((pdfBuffer) => uploadAgreementPDF(pdfBuffer, agreement._id.toString()))
          .then((s3Key) => {
            return Agreement.findByIdAndUpdate(agreement._id, {
              documentUrl: s3Key,
              documentVersion: (agreement.documentVersion || 1) + 1,
            });
          })
          .catch((err) => {
            console.error('S3 upload failed for agreement', agreement._id, err.message);
          });
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
      message: 'Agreement signed successfully',
      status: agreement.status,
      signatures: agreement.signatures,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get Agreements
// @route   GET /api/agreements
// @access  Private (Landlord or Tenant)
const getAgreements = async (req, res) => {
  try {
    const { role, _id: userId } = req.user;

    // Admins and law reviewers can see all agreements
    const query =
      role === 'admin' || role === 'law_reviewer'
        ? {}
        : { $or: [{ landlord: userId }, { tenant: userId }] };

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
    const agreement = await Agreement.findById(req.params.id)
      .populate('landlord', 'name email')
      .populate('tenant', 'name email')
      .populate('property');

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found' });
    }

    // Security Check: Only involved parties or admin can download
    const isAdmin = req.user.role === 'admin';
    if (
      !isAdmin &&
      agreement.landlord._id.toString() !== req.user._id.toString() &&
      agreement.tenant._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Log the download action
    agreement.auditLog.push({
      action: 'PDF_DOWNLOADED',
      actor: req.user._id,
      ipAddress: req.ip,
      details: 'PDF Document Generated'
    });
    await agreement.save();

    // Set headers for file download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=agreement-${agreement._id}.pdf`);

    // Generate PDF
    generateAgreementPDF(agreement, agreement.landlord, agreement.tenant, agreement.property, res);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ─── RENEWAL WORKFLOW ─────────────────────────────────────────────────────────

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
      proposedBy:    req.user._id,
      newEndDate:    newEndDate    || null,
      newRentAmount: newRentAmount || agreement.financials.rentAmount,
      notes:         notes        || '',
      status:        'pending',
      proposedAt:    new Date(),
    };

    agreement.auditLog.push({
      action:    'RENEWAL_PROPOSED',
      actor:     req.user._id,
      ipAddress: req.ip,
      details:   `Renewal proposed until ${newEndDate}. New rent: Rs. ${newRentAmount || agreement.financials.rentAmount}`,
    });

    await agreement.save();

    // Notify tenant (using top-level sendEmail import)
    await sendEmail(
      agreement.tenant.email,
      'renewalProposed',
      agreement.tenant.name,
      agreement.property.title,
      newEndDate,
      newRentAmount || agreement.financials.rentAmount
    );

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
      .populate('property', 'title');

    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });
    if (agreement.tenant.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the tenant can respond to renewal' });
    }
    if (!agreement.renewalProposal || agreement.renewalProposal.status !== 'pending') {
      return res.status(400).json({ message: 'No pending renewal proposal found' });
    }

    if (accept) {
      const proposal = agreement.renewalProposal;

      // Apply renewal: extend term, update rent if changed
      agreement.term.endDate         = proposal.newEndDate || agreement.term.endDate;
      agreement.financials.rentAmount = proposal.newRentAmount || agreement.financials.rentAmount;
      agreement.status               = 'active';
      agreement.renewalProposal.status = 'accepted';

      // M1 fix: Recompute durationMonths to reflect extended lease
      const newStart = new Date(agreement.term.startDate);
      const newEnd   = new Date(agreement.term.endDate);
      agreement.term.durationMonths =
        (newEnd.getFullYear() - newStart.getFullYear()) * 12 +
        (newEnd.getMonth() - newStart.getMonth());

      agreement.auditLog.push({
        action: 'RENEWAL_ACCEPTED',
        actor:  req.user._id,
        details: `Tenant accepted renewal until ${agreement.term.endDate}. Duration updated to ${agreement.term.durationMonths} months.`,
      });
    } else {
      agreement.renewalProposal.status = 'rejected';
      agreement.auditLog.push({
        action: 'RENEWAL_REJECTED',
        actor:  req.user._id,
        details: 'Tenant declined renewal proposal',
      });
    }

    await agreement.save();
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
    if (category)     filter.category     = category;
    if (jurisdiction) filter.jurisdiction = jurisdiction;

    const clauses = await Clause.find(filter)
      .select('title body category jurisdiction isDefault usageCount')
      .sort({ isDefault: -1, usageCount: -1 });

    res.json(clauses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Add / replace clauseSet on a draft agreement
// @route   PUT /api/agreements/:id/clauses
// @access  Private (Landlord who owns the agreement)
const updateAgreementClauses = async (req, res) => {
  try {
    const { clauseIds } = req.body; // Array of Clause ObjectId strings

    if (!Array.isArray(clauseIds)) {
      return res.status(400).json({ message: 'clauseIds must be an array' });
    }

    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ message: 'Agreement not found' });

    if (agreement.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the landlord can update clauses' });
    }
    if (!['draft', 'sent'].includes(agreement.status)) {
      return res.status(400).json({ message: 'Clauses can only be updated on draft or sent agreements' });
    }

    // Fetch clause documents and snapshot title + body into the agreement
    const clauses = await Clause.find({ _id: { $in: clauseIds }, isApproved: true, isArchived: false });

    agreement.clauseSet = clauses.map((c) => ({
      clauseId: c._id,
      title:    c.title,
      body:     c.body,
    }));

    // Increment usage count on selected clauses
    await Clause.updateMany({ _id: { $in: clauseIds } }, { $inc: { usageCount: 1 } });

    agreement.auditLog.push({
      action:    'CLAUSES_UPDATED',
      actor:     req.user._id,
      ipAddress: req.ip,
      details:   `${clauses.length} clause(s) attached to agreement`,
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

module.exports = {
  createAgreement,
  getAgreements,
  downloadAgreementPDF,
  signAgreement,
  proposeRenewal,
  respondToRenewal,
  getAvailableClauses,
  updateAgreementClauses,
  getDocumentUrl,
};