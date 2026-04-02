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
    fontFamily: {
      type: String,
      enum: ['Helvetica', 'Times-Roman', 'Courier'],
      default: 'Helvetica',
    },
    fontSizeScale: {
      type: Number,
      min: 0.8,
      max: 1.4,
      default: 1.0,
    },
    layoutStyle: {
      type: String,
      enum: ['modern', 'classic', 'minimalist'],
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
