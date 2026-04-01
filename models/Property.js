const mongoose = require('mongoose');

const propertySchema = mongoose.Schema(
  {
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },

    // ─── Property Manager Assignment ───────────────────────────────
    managedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ─── PM Invitation ─────────────────────────────────────────────
    pmInvitation: {
      invitedManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      status: { type: String, enum: ['pending', 'accepted', 'declined'], default: null },
      invitedAt: { type: Date, default: null },
    },

    title: {
      type: String,
      required: true,
    },

    address: {
      street:     { type: String, required: true },
      unitNumber: { type: String, default: '' },
      city:       { type: String, required: true },
      state:      { type: String, required: true },
      zip:        { type: String, required: true },
      country:    { type: String, default: 'Pakistan' },
    },

    // GeoJSON point [lng, lat]
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: undefined,
      },
    },

    type: {
      type: String,
      enum: ['apartment', 'house', 'commercial', 'studio'],
      required: true,
    },

    specs: {
      bedrooms:  Number,
      bathrooms: Number,
      sizeSqFt:  Number,
    },

    amenities: {
      type: [String],
      default: [],
    },

    financials: {
      monthlyRent:            { type: Number, required: true },
      securityDeposit:        { type: Number, required: true },
      maintenanceFee:         { type: Number, default: 0 },
      lateFeeAmount:          { type: Number, default: 0 },
      lateFeeGracePeriodDays: { type: Number, default: 5 },
      taxId:                  { type: String, default: '' },
    },

    leaseTerms: {
      defaultDurationMonths: { type: Number, default: 12 },
    },

    status: {
      type: String,
      enum: ['vacant', 'occupied', 'maintenance'],
      default: 'vacant',
    },

    isListed: {
      type: Boolean,
      default: false,
    },

    isArchived: {
      type: Boolean,
      default: false,
    },

    archivedAt: {
      type: Date,
      default: null,
    },

    archivedReason: {
      type: String,
      default: '',
    },

    listingDescription: {
      type: String,
      default: '',
    },

    images: [String],

    // ─── Real view counter ─────────────────────────────────────────
    // Incremented every time GET /api/listings/:id is called publicly.
    views: {
      type: Number,
      default: 0,
    },

    // ─── Applications Inbox ────────────────────────────────────────
    applications: [
      {
        tenant: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        message: { type: String },
        status: {
          type: String,
          enum: ['pending', 'accepted', 'rejected'],
          default: 'pending',
        },
        createdAt: { type: Date, default: Date.now },
      }
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Property', propertySchema);