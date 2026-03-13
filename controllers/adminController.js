const User = require('../models/User');
const Property = require('../models/Property');
const Agreement = require('../models/Agreement');
const Payment = require('../models/Payment');
const Clause = require('../models/Clause');
const MaintenanceRequest = require('../models/MaintenanceRequest');
const logger = require('../utils/logger');

// Revenue amounts for MRR calculation (cents). Sourced from env vars so they
// stay in sync with the billing plans without any hardcoded numbers here.
const MRR_CENTS = {
  pro: parseInt(process.env.PLAN_PRICE_PRO_CENTS || '1500', 10),
  enterprise: parseInt(process.env.PLAN_PRICE_ENTERPRISE_CENTS || '3000', 10),
};

// @desc    Get platform-wide stats
// @route   GET /api/admin/stats
// @access  Private (Admin)
const getStats = async (req, res) => {
  try {
    // Revenue approximations for stats calculation (not Stripe price IDs)
    const PLAN_REVENUE = MRR_CENTS; // Pro=$15/mo, Enterprise=$30/mo

    const [
      totalUsers,
      totalPro,
      totalEnterprise,
      totalProperties,
      totalAgreements,
      activeAgreements,
      pendingAgreements,
      expiredAgreements,
      openMaintenanceRequests,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ subscriptionTier: 'pro' }),
      User.countDocuments({ subscriptionTier: 'enterprise' }),
      Property.countDocuments(),
      Agreement.countDocuments(),
      Agreement.countDocuments({ status: 'active' }),
      Agreement.countDocuments({ status: { $in: ['draft', 'sent', 'signed'] } }),
      Agreement.countDocuments({ status: 'expired' }),
      MaintenanceRequest.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    ]);

    // Divide by 100 to convert from cents to dollars before sending to client
    const monthlySubscriptionRevenue =
      Math.round(((totalPro * PLAN_REVENUE.pro) + (totalEnterprise * PLAN_REVENUE.enterprise)) / 100);

    const usersBySubscription = await User.aggregate([
      { $group: { _id: { $ifNull: ['$subscriptionTier', 'free'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const agreementsByMonth = await Agreement.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    res.json({
      totals: {
        users: totalUsers,
        pro: totalPro,
        enterprise: totalEnterprise,
        free: Math.max(0, totalUsers - totalPro - totalEnterprise),
        properties: totalProperties,
        agreements: totalAgreements,
        activeAgreements,
        pendingAgreements,
        expiredAgreements,
        openMaintenanceRequests,
      },
      monthlySubscriptionRevenue,
      usersBySubscription,
      agreementsByMonth,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get all users with filtering
// @route   GET /api/admin/users
// @access  Private (Admin)
const getUsers = async (req, res) => {
  try {
    const { role, isActive, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password -otpCode -otpExpiry -fcmToken -passwordResetToken -emailVerificationToken')
        .sort('-createdAt')
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    res.json({
      users,
      pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get single user by ID
// @route   GET /api/admin/users/:id
// @access  Private (Admin)
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -otpCode -otpExpiry -fcmToken -passwordResetToken -emailVerificationToken');

    if (!user) return res.status(404).json({ message: 'User not found' });

    const [agreements, properties] = await Promise.all([
      Agreement.find({ $or: [{ landlord: user._id }, { tenant: user._id }] })
        .select('status term financials property')
        .populate('property', 'title'),
      Property.find({ landlord: user._id }).select('title status isListed'),
    ]);

    res.json({ user, agreements, properties });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Ban or unban a user
// @route   PUT /api/admin/users/:id/ban
// @access  Private (Admin)
const toggleUserBan = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot ban your own account' });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      message: user.isActive ? 'User account reactivated' : 'User account suspended',
      isActive: user.isActive,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Change a user's role
// @route   PUT /api/admin/users/:id/role
// @access  Private (Admin)
const changeUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['landlord', 'tenant', 'admin', 'property_manager', 'law_reviewer'];

    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { returnDocument: 'after' }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ message: `Role updated to ${role}`, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get all agreements platform-wide
// @route   GET /api/admin/agreements
// @access  Private (Admin)
// @query   status= | search= (landlord/tenant/property name) | page= | limit=
const getAllAgreements = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const filter = {};
    if (status) filter.status = status;

    const agreements = await Agreement.find(filter)
      .populate('landlord', 'name email')
      .populate('tenant', 'name email')
      .populate('property', 'title address')
      .sort('-createdAt')
      .limit(safeLimit);

    let result = agreements;
    if (search) {
      const q = search.toLowerCase();
      result = agreements.filter((a) =>
        a.landlord?.name?.toLowerCase().includes(q) ||
        a.tenant?.name?.toLowerCase().includes(q) ||
        a.property?.title?.toLowerCase().includes(q)
      );
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get platform-wide audit log (from all agreements)
// @route   GET /api/admin/audit-logs
// @access  Private (Admin)
const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const facetResult = await Agreement.aggregate([
      { $unwind: '$auditLog' },
      ...(action ? [{ $match: { 'auditLog.action': action } }] : []),
      { $sort: { 'auditLog.timestamp': -1 } },
      {
        $facet: {
          logs: [
            { $skip: skip },
            { $limit: Number(limit) },
            {
              $project: {
                action: '$auditLog.action',
                actor: '$auditLog.actor',
                timestamp: '$auditLog.timestamp',
                ipAddress: '$auditLog.ipAddress',
                details: '$auditLog.details',
                agreementId: '$_id',
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ]);

    const logs = facetResult[0]?.logs || [];
    const total = facetResult[0]?.totalCount[0]?.count || 0;

    res.json({
      logs,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ─── Clause / Template Management ─────────────────────────────────────────────

// @desc    Get all clauses
// @route   GET /api/admin/clauses
// @access  Private (Admin, Law Reviewer)
const getClauses = async (req, res) => {
  try {
    const { category, isApproved, isArchived = false } = req.query;
    const filter = { isArchived: isArchived === 'true' };

    if (category) filter.category = category;
    if (isApproved !== undefined) filter.isApproved = isApproved === 'true';

    const clauses = await Clause.find(filter)
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .sort('-createdAt');

    res.json(clauses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Create a new clause template
// @route   POST /api/admin/clauses
// @access  Private (Admin, Law Reviewer)
const createClause = async (req, res) => {
  try {
    const { title, body, category, jurisdiction, isDefault, condition } = req.body;

    const clause = await Clause.create({
      title,
      body,
      category: category || 'general',
      jurisdiction: jurisdiction || 'Pakistan',
      isDefault: isDefault || false,
      condition: condition || null,    // [FIX #4]
      createdBy: req.user._id,
    });

    res.status(201).json(clause);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Approve or reject a clause
// @route   PUT /api/admin/clauses/:id/approve
// @access  Private (Admin, Law Reviewer)
const reviewClause = async (req, res) => {
  try {
    const { approved, rejectionReason } = req.body;

    const clause = await Clause.findById(req.params.id);
    if (!clause) return res.status(404).json({ message: 'Clause not found' });

    clause.isApproved = approved;
    clause.approvedBy = approved ? req.user._id : null;
    clause.approvedAt = approved ? new Date() : null;
    clause.rejectionReason = approved ? '' : (rejectionReason || 'Not approved');

    await clause.save();
    res.json(clause);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Archive a clause
// @route   PUT /api/admin/clauses/:id/archive
// @access  Private (Admin)
const archiveClause = async (req, res) => {
  try {
    const clause = await Clause.findByIdAndUpdate(
      req.params.id,
      { isArchived: true, isLatestVersion: false },
      { returnDocument: 'after' }
    );
    if (!clause) return res.status(404).json({ message: 'Clause not found' });
    res.json({ message: 'Clause archived', clause });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get all properties with tenant info
// @route   GET /api/admin/properties
// @access  Private (Admin)
// @query   search= (title, landlord name, city)
const getAllProperties = async (req, res) => {
  try {
    const { search } = req.query;
    const filter = {};
    if (search) {
      const re = { $regex: search, $options: 'i' };
      filter.$or = [
        { title: re },
        { 'address.city': re },
      ];
    }

    const properties = await Property.find(filter)
      .populate('landlord', 'name email')
      .populate('managedBy', 'name email')
      .sort({ createdAt: -1 });

    const propIds = properties.map((p) => p._id);
    const activeAgreements = await Agreement.find({
      property: { $in: propIds },
      status: 'active',
    }).populate('tenant', 'name email');

    const tenantMap = {};
    activeAgreements.forEach((ag) => {
      tenantMap[ag.property.toString()] = ag;
    });

    // If search also needs landlord/tenant name filtering (post-populate),
    // apply in memory since those are joined fields from populate.
    let result = properties.map((p) => ({
      ...p.toObject(),
      activeAgreement: tenantMap[p._id.toString()] || null,
    }));

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        (!search) ||
        p.title?.toLowerCase().includes(q) ||
        p.landlord?.name?.toLowerCase().includes(q) ||
        p.address?.city?.toLowerCase().includes(q) ||
        p.activeAgreement?.tenant?.name?.toLowerCase().includes(q)
      );
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Kick tenant from property (terminate agreement)
// @route   POST /api/admin/properties/:id/kick-tenant
// @access  Private (Admin)
const kickTenantFromProperty = async (req, res) => {
  try {
    const { reason } = req.body;
    const propertyId = req.params.id;

    const agreement = await Agreement.findOne({
      property: propertyId,
      status: 'active',
    })
      .populate('tenant', 'name email')
      .populate('property', 'title');

    if (!agreement) {
      return res.status(404).json({ message: 'No active tenant found for this property' });
    }

    agreement.status = 'terminated';
    agreement.auditLog.push({
      action: 'TERMINATED_BY_ADMIN',
      actor: req.user._id,
      ipAddress: req.ip,
      details: reason || 'Terminated by administrator',
    });
    await agreement.save();

    await Property.findByIdAndUpdate(propertyId, { status: 'vacant', isListed: false });

    res.json({ message: `Tenant ${agreement.tenant?.name} has been removed from ${agreement.property?.title}` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Admin deep analytics — revenue, churn, growth, disputes, maintenance
// @route   GET /api/admin/analytics
// @access  Private (Admin)
const getAdminAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);

    const [
      monthlyRentRevenue,
      totalRentRevenue,
      revenueByGateway,
      expiredLast6,
      createdLast6,
      userGrowth,
      disputeStats,
      maintenanceStats,
    ] = await Promise.all([
      Payment.aggregate([
        { $match: { status: 'paid', type: 'rent', paidAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { year: { $year: '$paidAt' }, month: { $month: '$paidAt' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      Payment.aggregate([
        { $match: { status: 'paid', type: 'rent' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: '$gateway', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      Agreement.countDocuments({ status: { $in: ['expired', 'terminated'] }, updatedAt: { $gte: sixMonthsAgo } }),
      Agreement.countDocuments({ createdAt: { $gte: sixMonthsAgo } }),
      User.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      require('../models/Dispute').aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      MaintenanceRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const churnRate = createdLast6 > 0 ? Math.round((expiredLast6 / createdLast6) * 100) : 0;

    res.json({
      monthlyRentRevenue,
      totalRentRevenue: totalRentRevenue[0]?.total || 0,
      revenueByGateway,
      churnRate,
      expiredLast6,
      createdLast6,
      userGrowth,
      disputeStats: disputeStats.reduce((a, d) => { a[d._id] = d.count; return a; }, {}),
      maintenanceStats: maintenanceStats.reduce((a, d) => { a[d._id] = d.count; return a; }, {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Paginated list of all users with billing / subscription details
// @route   GET /api/admin/billing/users
// @access  Private (Admin)
// @query   page=1 | limit=25 | tier=free|pro|enterprise | search=<name or email>
// [FIX #6]
const getBillingUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip = (page - 1) * limit;
    const { tier, search } = req.query;

    // Only landlords have subscriptions
    const filter = { role: 'landlord' };

    if (tier && ['free', 'pro', 'enterprise'].includes(tier)) {
      if (tier === 'free') {
        filter.$or = [
          { subscriptionTier: 'free' },
          { subscriptionTier: { $exists: false } },
          { subscriptionTier: null },
        ];
      } else {
        filter.subscriptionTier = tier;
      }
    }

    if (search) {
      const regex = { $regex: search, $options: 'i' };
      filter.$and = [
        { role: 'landlord' },
        { $or: [{ name: regex }, { email: regex }] },
      ];
      delete filter.role; // moved into $and
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name email subscriptionTier createdAt isActive')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const landlordBase = { role: 'landlord' };
    const [freeCt, proCt, enterpriseCt] = await Promise.all([
      User.countDocuments({ ...landlordBase, $or: [{ subscriptionTier: 'free' }, { subscriptionTier: null }, { subscriptionTier: { $exists: false } }] }),
      User.countDocuments({ ...landlordBase, subscriptionTier: 'pro' }),
      User.countDocuments({ ...landlordBase, subscriptionTier: 'enterprise' }),
    ]);

    res.json({
      users,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
      summary: {
        free: freeCt,
        pro: proCt,
        enterprise: enterpriseCt,
        totalMRR: Math.round(((proCt * MRR_CENTS.pro) + (enterpriseCt * MRR_CENTS.enterprise)) / 100),
      },
    });
  } catch (error) {
    logger.error('getBillingUsers error', { err: error.message });
    res.status(500).json({ message: 'Server error' });
  }
};



// ─── Clause Variable Definitions ──────────────────────────────────────────────
// @desc    Return the full list of available template variables for clause building
// @route   GET /api/admin/clauses/variables
// @access  Private (Admin, Law Reviewer)
//
// These variables exactly mirror the keys produced by clauseSubstitution.js
// buildVariableMap(), so what the admin sees in the UI is guaranteed to match
// what gets substituted when the PDF is generated. No DB query needed —
// the set of variables is static and tied to the Agreement schema.
const CLAUSE_VARIABLES = [
  // Parties
  { key: 'tenantName', label: 'Tenant Name', group: 'Parties', description: 'Full legal name of the tenant' },
  { key: 'landlordName', label: 'Landlord Name', group: 'Parties', description: 'Full legal name of the landlord' },
  // Property
  { key: 'propertyTitle', label: 'Property Title', group: 'Property', description: 'Listing title of the property' },
  { key: 'propertyAddress', label: 'Property Address', group: 'Property', description: 'Full street, city, and state address' },
  // Financials
  { key: 'rentAmount', label: 'Rent Amount', group: 'Financials', description: 'Monthly rent (USD formatted)' },
  { key: 'depositAmount', label: 'Security Deposit', group: 'Financials', description: 'Security deposit amount (USD formatted)' },
  { key: 'lateFeeAmount', label: 'Late Fee Amount', group: 'Financials', description: 'Late fee charged after grace period' },
  { key: 'lateFeeGraceDays', label: 'Late Fee Grace Days', group: 'Financials', description: 'Number of days before late fee is applied' },
  // Term
  { key: 'startDate', label: 'Start Date', group: 'Term', description: 'Lease commencement date' },
  { key: 'endDate', label: 'End Date', group: 'Term', description: 'Lease expiry date' },
  { key: 'durationMonths', label: 'Duration (Months)', group: 'Term', description: 'Total length of the lease in months' },
  { key: 'currentDate', label: 'Current Date', group: 'Term', description: 'Date the agreement document is generated' },
  // Policies
  { key: 'petPolicy', label: 'Pet Policy', group: 'Policies', description: '"Pets allowed" or "No pets"' },
  { key: 'petDeposit', label: 'Pet Deposit', group: 'Policies', description: 'Pet security deposit amount' },
  { key: 'utilities', label: 'Utilities', group: 'Policies', description: '"Utilities included" or "Utilities not included"' },
  { key: 'utilitiesDetails', label: 'Utilities Details', group: 'Policies', description: 'Custom description of included utilities' },
  { key: 'terminationPolicy', label: 'Termination Policy', group: 'Policies', description: 'Termination notice and penalty details' },
  // System
  { key: 'agreementId', label: 'Agreement ID', group: 'System', description: 'Unique system identifier for this agreement' },
];

const getClauseVariables = (req, res) => {
  res.json(CLAUSE_VARIABLES);
};

// ─── Document Verification Admin Functions ─────────────────────────────────
const { getTenantDocumentUrl, isS3Configured } = require('../utils/s3Service');

async function resolveDocUrls(docs = []) {
  if (!isS3Configured()) return docs;
  return Promise.all(docs.map(async (doc) => {
    const d = doc.toObject ? doc.toObject() : { ...doc };
    if (d.url && !d.url.startsWith('http')) {
      d.url = await getTenantDocumentUrl(d.url, 1800); // 30-min signed URL
    }
    return d;
  }));
}

// BUG-12 fix: declared above module.exports so these remain safe if ever
// converted to const arrow functions (hoisting would not apply to those).
async function getPendingVerifications(req, res) {
  try {
    const users = await User.find({ verificationStatus: 'pending' })
      .select('name email role verificationDocuments verificationStatus documentsVerified createdAt');
    const result = await Promise.all(users.map(async (u) => {
      const obj = u.toObject();
      obj.verificationDocuments = await resolveDocUrls(obj.verificationDocuments || []);
      return obj;
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ message: err.message }); }
}

async function getApprovedVerifications(req, res) {
  try {
    const users = await User.find({ verificationStatus: 'approved' })
      .select('name email role verificationDocuments verificationStatus documentsVerified createdAt');
    const result = await Promise.all(users.map(async (u) => {
      const obj = u.toObject();
      obj.verificationDocuments = await resolveDocUrls(obj.verificationDocuments || []);
      return obj;
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ message: err.message }); }
}

async function approveVerification(req, res) {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.verificationStatus = 'approved';
    user.documentsVerified = true;
    await user.save();
    res.json({ message: 'User documents approved successfully' });
  } catch (err) { res.status(500).json({ message: err.message }); }
}

async function rejectVerification(req, res) {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.verificationStatus = 'rejected';
    user.documentsVerified = false;
    await user.save();
    res.json({ message: 'User documents rejected' });
  } catch (err) { res.status(500).json({ message: err.message }); }
}

module.exports = {
  getStats,
  getUsers,
  getUserById,
  toggleUserBan,
  changeUserRole,
  getAllAgreements,
  getAuditLogs,
  getClauses,
  createClause,
  reviewClause,
  archiveClause,
  getAllProperties,
  kickTenantFromProperty,
  getAdminAnalytics,
  getBillingUsers,
  getPendingVerifications,
  getApprovedVerifications,
  approveVerification,
  rejectVerification,
  getClauseVariables,
};