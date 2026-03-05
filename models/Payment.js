const mongoose = require('mongoose');

const paymentSchema = mongoose.Schema(
  {
    agreement: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Agreement',
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Property',
    },

    // ─── Payment Details ───────────────────────────────────────────
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ['initial', 'rent', 'deposit', 'late_fee', 'maintenance', 'refund'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },

    // ─── Schedule Reference ────────────────────────────────────────
    // Which month this payment covers (matches rentSchedule entry)
    dueDate: {
      type: Date,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },

    // ─── Late Fee Tracking ─────────────────────────────────────────
    lateFeeIncluded: {
      type: Boolean,
      default: false,
    },
    lateFeeAmount: {
      type: Number,
      default: 0,
    },

    // ─── Stripe Integration ────────────────────────────────────────
    stripePaymentIntent: {
      type: String,
      default: null,
    },
    stripeSessionId: {
      type: String,
      default: null,
    },

    // ─── Multi-Gateway Support ─────────────────────────────────────
    gateway: {
      type:    String,
      enum:    ['stripe', 'razorpay', 'paypal', 'manual'],
      default: 'stripe',
    },
    gatewayPaymentId: { type: String, default: null },
    gatewayOrderId:   { type: String, default: null },

    // ─── Retry Logic ───────────────────────────────────────────────
    retryCount:   { type: Number, default: 0 },
    nextRetryAt:  { type: Date, default: null },
    failureReason: { type: String, default: null },

    // ─── Receipt ──────────────────────────────────────────────────
    receiptUrl: {
      type: String,
      default: null, // PDF receipt stored on Cloudinary/S3
    },
    receiptNumber: {
      type: String,
      default: null, // Human-readable e.g. "RCP-2026-00042"
    },

    notes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Auto-generate receipt number before saving a paid payment (H7 fix: UUID-based, no race condition)
paymentSchema.pre('save', function () {
  if ((this.isNew || this.isModified('status')) && this.status === 'paid' && !this.receiptNumber) {
    // Use timestamp + random hex suffix — globally unique without a DB round-trip
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    this.receiptNumber = `RCP-${new Date().getFullYear()}-${ts}-${rand}`;
  }
});

module.exports = mongoose.model('Payment', paymentSchema);