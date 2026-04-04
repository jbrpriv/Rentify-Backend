const AgreementTemplate = require('../models/AgreementTemplate');
const PdfTheme = require('../models/PdfTheme');
const { generateAgreementPDFBuffer } = require('../utils/pdfGenerator');

const normalizeTier = (tier) => (
  ['free', 'pro', 'enterprise'].includes(String(tier || '').trim().toLowerCase())
    ? String(tier).trim().toLowerCase()
    : 'free'
);

const ensureTemplateStudioAccess = (req, res) => {
  if (req.user?.role === 'admin') return true;

  if (req.user?.role !== 'landlord') {
    res.status(403).json({ message: 'Only landlords on the Enterprise plan can manage agreement templates' });
    return false;
  }

  const subscriptionTier = normalizeTier(req.user?.subscriptionTier);
  if (subscriptionTier !== 'enterprise') {
    res.status(403).json({ message: 'Agreement template studio is available on the Enterprise plan only' });
    return false;
  }

  return true;
};

const ALLOWED_FONTS = ['Helvetica', 'Times-Roman', 'Courier'];

const populateTemplate = (q) =>
  q
    .populate('landlord', 'name email')
    .populate('baseTheme')
    .populate('reviewedBy', 'name email');

function normalizeCustomizations(input = {}) {
  return {
    primaryColor: typeof input.primaryColor === 'string' ? input.primaryColor : '',
    accentColor: typeof input.accentColor === 'string' ? input.accentColor : '',
    backgroundColor: typeof input.backgroundColor === 'string' ? input.backgroundColor : '',
    fontFamily: ALLOWED_FONTS.includes(input.fontFamily) ? input.fontFamily : '',
    fontSizeScale:
      typeof input.fontSizeScale === 'number'
        ? Math.min(1.4, Math.max(0.8, input.fontSizeScale))
        : 1.0,
  };
}

function normalizeStandardClauses(input = {}) {
  return {
    maintenance: typeof input.maintenance === 'string' ? input.maintenance.trim() : '',
    subletting: typeof input.subletting === 'string' ? input.subletting.trim() : '',
    entry: typeof input.entry === 'string' ? input.entry.trim() : '',
    damage: typeof input.damage === 'string' ? input.damage.trim() : '',
    repairs: typeof input.repairs === 'string' ? input.repairs.trim() : '',
  };
}

const getTemplates = async (req, res) => {
  try {
    if (!ensureTemplateStudioAccess(req, res)) return;

    const filter = { isArchived: false };

    if (req.user.role === 'admin') {
      if (req.query.landlordId) filter.landlord = req.query.landlordId;
      if (req.query.status) filter.status = req.query.status;
    } else {
      filter.landlord = req.user._id;
    }

    const templates = await populateTemplate(AgreementTemplate.find(filter).sort('-createdAt'));
    res.json(templates);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getTemplateById = async (req, res) => {
  try {
    if (!ensureTemplateStudioAccess(req, res)) return;

    const template = await populateTemplate(AgreementTemplate.findById(req.params.id));
    if (!template || template.isArchived) return res.status(404).json({ message: 'Template not found' });

    const isOwner = template.landlord._id.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorised' });
    }

    res.json(template);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAvailableTemplates = async (req, res) => {
  try {
    const subscriptionTier = normalizeTier(req.user?.subscriptionTier);
    const canUseAgreementTemplates = subscriptionTier === 'enterprise';
    const canSelectPdfThemes = subscriptionTier === 'enterprise';

    const templates = canUseAgreementTemplates
      ? await populateTemplate(
        AgreementTemplate.find({
          landlord: req.user._id,
          status: 'approved',
          isArchived: false,
        }).sort('-updatedAt')
      )
      : [];

    const themes = canSelectPdfThemes
      ? await PdfTheme.find({ isGlobal: true }).sort({ name: 1 })
      : [];

    res.json({ templates, themes, capabilities: { canUseAgreementTemplates, canSelectPdfThemes } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createTemplate = async (req, res) => {
  try {
    if (!ensureTemplateStudioAccess(req, res)) return;

    if (!['landlord', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only landlords or admins can create agreement templates' });
    }

    const { name, description, jurisdiction, baseTheme } = req.body;
    if (!name || !baseTheme) {
      return res.status(400).json({ message: 'name and baseTheme are required' });
    }

    const baseThemeDoc = await PdfTheme.findById(baseTheme).select('_id');
    if (!baseThemeDoc) {
      return res.status(404).json({ message: 'Base theme not found' });
    }

    const template = await AgreementTemplate.create({
      landlord: req.user._id,
      name: name.trim(),
      description: (description || '').trim(),
      jurisdiction: (jurisdiction || 'general').trim().toLowerCase(),
      baseTheme,
      customizations: normalizeCustomizations(req.body.customizations),
      standardClauses: normalizeStandardClauses(req.body.standardClauses),
      status: req.user.role === 'admin' ? 'approved' : 'pending',
      reviewedBy: req.user.role === 'admin' ? req.user._id : null,
      reviewedAt: req.user.role === 'admin' ? new Date() : null,
    });

    const populated = await populateTemplate(AgreementTemplate.findById(template._id));
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateTemplate = async (req, res) => {
  try {
    if (!ensureTemplateStudioAccess(req, res)) return;

    const template = await AgreementTemplate.findById(req.params.id);
    if (!template || template.isArchived) return res.status(404).json({ message: 'Template not found' });

    if (template.landlord.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorised' });
    }

    if (!['pending', 'rejected'].includes(template.status)) {
      return res.status(400).json({ message: 'Only pending or rejected templates can be edited' });
    }

    const { name, description, jurisdiction, baseTheme } = req.body;

    if (name !== undefined) template.name = name.trim();
    if (description !== undefined) template.description = description.trim();
    if (jurisdiction !== undefined) template.jurisdiction = jurisdiction.trim().toLowerCase();

    if (baseTheme !== undefined) {
      const baseThemeDoc = await PdfTheme.findById(baseTheme).select('_id');
      if (!baseThemeDoc) return res.status(404).json({ message: 'Base theme not found' });
      template.baseTheme = baseTheme;
    }

    if (req.body.customizations !== undefined) {
      template.customizations = normalizeCustomizations(req.body.customizations);
    }

    if (req.body.standardClauses !== undefined) {
      template.standardClauses = normalizeStandardClauses(req.body.standardClauses);
    }

    if (template.status === 'rejected') {
      template.status = 'pending';
      template.reviewedBy = null;
      template.reviewedAt = null;
      template.rejectionReason = '';
    }

    await template.save();
    const populated = await populateTemplate(AgreementTemplate.findById(template._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    if (!ensureTemplateStudioAccess(req, res)) return;

    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const isOwner = template.landlord.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorised' });
    }

    template.isArchived = true;
    await template.save();

    res.json({ message: 'Template archived' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const previewTemplatePDF = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }

    const template = await populateTemplate(
      AgreementTemplate.findById(req.params.id)
    );

    if (!template || template.isArchived) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + 12);

    const sampleAgreement = {
      _id: template._id,
      agreementTemplate: template,
      term: {
        startDate: now,
        endDate: end,
        durationMonths: 12,
      },
      financials: {
        rentAmount: 1200,
        depositAmount: 1200,
        lateFeeAmount: 35,
        lateFeeGracePeriodDays: 5,
      },
      utilitiesIncluded: false,
      utilitiesDetails: 'Electricity and internet are tenant responsibility.',
      petPolicy: { allowed: false, deposit: 0 },
      terminationPolicy: '30-day written notice required for termination.',
      clauseSet: [],
      signatures: {
        landlord: { signed: false },
        tenant: { signed: false },
      },
      rentEscalation: { enabled: false, percentage: 0 },
    };

    const sampleLandlord = {
      name: template.landlord?.name || 'Sample Landlord',
      email: template.landlord?.email || 'landlord@example.com',
    };

    const sampleTenant = {
      name: 'Sample Tenant',
      email: 'tenant@example.com',
    };

    const sampleProperty = {
      title: 'Sample Property',
      address: {
        street: '123 Main Street',
        city: 'Sample City',
        state: 'Sample State',
      },
      financials: {
        maintenanceFee: 50,
      },
    };

    const pdfBuffer = await generateAgreementPDFBuffer(
      sampleAgreement,
      sampleLandlord,
      sampleTenant,
      sampleProperty,
      { currency: 'USD' }
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=template-preview-${template._id}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const approveTemplate = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }

    const template = await AgreementTemplate.findById(req.params.id);
    if (!template || template.isArchived) return res.status(404).json({ message: 'Template not found' });

    template.status = 'approved';
    template.reviewedBy = req.user._id;
    template.reviewedAt = new Date();
    template.rejectionReason = '';

    await template.save();

    const populated = await populateTemplate(AgreementTemplate.findById(template._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const rejectTemplate = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }

    const { rejectionReason } = req.body;
    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({ message: 'rejectionReason is required' });
    }

    const template = await AgreementTemplate.findById(req.params.id);
    if (!template || template.isArchived) return res.status(404).json({ message: 'Template not found' });

    template.status = 'rejected';
    template.reviewedBy = req.user._id;
    template.reviewedAt = new Date();
    template.rejectionReason = rejectionReason.trim();

    await template.save();

    const populated = await populateTemplate(AgreementTemplate.findById(template._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const reviewTemplate = async (req, res) => {
  const { approved, rejectionReason } = req.body;
  req.body = approved
    ? {}
    : { rejectionReason: rejectionReason || '' };

  if (approved) {
    return approveTemplate(req, res);
  }

  return rejectTemplate(req, res);
};

const useTemplate = async (req, res) => {
  try {
    if (!ensureTemplateStudioAccess(req, res)) return;

    const template = await AgreementTemplate.findById(req.params.id);
    if (!template || template.isArchived) return res.status(404).json({ message: 'Template not found' });

    template.usageCount = (template.usageCount || 0) + 1;
    template.lastUsedAt = new Date();
    await template.save();

    res.json({ message: 'Usage recorded', usageCount: template.usageCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

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
      totalTemplates: templates.length,
      totalUsage: templates.reduce((s, t) => s + (t.usageCount || 0), 0),
      topTemplates: templates.slice(0, 10),
      byJurisdiction,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getTemplates,
  getTemplateById,
  getAvailableTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplatePDF,
  approveTemplate,
  rejectTemplate,
  reviewTemplate,
  useTemplate,
  getTemplateAnalytics,
};
