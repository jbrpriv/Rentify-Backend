const rateLimit = require('express-rate-limit');

// ─── Auth routes (strictest) ──────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 700,
  message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwaredHeader: false },
});

// ─── Property creation / update (prevent spam listings) ──────────────────────
const propertyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 30,
  message: { message: 'Too many property requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwaredHeader: false },
});

// ─── File uploads ─────────────────────────────────────────────────────────────
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 50,
  message: { message: 'Upload limit reached. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwaredHeader: false },
});

// ─── Messaging (prevent spam) ─────────────────────────────────────────────────
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 60,
  message: { message: 'Message rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwaredHeader: false },
});

// ─── Offer / application submissions ─────────────────────────────────────────
const offerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 20,
  message: { message: 'Too many offer submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwaredHeader: false },
});

// ─── General API (broad fallback) ────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,
  message: { message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, forwaredHeader: false },
});

module.exports = { loginLimiter, propertyLimiter, uploadLimiter, messageLimiter, offerLimiter, generalLimiter };