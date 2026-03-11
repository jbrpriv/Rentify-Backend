const { sendEmail } = require('../utils/emailService');
const logger = require('../utils/logger');

// Simple in-memory rate limiter: max 3 submissions per IP per hour
const ipTracker = new Map();
const RATE_LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip) {
  const now = Date.now();
  const record = ipTracker.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + WINDOW_MS;
  }
  record.count += 1;
  ipTracker.set(ip, record);
  return record.count > RATE_LIMIT;
}

// @desc    Submit a support request (public — no auth required)
// @route   POST /api/support
// @access  Public
const submitSupportRequest = async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }

    const { name, email, subject, category, message, phone } = req.body;

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({ message: 'Name, email, and message are required.' });
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ message: 'Message must be under 2000 characters.' });
    }

    // Notify support team
    const supportEmail = process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@rentifypro.com';
    await sendEmail(
      supportEmail,
      'supportRequest',
      name,
      email,
      phone || 'Not provided',
      subject || 'General Enquiry',
      category || 'general',
      message
    );

    // Send acknowledgement to user
    await sendEmail(
      email,
      'supportAcknowledgement',
      name,
      subject || 'General Enquiry'
    );

    logger.info('Support request submitted', { email, category, ip });
    res.status(201).json({ message: 'Your support request has been received. We will get back to you within 24 hours.' });
  } catch (error) {
    logger.error('Support request failed', { err: error.message });
    res.status(500).json({ message: 'Failed to submit support request. Please try again.' });
  }
};

module.exports = { submitSupportRequest };
