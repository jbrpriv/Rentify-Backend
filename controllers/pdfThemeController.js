const PdfTheme = require('../models/PdfTheme');
const { generateAgreementPDFBuffer } = require('../utils/pdfGenerator');
const logger = require('../utils/logger');

const ALLOWED_FONTS = ['Helvetica', 'Times-Roman', 'Courier'];

function buildThemeOverrides(input = {}) {
  const out = {};

  if (typeof input.primaryColor === 'string') out.primaryColor = input.primaryColor;
  if (typeof input.accentColor === 'string') out.accentColor = input.accentColor;
  if (typeof input.backgroundColor === 'string') out.backgroundColor = input.backgroundColor;
  if (typeof input.description === 'string') out.description = input.description.trim();

  if (typeof input.fontFamily === 'string' && ALLOWED_FONTS.includes(input.fontFamily)) {
    out.fontFamily = input.fontFamily;
  }

  if (input.fontSizeScale !== undefined) {
    const value = Number(input.fontSizeScale);
    if (!Number.isNaN(value)) {
      out.fontSizeScale = Math.min(1.4, Math.max(0.8, value));
    }
  }

  return out;
}

const getPdfThemes = async (req, res) => {
  try {
    const themes = await PdfTheme.find({ isGlobal: true }).sort({ name: 1 });
    res.json(themes);
  } catch (err) {
    logger.error('getPdfThemes error', { message: err.message });
    res.status(500).json({ message: 'Server error fetching themes' });
  }
};

const updatePdfTheme = async (req, res) => {
  try {
    const theme = await PdfTheme.findById(req.params.id);
    if (!theme) return res.status(404).json({ message: 'Theme not found' });

    Object.assign(theme, buildThemeOverrides(req.body));
    await theme.save();

    res.json(theme);
  } catch (err) {
    logger.error('updatePdfTheme error', { message: err.message });
    res.status(500).json({ message: 'Server error updating theme' });
  }
};

const setDefaultTheme = async (req, res) => {
  try {
    const theme = await PdfTheme.findById(req.params.id);
    if (!theme) return res.status(404).json({ message: 'Theme not found' });

    await PdfTheme.updateMany({ isDefault: true }, { isDefault: false });

    theme.isDefault = true;
    await theme.save();

    res.json({ message: `"${theme.name}" is now the global default PDF theme.`, theme });
  } catch (err) {
    logger.error('setDefaultTheme error', { message: err.message });
    res.status(500).json({ message: 'Server error updating default theme' });
  }
};

const setReceiptDefaultTheme = async (req, res) => {
  try {
    const theme = await PdfTheme.findById(req.params.id);
    if (!theme) return res.status(404).json({ message: 'Theme not found' });

    await PdfTheme.updateMany({ isReceiptDefault: true }, { isReceiptDefault: false });

    theme.isReceiptDefault = true;
    await theme.save();

    res.json({ message: `"${theme.name}" is now the default receipt PDF theme.`, theme });
  } catch (err) {
    logger.error('setReceiptDefaultTheme error', { message: err.message });
    res.status(500).json({ message: 'Server error updating receipt default theme' });
  }
};

const previewPdfTheme = async (req, res) => {
  try {
    const theme = await PdfTheme.findById(req.params.id).lean();
    if (!theme) return res.status(404).json({ message: 'Theme not found' });

    const mergedTheme = {
      ...theme,
      ...buildThemeOverrides(req.query),
      _standardClauses: {
        maintenance: req.query.maintenance || '',
        subletting: req.query.subletting || '',
        entry: req.query.entry || '',
        damage: req.query.damage || '',
        repairs: req.query.repairs || '',
      },
    };

    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + 12);

    const sampleAgreement = {
      _id: theme._id,
      pdfTheme: mergedTheme,
      term: {
        startDate: now,
        endDate: end,
        durationMonths: 12,
      },
      financials: {
        rentAmount: 1450,
        depositAmount: 1450,
        lateFeeAmount: 50,
        lateFeeGracePeriodDays: 5,
      },
      utilitiesIncluded: false,
      utilitiesDetails: 'Electricity, gas and internet are tenant responsibility.',
      petPolicy: { allowed: true, deposit: 150 },
      terminationPolicy: '30-day written notice required by either party.',
      clauseSet: [
        {
          title: 'Quiet Enjoyment',
          body: 'Tenant shall not cause nuisance, excessive noise, or disturbance to neighbors.',
        },
      ],
      signatures: {
        landlord: { signed: false },
        tenant: { signed: false },
      },
      rentEscalation: { enabled: false, percentage: 0 },
    };

    const sampleLandlord = {
      name: 'Sample Landlord',
      email: 'landlord@example.com',
    };

    const sampleTenant = {
      name: 'Sample Tenant',
      email: 'tenant@example.com',
    };

    const sampleProperty = {
      title: 'Sunset Apartments - Unit 3B',
      address: {
        street: '123 Sample Street',
        city: 'Sample City',
        state: 'Sample State',
      },
      financials: {
        maintenanceFee: 80,
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
    res.setHeader('Content-Disposition', `inline; filename=pdf-theme-preview-${theme._id}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    logger.error('previewPdfTheme error', { message: err.message });
    res.status(500).json({ message: 'Server error generating preview' });
  }
};

module.exports = {
  getPdfThemes,
  updatePdfTheme,
  setDefaultTheme,
  setReceiptDefaultTheme,
  previewPdfTheme,
};
