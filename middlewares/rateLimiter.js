const rateLimit = require('express-rate-limit');
// ─── Auth routes (strictest) ──────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 50,
  message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwardedHeader: false },
});

// ─── Property creation / update (prevent spam listings) ──────────────────────
const propertyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 30,
  message: { message: 'Too many property requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwardedHeader: false },
});

// ─── File uploads ─────────────────────────────────────────────────────────────
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 50,
  message: { message: 'Upload limit reached. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwardedHeader: false },
});

// ─── Messaging (prevent spam) ─────────────────────────────────────────────────
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 60,
  message: { message: 'Message rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwardedHeader: false },
});

// ─── Offer / application submissions ─────────────────────────────────────────
const offerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 20,
  message: { message: 'Too many offer submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwardedHeader: false },
});

// ─── General API (broad fallback) ────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,
  message: { message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwardedHeader: false },
});

// ─── Notification counts polling (high-frequency, authenticated) ──────────────
const notificationCountLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute window
  max: 30,                   // 30 polls/min per user is plenty (vs every-second storm)
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { message: 'Too many count requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwardedHeader: false },
});

module.exports = { loginLimiter, propertyLimiter, uploadLimiter, messageLimiter, offerLimiter, generalLimiter, notificationCountLimiter };