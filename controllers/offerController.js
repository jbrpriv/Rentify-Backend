const Offer = require('../models/Offer');
const Property = require('../models/Property');
const Agreement = require('../models/Agreement');
const AgreementTemplate = require('../models/AgreementTemplate');
const Clause = require('../models/Clause');
const { sendEmail } = require('../utils/emailService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isParty = (offer, userId) =>
  offer.tenant._id?.toString() === userId ||
  offer.landlord._id?.toString() === userId;

const latestRound = (offer) =>
  offer.history[offer.history.length - 1] || null;

// ─── GET /api/offers ──────────────────────────────────────────────────────────
// Tenant → their own submitted offers
// Landlord → all incoming offers on their properties
// Admin → all offers
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
// Tenant submits initial offer — no descriptions, just numbers.
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

    // Block only if an active (non-terminal) offer already exists
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
// Landlord counters the latest tenant offer (or tenant counters landlord counter).
const counterOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Offer not found' });

    const uid = req.user._id.toString();
    const role = req.user.role;

    const isLandlord = offer.landlord.toString() === uid;
    const isTenant = offer.tenant.toString() === uid;

    if (!isLandlord && !isTenant)
      return res.status(403).json({ message: 'Not authorised' });

    if (!['pending', 'countered'].includes(offer.status))
      return res.status(400).json({ message: `Cannot counter an offer with status "${offer.status}"` });

    const last = latestRound(offer);
    // Validate turn: landlord counters tenant rounds, tenant counters landlord rounds.
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
      note: isLandlord ? (note || '') : '', // only landlord can add note
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
// Landlord accepts an offer → create Agreement draft + auto-decline all other offers on property.
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

    // ── Create the Agreement ──────────────────────────────────────────────────
    const startDate = (req.body?.startDate) ? new Date(req.body.startDate) : new Date();
    const durationMonths = agreed.leaseDurationMonths || 12;
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationMonths);

    // ── Resolve template clauses if a templateId was provided ───────────────
    let clauseSet = [];
    const { templateId } = req.body;
    if (templateId) {
      const tmpl = await AgreementTemplate.findById(templateId).populate('clauseIds');
      if (!tmpl) return res.status(404).json({ message: 'Agreement template not found' });
      if (tmpl.landlord.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'That template does not belong to you' });
      }
      if (tmpl.status !== 'approved') {
        return res.status(400).json({ message: 'Template must be approved by admin before use' });
      }
      clauseSet = (tmpl.clauseIds || []).map((c) => ({
        clauseId: c._id,
        title: c.title,
        body: c.body,
      }));
      // Bump usage count on each clause
      const approvedIds = tmpl.clauseIds.filter(c => c.isApproved).map(c => c._id);
      if (approvedIds.length > 0) {
        await Clause.updateMany({ _id: { $in: approvedIds } }, { $inc: { usageCount: 1 } });
      }
    }

    const agreement = await Agreement.create({
      landlord: offer.landlord._id,
      tenant: offer.tenant._id,
      property: offer.property._id,
      term: {
        startDate,
        endDate,
        durationMonths,
      },
      financials: {
        rentAmount: agreed.monthlyRent,
        depositAmount: agreed.securityDeposit,
        lateFeeAmount: offer.property.financials?.lateFeeAmount || 0,
        lateFeeGracePeriodDays: offer.property.financials?.lateFeeGracePeriodDays || 5,
      },
      clauseSet,
      auditLog: [{
        action: 'CREATED_FROM_OFFER',
        actor: req.user._id,
        details: `Agreement drafted from accepted offer (round ${agreed.round})${templateId ? ` using template ${templateId}` : ''}`,
      }],
    });

    // ── Update this offer ─────────────────────────────────────────────────────
    offer.status = 'accepted';
    offer.agreement = agreement._id;
    await offer.save();

    // N12 fix: notify the tenant that their offer was accepted and an agreement is ready
    try {
      await sendEmail(
        offer.tenant.email,
        'applicationAccepted',
        offer.tenant.name,
        offer.property.title
      );
    } catch (emailErr) {
      // Non-fatal — log but don't fail the request if the email bounce
      console.error('acceptOffer: failed to send tenant notification email:', emailErr.message);
    }

    // ── Auto-decline all other pending/countered offers for the same property ─
    await Offer.updateMany(
      {
        property: offer.property._id,
        _id: { $ne: offer._id },
        status: { $in: ['pending', 'countered'] },
      },
      { $set: { status: 'declined' } }
    );

    // ── Mark property as occupied ─────────────────────────────────────────────
    await Property.findByIdAndUpdate(offer.property._id, { status: 'occupied', isListed: false });

    res.json({ message: 'Offer accepted — agreement drafted', offer, agreement });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/offers/:id/decline ──────────────────────────────────────────────
// Landlord declines a single offer.
const declineOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Offer not found' });

    if (offer.landlord.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Only the landlord can decline an offer' });

    if (!['pending', 'countered'].includes(offer.status))
      return res.status(400).json({ message: `Offer is already ${offer.status}` });

    offer.status = 'declined';
    await offer.save();

    res.json({ message: 'Offer declined', offer });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── DELETE /api/offers/:id ───────────────────────────────────────────────────
// Tenant withdraws their pending or countered offer.
const withdrawOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Offer not found' });

    if (offer.tenant.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorised' });

    if (!['pending', 'countered'].includes(offer.status))
      return res.status(400).json({ message: `Cannot withdraw — offer is already ${offer.status}` });

    // Mark as withdrawn (keeps it in history) instead of hard-deleting
    offer.status = 'withdrawn';
    await offer.save();
    res.json({ message: 'Offer withdrawn' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getOffers, getOfferById, createOffer, counterOffer, acceptOffer, declineOffer, withdrawOffer };