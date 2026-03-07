/**
 * routes/billingRoutes.js
 *
 * SaaS subscription billing routes. All payment processing is handled
 * exclusively through Stripe. The billing webhook is registered in
 * server.js BEFORE express.json() so the raw body is available for
 * Stripe signature verification.
 */

const express = require('express');
const router  = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  getBillingStatus,
  subscribe,
  openCustomerPortal,
  getPlans,
} = require('../controllers/billingController');

// Public — list available plans (no auth required so the pricing page can render)
router.get('/plans', getPlans);

// Private — get current user's billing status and tier
router.get('/status', protect, getBillingStatus);

// Private — initiate a Stripe subscription checkout
router.post('/subscribe', protect, subscribe);

// Private — open Stripe customer portal (manage / cancel subscription)
router.post('/portal', protect, openCustomerPortal);

// NOTE: POST /api/billing/webhook is registered in server.js before express.json()

module.exports = router;

/**
 * @swagger
 * tags:
 *   name: Billing
 *   description: SaaS subscription billing via Stripe
 *
 * /api/billing/plans:
 *   get:
 *     summary: Get available subscription plans with pricing and features
 *     tags: [Billing]
 *     responses:
 *       200:
 *         description: Array of plan objects with pricing, features, and Stripe price IDs
 *
 * /api/billing/status:
 *   get:
 *     summary: Get current user billing status, tier, and feature limits
 *     tags: [Billing]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current tier, feature limits, and Stripe customer ID
 *       401:
 *         description: Not authenticated
 *
 * /api/billing/subscribe:
 *   post:
 *     summary: Subscribe to a paid plan (creates a Stripe Checkout Session)
 *     tags: [Billing]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tier]
 *             properties:
 *               tier:
 *                 type: string
 *                 enum: [pro, enterprise]
 *     responses:
 *       200:
 *         description: Stripe Checkout URL to redirect the user to
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string }
 *       400:
 *         description: Invalid tier or already subscribed
 *       503:
 *         description: Stripe not configured on the server
 *
 * /api/billing/portal:
 *   post:
 *     summary: Open Stripe billing portal to manage or cancel subscription
 *     tags: [Billing]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Stripe portal URL
 *       400:
 *         description: No active subscription found
 */
