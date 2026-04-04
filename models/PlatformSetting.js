const mongoose = require('mongoose');

const platformSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'singleton',
      unique: true,
      immutable: true,
    },
    brandName: {
      type: String,
      trim: true,
      default: process.env.BRAND_NAME || 'RentifyPro',
    },
    supportEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@rentifypro.com',
    },
    logoUrl: {
      type: String,
      trim: true,
      default: process.env.BRAND_LOGO_URL || '',
    },
    faviconUrl: {
      type: String,
      trim: true,
      default: process.env.BRAND_FAVICON_URL || '/favicon.ico',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PlatformSetting', platformSettingSchema);