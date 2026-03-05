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
