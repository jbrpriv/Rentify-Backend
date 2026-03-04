const AgreementTemplate = require('../models/AgreementTemplate');
const Clause            = require('../models/Clause');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const populate = (q) =>
  q
    .populate('landlord',   'name email')
    .populate('clauseIds',  'title body category jurisdiction isApproved')
    .populate('reviewedBy', 'name email');

// ─── GET /api/agreement-templates ────────────────────────────────────────────
// Landlord → own templates (all statuses)
// Admin    → every template on the platform
const getTemplates = async (req, res) => {
  try {
    const filter = { isArchived: false };

    if (req.user.role === 'admin') {
      // Admin sees all — optional landlordId filter via query
      if (req.query.landlordId) filter.landlord = req.query.landlordId;
      if (req.query.status)     filter.status   = req.query.status;
    } else {
      // Landlord sees only their own
      filter.landlord = req.user._id;
    }

    // ── Jurisdiction / region filter ────────────────────────────────────────
    if (req.query.jurisdiction) {
      filter.jurisdiction = req.query.jurisdiction;
    }

    const templates = await populate(
      AgreementTemplate.find(filter).sort('-createdAt')
    );

    // Include jurisdiction list for UI filter dropdowns
    const allJurisdictions = await AgreementTemplate.distinct('jurisdiction', { isArchived: false });

    res.json({ templates, jurisdictions: allJurisdictions.filter(Boolean).sort() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/agreement-templates/:id ────────────────────────────────────────
const getTemplateById = async (req, res) => {
  try {
    const template = await populate(AgreementTemplate.findById(req.params.id));
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const isOwner = template.landlord._id.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorised' });
    }

    res.json(template);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/agreement-templates ───────────────────────────────────────────
// Landlord creates a new template. Saved as 'pending' — admin must approve
// before it can be used in offer acceptance.
const createTemplate = async (req, res) => {
  try {
    if (!['landlord', 'property_manager'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only landlords can create agreement templates' });
    }

    const { name, description, clauseIds } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Template name is required' });
    }

    // Validate that every clauseId either belongs to the approved pool
    // or was created by this landlord (their own pending suggestions)
    const ids = Array.isArray(clauseIds) ? clauseIds : [];

    if (ids.length > 0) {
      const validClauses = await Clause.find({
        _id:        { $in: ids },
        isArchived: false,
        $or: [
          { isApproved: true },
          { createdBy: req.user._id },
        ],
      }).select('_id');

      const validIds = new Set(validClauses.map((c) => c._id.toString()));
      const invalid  = ids.filter((id) => !validIds.has(id.toString()));

      if (invalid.length > 0) {
        return res.status(400).json({
          message: `Some clause IDs are invalid or not accessible: ${invalid.join(', ')}`,
        });
      }
    }

    const template = await AgreementTemplate.create({
      landlord:     req.user._id,
      name:         name.trim(),
      description:  (description || '').trim(),
      clauseIds:    ids,
      status:       'pending',
      jurisdiction: (req.body.jurisdiction || 'general').trim().toLowerCase(),
    });

    const populated = await populate(AgreementTemplate.findById(template._id));
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/agreement-templates/:id ────────────────────────────────────────
// Landlord edits their own template. Editing resets status to 'pending'
// so admin reviews changes.
const updateTemplate = async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });

    if (template.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorised' });
    }

    const { name, description, clauseIds } = req.body;

    if (name)        template.name        = name.trim();
    if (description !== undefined) template.description = description.trim();

    if (Array.isArray(clauseIds)) {
      // Re-validate clauses
      if (clauseIds.length > 0) {
        const validClauses = await Clause.find({
          _id:        { $in: clauseIds },
          isArchived: false,
          $or: [
            { isApproved: true },
            { createdBy: req.user._id },
          ],
        }).select('_id');

        const validIds = new Set(validClauses.map((c) => c._id.toString()));
        const invalid  = clauseIds.filter((id) => !validIds.has(id.toString()));
        if (invalid.length > 0) {
          return res.status(400).json({ message: `Invalid clause IDs: ${invalid.join(', ')}` });
        }
      }

      template.clauseIds = clauseIds;
    }

    // Reset to pending so admin re-reviews changes
    template.status          = 'pending';
    template.reviewedBy      = null;
    template.reviewedAt      = null;
    template.rejectionReason = '';

    await template.save();
    const populated = await populate(AgreementTemplate.findById(template._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── DELETE /api/agreement-templates/:id ─────────────────────────────────────
// Landlord deletes their own template. Admin can delete any.
const deleteTemplate = async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const isOwner = template.landlord.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorised' });
    }

    // Soft-delete so historical agreements retain reference context
    template.isArchived = true;
    await template.save();

    res.json({ message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── PUT /api/agreement-templates/:id/review ─────────────────────────────────
// Admin approves or rejects a template.
const reviewTemplate = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }

    const { approved, rejectionReason } = req.body;

    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });

    template.status          = approved ? 'approved' : 'rejected';
    template.reviewedBy      = req.user._id;
    template.reviewedAt      = new Date();
    template.rejectionReason = approved ? '' : (rejectionReason || 'Not approved');

    await template.save();
    const populated = await populate(AgreementTemplate.findById(template._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc    Increment usage count when a template is used to create an agreement
// @route   POST /api/agreement-templates/:id/use
// @access  Private (landlord / admin)
const useTemplate = async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });

    template.usageCount = (template.usageCount || 0) + 1;
    template.lastUsedAt  = new Date();
    await template.save();

    res.json({ message: 'Usage recorded', usageCount: template.usageCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc    Get template usage analytics (admin only)
// @route   GET /api/agreement-templates/analytics
// @access  Private (admin)
const getTemplateAnalytics = async (req, res) => {
  try {
    const templates = await AgreementTemplate.find({ isArchived: false })
      .select('name jurisdiction usageCount lastUsedAt status createdAt')
      .sort('-usageCount');

    const byJurisdiction = templates.reduce((acc, t) => {
      const j = t.jurisdiction || 'general';
      acc[j] = (acc[j] || 0) + t.usageCount;
      return acc;
    }, {});

    res.json({
      totalTemplates:  templates.length,
      totalUsage:      templates.reduce((s, t) => s + (t.usageCount || 0), 0),
      topTemplates:    templates.slice(0, 10),
      byJurisdiction,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  reviewTemplate,
  useTemplate,
  getTemplateAnalytics,
};
