const mongoose = require('mongoose');

const pdfThemeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },

    // ─── Unique slug matching frontend theme IDs ─────────────────
    themeSlug: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    // ─── Colors ──────────────────────────────────────────────────
    primaryColor: {
      type: String,
      default: '#000000',
    },
    accentColor: {
      type: String,
      default: '#333333',
    },
    backgroundColor: {
      type: String,
      default: '#FFFFFF',
    },
    headingColor: {
      type: String,
      default: '#000000',
    },
    bodyTextColor: {
      type: String,
      default: '#1a1a1a',
    },

    // ─── Table Styling ───────────────────────────────────────────
    tableBorderColor: {
      type: String,
      default: '#cbd5e1',
    },
    tableHeaderBg: {
      type: String,
      default: '#f8fafc',
    },
    tableHeaderTextColor: {
      type: String,
      default: '#1a1a1a',
    },

    // ─── Typography ──────────────────────────────────────────────
    fontFamily: {
      type: String,
      default: 'Helvetica',
    },
    headingFontFamily: {
      type: String,
      default: '',
    },
    googleFontUrl: {
      type: String,
      default: '',
    },
    fontSizeScale: {
      type: Number,
      min: 0.8,
      max: 1.4,
      default: 1.0,
    },

    // ─── Hero / Background ───────────────────────────────────────
    heroBackground: {
      type: String,
      default: '',
    },
    heroPattern: {
      type: String,
      default: '',
    },
    pageTexture: {
      type: String,
      default: 'none',
    },

    // ─── Borders / Rules ─────────────────────────────────────────
    headerRule: {
      type: String,
      default: '',
    },
    sectionRule: {
      type: String,
      default: '',
    },

    // ─── Watermark ───────────────────────────────────────────────
    watermarkEnabled: {
      type: Boolean,
      default: false,
    },
    watermarkText: {
      type: String,
      default: '',
    },
    watermarkOpacity: {
      type: Number,
      default: 0.04,
      min: 0,
      max: 0.2,
    },
    watermarkColor: {
      type: String,
      default: '#000000',
    },

    // ─── Layout / Classification ─────────────────────────────────
    layoutStyle: {
      type: String,
      enum: ['modern', 'classic', 'minimalist', 'legal', 'premium', 'contemporary', 'editorial', 'ledger'],
      default: 'minimalist',
    },
    isGlobal: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isReceiptDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PdfTheme', pdfThemeSchema);

