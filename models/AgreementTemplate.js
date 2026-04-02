const mongoose = require('mongoose');

const agreementTemplateSchema = new mongoose.Schema(
  {
    // Owner — only landlords and property managers create templates
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true,
    },

    name: {
      type:     String,
      required: true,
      trim:     true,
    },

    description: {
      type:    String,
      default: '',
      trim:    true,
    },

    // Snapshot of clause ids this template bundles.
    // Approved clauses + landlord's own pending suggestions are both allowed.
    clauseIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'Clause',
      },
    ],

    // ─── Admin approval ────────────────────────────────────────────
    // Templates are visible to the landlord immediately but need
    // admin approval before they can be used to create agreements.
    status: {
      type:    String,
      enum:    ['pending', 'approved', 'rejected'],
      default: 'pending',
    },

    reviewedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    reviewedAt: {
      type:    Date,
      default: null,
    },

    rejectionReason: {
      type:    String,
      default: '',
    },

    isArchived: {
      type:    Boolean,
      default: false,
    },

    // ─── Jurisdiction / Region ─────────────────────────────────────
    jurisdiction: {
      type:    String,
      default: 'general',
      trim:    true,
      // e.g. 'general', 'punjab', 'sindh', 'kpk', 'balochistan', 'islamabad'
    },

    // ─── Default Theme ─────────────────────────────────────────────
    defaultPdfTheme: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PdfTheme',
      default: null,
    },

    // ─── Usage analytics ──────────────────────────────────────────
    usageCount: {
      type:    Number,
      default: 0,
    },

    lastUsedAt: {
      type:    Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AgreementTemplate', agreementTemplateSchema);
