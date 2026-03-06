const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  getBillingStatus,
  subscribe,
  openCustomerPortal,
  getPlans,
  verifyRazorpaySubscription,
} = require('../controllers/billingController');

// Public — list available plans
router.get('/plans', getPlans);

// Private — get current user's billing status
router.get('/status', protect, getBillingStatus);

// Private — initiate a subscription checkout
router.post('/subscribe', protect, subscribe);

// Private — open Stripe customer portal (manage / cancel)
router.post('/portal', protect, openCustomerPortal);

// Private — verify Razorpay subscription signature
router.post('/razorpay/verify', protect, verifyRazorpaySubscription);

// NOTE: Billing webhook (POST /api/billing/webhook) is registered directly
// in server.js BEFORE express.json() so the raw body is preserved for
// Stripe signature verification.

module.exports = router;

/**
 * @swagger
 * tags:
 *   name: Billing
 *   description: SaaS subscription billing via Stripe
 *
 * /api/billing/plans:
 *   get:
 *     summary: Get available subscription plans
 *     tags: [Billing]
 *     responses:
 *       200: { description: Array of plan objects with pricing and features }
 *
 * /api/billing/status:
 *   get:
 *     summary: Get current user billing status and tier
 *     tags: [Billing]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Billing status with tier and subscription info }
 *
 * /api/billing/subscribe:
 *   post:
 *     summary: Subscribe to a plan (creates Stripe checkout session)
 *     tags: [Billing]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tier: { type: string, enum: [pro, enterprise] }
 *     responses:
 *       200: { description: Stripe checkout URL }
 *
 * /api/billing/portal:
 *   post:
 *     summary: Open Stripe billing portal for subscription management
 *     tags: [Billing]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Stripe portal URL }
 */