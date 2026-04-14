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

    // Base global theme this template customizes.
    baseTheme: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PdfTheme',
      required: true,
    },

    // Landlord-level branding overrides layered on top of baseTheme.
    customizations: {
      primaryColor: {
        type: String,
        default: '',
      },
      accentColor: {
        type: String,
        default: '',
      },
      backgroundColor: {
        type: String,
        default: '',
      },
      fontFamily: {
        type: String,
        enum: ['', 'Helvetica', 'Times-Roman', 'Courier'],
        default: '',
      },
      fontSizeScale: {
        type: Number,
        min: 0.8,
        max: 1.4,
        default: 1.0,
      },
    },

    // Editable standard legal clauses rendered in the PDF layout.
    standardClauses: {
      maintenance: { type: String, default: '' },
      subletting: { type: String, default: '' },
      entry: { type: String, default: '' },
      damage: { type: String, default: '' },
      repairs: { type: String, default: '' },
    },

    // Preview artifact key (dummy-data PDF generated for admin review).
    previewS3Key: {
      type: String,
      default: '',
    },

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

    // ─── Usage analytics ──────────────────────────────────────────
    usageCount: {
      type:    Number,
      default: 0,
    },

    lastUsedAt: {
      type:    Date,
      default: null,
    },

    // ─── Document Content ─────────────────────────────────────────
    bodyHtml: {
      type:    String,
      default: '',
    },
    bodyJson: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AgreementTemplate', agreementTemplateSchema);
