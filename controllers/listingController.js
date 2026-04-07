const Property = require('../models/Property');
const Agreement = require('../models/Agreement');
const { sendEmail } = require('../utils/emailService');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let Offer, Application;
try { Offer = require('../models/Offer'); } catch { Offer = null; }
try { Application = require('../models/Application'); } catch { Application = null; }

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────────────────────────────────────

// @route GET /api/listings
const getPublicListings = async (req, res) => {
  try {
    const { city, type, minRent, maxRent } = req.query;
    const hasPaginationParams = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 15));
    const skip = (page - 1) * limit;

    const filter = { isListed: true, status: 'vacant' };
    if (city) filter['address.city'] = { $regex: new RegExp(escapeRegex(city), 'i') };
    if (type) filter.type = type;
    if (minRent || maxRent) {
      filter['financials.monthlyRent'] = {};
      if (minRent) filter['financials.monthlyRent'].$gte = Number(minRent);
      if (maxRent) filter['financials.monthlyRent'].$lte = Number(maxRent);
    }

    if (!hasPaginationParams) {
      const legacyListings = await Property.find(filter)
        .populate('landlord', 'name email profilePhoto documentsVerified')
        .select('-applications')
        .sort('-createdAt');

      return res.json(legacyListings);
    }

    const [listings, total] = await Promise.all([
      Property.find(filter)
        .populate('landlord', 'name email profilePhoto documentsVerified')
        .select('-applications')
        .sort('-createdAt')
        .skip(skip)
        .limit(limit),
      Property.countDocuments(filter),
    ]);

    res.json({
      listings,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @route GET /api/listings/:id
// Atomically increments the real view counter on every public fetch.
const getListingById = async (req, res) => {
  try {
    const property = await Property.findOneAndUpdate(
      { _id: req.params.id, isListed: true },
      { $inc: { views: 1 } },
      { returnDocument: 'after' }
    ).populate('landlord', 'name email profilePhoto documentsVerified');

    if (!property) {
      return res.status(404).json({ message: 'Listing not found or not publicly listed' });
    }
    res.json(property);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED OFFER — all three types in one wizard submission
// POST /api/listings/:id/offer
// Body: { rentOffer, securityOffer, maintenanceOffer }
// ─────────────────────────────────────────────────────────────────────────────
const submitOffer = async (req, res) => {
  if (!Offer) return res.status(503).json({ message: 'Offer feature not available.' });

  try {
    if (req.user.role !== 'tenant') {
      return res.status(403).json({ message: 'Only tenants can submit offers' });
    }

    const property = await Property.findById(req.params.id)
      .populate('landlord', 'name email profilePhoto documentsVerified');

    if (!property || !property.isListed) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (property.status !== 'vacant') {
      return res.status(400).json({ message: 'This property is no longer available' });
    }
    if (property.landlord._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot submit an offer on your own property' });
    }

    const { rentOffer = {}, securityOffer = {}, maintenanceOffer = {} } = req.body;

    const base = {
      property: property._id,
      landlord: property.landlord._id,
      tenant: req.user._id,
      applicantDetails: { name: req.user.name, email: req.user.email, phone: req.user.phoneNumber },
    };

    const created = [];
    const skipped = [];

    // Rent Offer
    try {
      created.push(await Offer.create({
        ...base, offerType: 'rent',
        message: (rentOffer.message || '').slice(0, 2000),
        proposedTerms: { monthlyRent: rentOffer.proposed ? Number(rentOffer.proposed) : null },
      }));
    } catch (e) {
      if (e.code === 11000) skipped.push('rent');
      else throw e;
    }

    // Security Offer
    try {
      created.push(await Offer.create({
        ...base, offerType: 'security',
        message: (securityOffer.message || '').slice(0, 2000),
        proposedTerms: { securityDeposit: securityOffer.proposed ? Number(securityOffer.proposed) : null },
      }));
    } catch (e) {
      if (e.code === 11000) skipped.push('security');
      else throw e;
    }

    // Maintenance Offer — only if tenant provided a scope
    if ((maintenanceOffer.scope || '').trim()) {
      try {
        created.push(await Offer.create({
          ...base, offerType: 'maintenance',
          message: (maintenanceOffer.message || '').slice(0, 2000),
          proposedTerms: {
            maintenanceScope: maintenanceOffer.scope.slice(0, 1000),
            rentReductionRequested: maintenanceOffer.reduction ? Number(maintenanceOffer.reduction) : null,
          },
        }));
      } catch (e) {
        if (e.code === 11000) skipped.push('maintenance');
        else throw e;
      }
    }

    if (created.length === 0) {
      return res.status(400).json({ message: 'All offer types have already been submitted for this property.', skipped });
    }

    // Sync one entry into Property.applications array
    const alreadyInArray = property.applications.some(
      a => a.tenant.toString() === req.user._id.toString()
    );
    if (!alreadyInArray) {
      property.applications.push({
        tenant: req.user._id,
        message: `[COMBINED OFFER] Rent: ${rentOffer.proposed || 'listed'} | Deposit: ${securityOffer.proposed || 'listed'}`.slice(0, 500),
        status: 'pending',
        createdAt: new Date(),
      });
      await property.save();
    }

    sendEmail(property.landlord.email, 'newApplication', property.landlord.name, req.user.name, property.title);

    res.status(201).json({ message: `${created.length} offer(s) submitted successfully`, offers: created, skipped });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LANDLORD SCREENING
// ─────────────────────────────────────────────────────────────────────────────
const getLandlordOffers = async (req, res) => {
  if (!Offer) return res.status(503).json({ message: 'Offer feature not available.' });
  try {
    if (!['landlord', 'admin'].includes(req.user.role)) return res.status(403).json({ message: 'Access denied' });
    const filter = req.user.role === 'admin' ? {} : { landlord: req.user._id };
    const offers = await Offer.find(filter)
      .populate('tenant', 'name email phoneNumber profilePhoto')
      .populate('landlord', 'name email profilePhoto documentsVerified')
      .populate('property', 'title address financials status images')
      .sort('-createdAt');
    const grouped = {};
    for (const offer of offers) {
      const pid = offer.property?._id?.toString();
      if (!pid) continue;
      if (!grouped[pid]) grouped[pid] = { property: offer.property, offers: [] };
      grouped[pid].offers.push(offer);
    }
    res.json({ offers, grouped: Object.values(grouped) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateOfferStatus = async (req, res) => {
  if (!Offer) return res.status(503).json({ message: 'Offer feature not available.' });
  try {
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ message: 'Status must be accepted or rejected' });
    const offer = await Offer.findById(req.params.id)
      .populate('tenant', 'name email').populate('property', 'title financials leaseTerms').populate('landlord', 'name email profilePhoto documentsVerified');
    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    if (req.user.role !== 'admin' && offer.landlord._id.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });

    offer.status = status;
    if (status === 'accepted') {
      const dur = offer.property.leaseTerms?.defaultDurationMonths || 12;
      const start = new Date(), end = new Date(start);
      end.setMonth(start.getMonth() + dur);
      const agreement = await Agreement.create({
        landlord: req.user.role === 'admin' ? offer.landlord._id : req.user._id,
        tenant: offer.tenant._id, property: offer.property._id,
        term: { startDate: start, endDate: end, durationMonths: dur },
        financials: {
          rentAmount: offer.offerType === 'rent' && offer.proposedTerms?.monthlyRent ? offer.proposedTerms.monthlyRent : offer.property.financials.monthlyRent,
          depositAmount: offer.offerType === 'security' && offer.proposedTerms?.securityDeposit ? offer.proposedTerms.securityDeposit : offer.property.financials.securityDeposit,
          lateFeeAmount: offer.property.financials.lateFeeAmount || 0,
          lateFeeGracePeriodDays: offer.property.financials.lateFeeGracePeriodDays || 5,
        },
        auditLog: [{ action: 'CREATED_FROM_OFFER', actor: req.user._id, details: `From ${offer.offerType} offer ${offer._id}` }],
      });
      offer.agreement = agreement._id;
      const prop = await Property.findById(offer.property._id);
      if (prop) { const e = prop.applications.find(a => a.tenant.toString() === offer.tenant._id.toString()); if (e) { e.status = 'accepted'; await prop.save(); } }
      sendEmail(offer.tenant.email, 'applicationAccepted', offer.tenant.name, offer.property.title);
    }
    if (status === 'rejected') {
      const prop = await Property.findById(offer.property._id);
      if (prop) { const e = prop.applications.find(a => a.tenant.toString() === offer.tenant._id.toString()); if (e) { e.status = 'rejected'; await prop.save(); } }
      sendEmail(offer.tenant.email, 'applicationRejected', offer.tenant.name, offer.property.title);
    }
    await offer.save();
    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const toggleListingPublish = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property || property.landlord.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });
    property.isListed = !property.isListed;
    if (req.body.listingDescription) property.listingDescription = req.body.listingDescription;
    await property.save();
    res.json({ message: property.isListed ? 'Property is now publicly listed' : 'Property unlisted', isListed: property.isListed });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Legacy aliases
const getLandlordApplications = getLandlordOffers;
const updateApplicationStatus = updateOfferStatus;
const applyForListing = async (req, res) => {
  req.body.rentOffer = { message: req.body.message || '', proposed: '' };
  req.body.securityOffer = {};
  req.body.maintenanceOffer = {};
  return submitOffer(req, res);
};

module.exports = {
  getPublicListings, getListingById,
  submitOffer, getLandlordOffers, updateOfferStatus, toggleListingPublish,
  applyForListing, getLandlordApplications, updateApplicationStatus,
};