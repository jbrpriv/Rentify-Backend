const mongoose = require('mongoose');

const rentScheduleEntrySchema = new mongoose.Schema({
  dueDate: { type: Date, required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'paid', 'overdue', 'late_fee_applied'],
    default: 'pending',
  },
  paidDate: { type: Date, default: null },
  paidAmount: { type: Number, default: null },        // Actual amount paid (may differ if late fee added)
  lateFeeApplied: { type: Boolean, default: false },
  lateFeeAmount: { type: Number, default: 0 },
  stripePaymentIntent: { type: String, default: null },
  checkoutUrl: { type: String, default: null }, // Pre-generated Stripe URL for this month
}, { _id: false });

const agreementSchema = mongoose.Schema(
  {
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Property',
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'pending_signature', 'signed', 'active', 'expired', 'terminated'],
      default: 'draft',
    },
    signerOrder: {
      type: String,
      enum: ['landlord_first', 'tenant_first', 'any'],
      default: 'landlord_first',
    },

    // ─── Lease Term ────────────────────────────────────────────────
    term: {
      startDate: { type: Date, required: true },
      endDate: { type: Date, required: true },
      durationMonths: { type: Number },
    },

    // ─── Financials ────────────────────────────────────────────────
    financials: {
      rentAmount: { type: Number, required: true },
      depositAmount: { type: Number, required: true },
      lateFeeAmount: { type: Number, default: 0 },
      lateFeeGracePeriodDays: { type: Number, default: 5 },
    },

    // ─── Rent Schedule (generated after initial payment) ───────────
    // FIX: This field was missing from schema but written by paymentController webhook
    rentSchedule: [rentScheduleEntrySchema],

    // ─── Renewal Rules ─────────────────────────────────────────────
    renewalRules: {
      autoRenew: { type: Boolean, default: false },
      notifyDaysBefore: { type: Number, default: 30 },
    },

    // ─── Policy Fields (from spec) ─────────────────────────────────
    utilitiesIncluded: { type: Boolean, default: false },
    utilitiesDetails: { type: String, default: '' },
    petPolicy: {
      allowed: { type: Boolean, default: false },
      deposit: { type: Number, default: 0 },
    },
    terminationPolicy: { type: String, default: '' },

    // ─── Clause Set (for template-based agreements) ────────────────
    clauseSet: [
      {
        clauseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clause' },
        title: { type: String },
        body: { type: String },
      }
    ],

    // ─── Document ──────────────────────────────────────────────────
    documentUrl: { type: String },
    documentVersion: { type: Number, default: 1 },

    // ─── Digital Signatures ────────────────────────────────────────
    signatures: {
      landlord: {
        signed: { type: Boolean, default: false },
        signedAt: Date,
        ipAddress: String,
        drawData: { type: String, default: null }, // base64 canvas signature image
      },
      tenant: {
        signed: { type: Boolean, default: false },
        signedAt: Date,
        ipAddress: String,
        drawData: { type: String, default: null }, // base64 canvas signature image
      },
    },

    // ─── Payment Tracking ──────────────────────────────────────────
    isPaid: { type: Boolean, default: false },
    stripeSessionId: { type: String },
    // paymentHistory removed — Payment records live exclusively in the Payment collection.
    // See Component 0 (double-payment fix). Run a migration to $unset this field on existing docs.


    // ─── Renewal Proposal ──────────────────────────────────────────
    renewalProposal: {
      proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      newEndDate: { type: Date, default: null },
      newRentAmount: { type: Number, default: null },
      notes: { type: String, default: '' },
      status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
      proposedAt: { type: Date, default: null },
    },

    // ─── Rent Escalation ───────────────────────────────────────────
    // If enabled, rent is automatically increased each year on the anniversary date.
    rentEscalation: {
      enabled: { type: Boolean, default: false },
      percentage: { type: Number, default: 0 },    // e.g. 5 = 5% per year
      lastAppliedAt: { type: Date, default: null },   // Date escalation was last applied
      nextScheduledAt: { type: Date, default: null },   // Next anniversary date
    },

    // ─── Dispute Reference ─────────────────────────────────────────
    dispute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dispute',
      default: null,
    },

    // ─── Audit Log ─────────────────────────────────────────────────
    auditLog: [
      {
        action: String,
        actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        timestamp: { type: Date, default: Date.now },
        ipAddress: String,
        details: String,
      },
    ],

    // ─── Version Snapshots (full agreement content at each key event) ──
    versionHistory: [
      {
        version: { type: Number, required: true },
        savedAt: { type: Date, default: Date.now },
        savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: { type: String, default: '' },
        snapshot: {
          clauses: [String],   // clause titles at this version
          financials: mongoose.Schema.Types.Mixed,
          term: mongoose.Schema.Types.Mixed,
          status: String,
        },
      },
    ],

    // ─── DocuSign-style signing tokens ─────────────────────────────
    signingTokens: [
      {
        party: { type: String, enum: ['landlord', 'tenant'] },
        token: { type: String },   // UUID sent via email
        expiresAt: { type: Date },
        used: { type: Boolean, default: false },
        usedAt: { type: Date, default: null },
      },
    ],

    // ─── Document Retention ────────────────────────────────────────
    retentionExpiry: {
      type: Date,
      default: null, // Set when lease expires: expiry + 7 years
    },

    documentsArchivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Agreement', agreementSchema);