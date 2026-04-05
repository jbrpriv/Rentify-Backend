const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please add a valid email',
      ],
    },
    password: {
      type: String,
      required: true,
      select: false, // Security: Never return password by default
    },
    role: {
      type: String,
      enum: ['landlord', 'tenant', 'admin', 'property_manager', 'law_reviewer'],
      default: 'tenant',
    },
    phoneNumber: {
      type: String,
      required: true,
    },

    // ─── Profile ───────────────────────────────────────────────────
    profilePhoto: {
      type: String,
      default: null, // Cloudinary URL
    },

    // ─── Account Status ────────────────────────────────────────────
    isVerified: {
      type: Boolean,
      default: false, // Email verification
    },
    isActive: {
      type: Boolean,
      default: true,  // Admin can set false to ban/suspend account
    },
    lastLogin: {
      type: Date,
      default: null,
    },

    // ─── OTP / Phone Verification ──────────────────────────────────
    otpCode: {
      type: String,
      default: null,
      select: false, // Never expose OTP in API responses
    },
    otpExpiry: {
      type: Date,
      default: null,
      select: false,
    },
    otpAttempts: {
      type: Number,
      default: 0,
      select: false, // Track failed OTP attempts to prevent brute force
    },

    // ─── Notification Preferences ──────────────────────────────────
    smsOptIn: {
      type: Boolean,
      default: false, // User must explicitly opt in to SMS
    },
    emailOptIn: {
      type: Boolean,
      default: true,
    },

    // ─── Document Verification (Landlord / Property Manager) ───────
    documentsVerified: {
      type: Boolean,
      default: false,
    },
    verificationDocuments: [
      {
        url: { type: String, required: true },
        documentType: { type: String, default: 'cnic' },
        originalName: { type: String, default: '' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    verificationStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
    },

    // ─── Platform Subscription ─────────────────────────────────────
    subscriptionTier: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      default: 'free',
    },

    // Stripe Customer ID for billing portal access
    stripeCustomerId: {
      type: String,
      default: null,
      select: false,
    },

    // Stripe Connect account ID for landlord payouts
    stripeId: {
      type: String,
      default: null,
    },

    // Date the current paid subscription started (set by billing webhook)
    subscriptionStartDate: {
      type: Date,
      default: null,
    },

    // ─── Push Notifications ────────────────────────────────────────
    fcmToken: {
      type: String,
      default: null,
      select: false,
    },

    // ─── Document Vault (Tenant) ───────────────────────────────────
    // Persistent store of tenant-uploaded supporting documents.
    documents: [
      {
        url: { type: String, required: true },
        documentType: { type: String, default: 'general' },
        originalName: { type: String, default: '' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    // ─── Two-Factor Authentication (TOTP) ──────────────────────────
    twoFactorSecret: {
      type: String,
      default: null,
      select: false, // Never expose TOTP secret in API responses
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },

    // ─── Phone Verification ────────────────────────────────────────
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },

    // ─── OTP cooldown ──────────────────────────────────────────────────
    // Timestamp of the last phone OTP dispatch — used to enforce a 60-second
    // cooldown so a user cannot trigger multiple SMS messages in quick succession.
    otpSentAt: {
      type: Date,
      default: null,
    },

    // ─── Password Reset ────────────────────────────────────────────
    passwordResetToken: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetExpiry: {
      type: Date,
      default: null,
      select: false,
    },

    // ─── Email Verification ────────────────────────────────────────
    emailVerificationToken: {
      type: String,
      default: null,
      select: false,
    },

    // ─── OAuth Provider Tracking ───────────────────────────────────
    // Tracks which OAuth providers are linked to this account.
    // Email is always the primary key — a single email can have multiple
    // providers linked to it (e.g. password + google + facebook).
    authProviders: {
      type: [String], // e.g. ['password', 'google', 'facebook']
      default: ['password'],
    },
  },
  {
    timestamps: true,
  }
);

// ─── Encrypt password before saving ──────────────────────────────────────────
// Mongoose 7+: async pre-hooks do not receive next — just return early
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ─── Match entered password to hashed password ───────────────────────────────
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ─── Check if OTP is valid and not expired ───────────────────────────────────
userSchema.methods.isOtpValid = function (code) {
  return (
    this.otpCode === code &&
    this.otpExpiry &&
    this.otpExpiry > new Date()
  );
};

const User = mongoose.model('User', userSchema);

module.exports = User;