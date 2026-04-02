const logger = require('../utils/logger');
const Offer = require('../models/Offer');
const Property = require('../models/Property');
const Agreement = require('../models/Agreement');
const AgreementTemplate = require('../models/AgreementTemplate');
const PdfTheme = require('../models/PdfTheme');
const { sendEmail } = require('../utils/emailService');
const notificationQueue = require('../queues/notificationQueue');

// ─── Helpers ────────────────────────────────────────────────────────────────
const isParty = (offer, userId) =>
  offer.tenant._id?.toString() === userId ||
  offer.landlord._id?.toString() === userId;

const latestRound = (offer) =>
  offer.history[offer.history.length - 1] || null;

// ─── GET /api/offers ──────────────────────────────────────────────────────────
const getOffers = async (req, res) => {
  try {
    const { status, propertyId, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (req.user.role === 'tenant') filter.tenant = req.user._id;
    if (req.user.role === 'landlord') filter.landlord = req.user._id;
    if (status) filter.status = status;
    if (propertyId) filter.property = propertyId;

    const skip = (Number(page) - 1) * Number(limit);

    const [offers, total] = await Promise.all([
      Offer.find(filter)
        .populate('tenant', 'name email phoneNumber profilePhoto')
        .populate('landlord', 'name email')
        .populate('property', 'title address financials status images leaseTerms')
        .populate('agreement', 'status term financials')
        .sort('-updatedAt')
        .skip(skip)
        .limit(Number(limit)),
      Offer.countDocuments(filter),
    ]);

    res.json({ offers, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/offers/:id ──────────────────────────────────────────────────────
const getOfferById = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id)
      .populate('tenant', 'name email phoneNumber profilePhoto')
      .populate('landlord', 'name email phoneNumber')
      .populate('property', 'title address financials status images leaseTerms')
      .populate('agreement', 'status term financials signatures documentUrl');

    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    if (!isParty(offer, req.user._id.toString()) && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not authorised' });

    res.json(offer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/offers ─────────────────────────────────────────────────────────
const createOffer = async (req, res) => {
  try {
    if (req.user.role !== 'tenant')
      return res.status(403).json({ message: 'Only tenants can submit offers' });

    const { propertyId, monthlyRent, securityDeposit, leaseDurationMonths } = req.body;
    if (!propertyId || !monthlyRent || !securityDeposit || !leaseDurationMonths)
      return res.status(400).json({ message: 'propertyId, monthlyRent, securityDeposit and leaseDurationMonths are required' });

    const property = await Property.findById(propertyId).populate('landlord', 'name email');
    if (!property || !property.isListed)
      return res.status(404).json({ message: 'Property not found or not listed' });

    const existing = await Offer.findOne({
      property: propertyId,
      tenant: req.user._id,
      status: { $in: ['pending', 'countered', 'accepted'] },
    });
    if (existing)
      return res.status(409).json({ message: 'You already have an active offer on this property', offerId: existing._id });

    const offer = await Offer.create({
      property: propertyId,
      landlord: property.landlord._id,
      tenant: req.user._id,
      listedTerms: {
        monthlyRent: property.financials?.monthlyRent || 0,
        securityDeposit: property.financials?.securityDeposit || 0,
        leaseDurationMonths: property.leaseTerms?.defaultDurationMonths || 12,
      },
      history: [{
        round: 1,
        offeredBy: 'tenant',
        monthlyRent: Number(monthlyRent),
        securityDeposit: Number(securityDeposit),
        leaseDurationMonths: Number(leaseDurationMonths),
      }],
      applicantDetails: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phoneNumber || '',
      },
    });

    const populated = await Offer.findById(offer._id)
      .populate('property', 'title address')
      .populate('landlord', 'name email')
      .populate('tenant', 'name email');

    res.status(201).json(populated);
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ message: 'You already have an offer on this property' });
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/offers/:id/counter ────────────────────────────────────────────
const counterOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Offer not found' });

    const uid = req.user._id.toString();
    const isLandlord = offer.landlord.toString() === uid;
    const isTenant = offer.tenant.toString() === uid;

    if (!isLandlord && !isTenant) return res.status(403).json({ message: 'Not authorised' });
    if (!['pending', 'countered'].includes(offer.status))
      return res.status(400).json({ message: `Cannot counter an offer with status "${offer.status}"` });

    const last = latestRound(offer);
    if (isLandlord && last?.offeredBy === 'landlord')
      return res.status(400).json({ message: 'Waiting for tenant to respond to your counter-offer' });
    if (isTenant && last?.offeredBy === 'tenant')
      return res.status(400).json({ message: 'Waiting for landlord to respond to your offer' });

    const { monthlyRent, securityDeposit, leaseDurationMonths, note } = req.body;

    offer.history.push({
      round: offer.history.length + 1,
      offeredBy: isLandlord ? 'landlord' : 'tenant',
      monthlyRent: Number(monthlyRent),
      securityDeposit: Number(securityDeposit),
      leaseDurationMonths: Number(leaseDurationMonths),
      note: isLandlord ? (note || '') : '',
    });
    offer.status = 'countered';
    await offer.save();

    const populated = await Offer.findById(offer._id)
      .populate('tenant', 'name email')
      .populate('landlord', 'name email')
      .populate('property', 'title address financials');

    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/offers/:id/accept ───────────────────────────────────────────────
const acceptOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id)
      .populate('property', 'title address financials leaseTerms status')
      .populate('tenant', 'name email phoneNumber')
      .populate('landlord', 'name email');

    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    if (offer.landlord._id.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Only the landlord can accept an offer' });
    if (!['pending', 'countered'].includes(offer.status))
      return res.status(400).json({ message: `Offer is already ${offer.status}` });

    const agreed = latestRound(offer);
    if (!agreed) return res.status(400).json({ message: 'No offer terms found' });

    const {
      startDate: startDateRaw,
      templateId,
      pdfThemeId,
      petAllowed = false,
      petDeposit = 0,
      utilitiesIncluded = false,
      utilitiesDetails = '',
      terminationPolicy = '',
      rentEscalationEnabled = false,
      rentEscalationPercentage = 5,
    } = req.body;

    const startDate = startDateRaw ? new Date(startDateRaw) : new Date();
    const durationMonths = agreed.leaseDurationMonths || 12;
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationMonths);

    let agreementTemplate = null;
    let pdfTheme = null;
    if (templateId) {
      const tmpl = await AgreementTemplate.findById(templateId).select('_id landlord status isArchived');
      if (!tmpl) return res.status(404).json({ message: 'Agreement template not found' });
      if (tmpl.landlord.toString() !== req.user._id.toString())
        return res.status(403).json({ message: 'That template does not belong to you' });
      if (tmpl.status !== 'approved') return res.status(400).json({ message: 'Template must be approved by admin before use' });
      if (tmpl.isArchived) return res.status(400).json({ message: 'Template is archived and cannot be used' });

      agreementTemplate = tmpl._id;
    } else if (pdfThemeId) {
      const theme = await PdfTheme.findById(pdfThemeId).select('_id isGlobal');
      if (!theme || !theme.isGlobal) {
        return res.status(400).json({ message: 'Selected default PDF theme is invalid' });
      }
      pdfTheme = theme._id;
    }

    const agreement = await Agreement.create({
      landlord: offer.landlord._id,
      tenant: offer.tenant._id,
      property: offer.property._id,
      term: { startDate, endDate, durationMonths },
      financials: {
        rentAmount: agreed.monthlyRent,
        depositAmount: agreed.securityDeposit,
        lateFeeAmount: offer.property.financials?.lateFeeAmount || 0,
        lateFeeGracePeriodDays: offer.property.financials?.lateFeeGracePeriodDays || 5,
      },
      petPolicy: { allowed: Boolean(petAllowed), deposit: petAllowed ? Number(petDeposit) || 0 : 0 },
      utilitiesIncluded: Boolean(utilitiesIncluded),
      utilitiesDetails: utilitiesIncluded ? (utilitiesDetails || '') : '',
      terminationPolicy: terminationPolicy || '',
      agreementTemplate,
      pdfTheme,
      auditLog: [{
        action: 'CREATED_FROM_OFFER',
        actor: req.user._id,
        details: `Agreement drafted from accepted offer (round ${agreed.round})${templateId ? ` using template ${templateId}` : ''}`,
      }],
      rentEscalation: {
        enabled: Boolean(rentEscalationEnabled),
        percentage: Number(rentEscalationPercentage) || 5,
        nextScheduledAt: rentEscalationEnabled ? (() => { const d = new Date(startDate); d.setFullYear(d.getFullYear() + 1); return d; })() : null,
      },
    });

    offer.status = 'accepted';
    offer.agreement = agreement._id;
    await offer.save();

    // ── Notifications ─────────────────────────────────────────────────────────
    try {
      await sendEmail(offer.tenant.email, 'applicationAccepted', offer.tenant.name, offer.property.title);
      await notificationQueue.add('notification', {
        type: 'APPLICATION_ACCEPTED',
        data: {
          tenantId: offer.tenant._id,
          tenantEmail: offer.tenant.email,
          tenantPhone: offer.tenant.phoneNumber,
          tenantName: offer.tenant.name,
          propertyTitle: offer.property.title,
          tenantSmsOptIn: true
        }
      });
    } catch (notifyErr) {
      logger.error('acceptOffer notification error', { err: notifyErr.message });
    }

    await Offer.updateMany(
      { property: offer.property._id, _id: { $ne: offer._id }, status: { $in: ['pending', 'countered'] } },
      { $set: { status: 'declined' } }
    );

    await Property.findByIdAndUpdate(offer.property._id, { status: 'occupied', isListed: false });

    res.json({ message: 'Offer accepted — agreement drafted', offer, agreement });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/offers/:id/decline ──────────────────────────────────────────────
const declineOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id)
      .populate('tenant', 'name email phoneNumber')
      .populate('property', 'title');
    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    if (offer.landlord.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Only the landlord can decline an offer' });
    if (!['pending', 'countered'].includes(offer.status))
      return res.status(400).json({ message: `Offer is already ${offer.status}` });

    offer.status = 'declined';
    await offer.save();

    // ── Notifications ─────────────────────────────────────────────────────────
    try {
      await sendEmail(offer.tenant.email, 'applicationRejected', offer.tenant.name, offer.property.title);
      await notificationQueue.add('notification', {
        type: 'APPLICATION_REJECTED',
        data: {
          tenantId: offer.tenant._id,
          tenantEmail: offer.tenant.email,
          tenantPhone: offer.tenant.phoneNumber,
          tenantName: offer.tenant.name,
          propertyTitle: offer.property.title,
          tenantSmsOptIn: true
        }
      });
    } catch (notifyErr) {
      logger.error('declineOffer notification error', { err: notifyErr.message });
    }

    res.json({ message: 'Offer declined', offer });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── DELETE /api/offers/:id ───────────────────────────────────────────────────
const withdrawOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    if (offer.tenant.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorised' });
    if (!['pending', 'countered'].includes(offer.status))
      return res.status(400).json({ message: `Cannot withdraw — offer is already ${offer.status}` });

    offer.status = 'withdrawn';
    await offer.save();
    res.json({ message: 'Offer withdrawn' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getOffers, getOfferById, createOffer, counterOffer, acceptOffer, declineOffer, withdrawOffer };