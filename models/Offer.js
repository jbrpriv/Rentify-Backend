const mongoose = require('mongoose');

/**
 * Unified Offer model.
 *
 * Each document = one full negotiation thread (tenant ↔ landlord, per property).
 * history[] is append-only — every round of offer / counter-offer lives here.
 * listedTerms is snapshotted from the property at offer creation time, so the
 * tenant UI can always show "Landlord's asking price" beside the input boxes.
 */
const roundSchema = new mongoose.Schema(
  {
    round:               { type: Number, required: true },
    offeredBy:           { type: String, enum: ['tenant', 'landlord'], required: true },
    monthlyRent:         { type: Number, required: true },
    securityDeposit:     { type: Number, required: true },
    leaseDurationMonths: { type: Number, required: true },
    // Only landlord may attach a short note when countering.
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const offerSchema = mongoose.Schema(
  {
    property: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Property' },
    landlord: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    tenant:   { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },

    status: {
      type: String,
      enum: ['pending', 'countered', 'accepted', 'declined', 'withdrawn'],
      default: 'pending',
    },

    // Landlord's listed terms — shown beside tenant's empty input boxes.
    listedTerms: {
      monthlyRent:         { type: Number, required: true },
      securityDeposit:     { type: Number, required: true },
      leaseDurationMonths: { type: Number, default: 12 },
    },

    // Full negotiation history — newest entry is the current round.
    history: [roundSchema],

    // Populated once the landlord accepts and an agreement is created.
    agreement: { type: mongoose.Schema.Types.ObjectId, ref: 'Agreement', default: null },

    // Snapshotted from tenant profile at submission time.
    applicantDetails: {
      name:  String,
      email: String,
      phone: String,
    },
  },
  { timestamps: true }
);

// One active negotiation per tenant per property.
offerSchema.index({ property: 1, tenant: 1 }, { unique: true });

module.exports = mongoose.model('Offer', offerSchema);
