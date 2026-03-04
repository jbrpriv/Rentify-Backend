const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createCheckoutSession,
  createRentCheckoutSession,
  getRentSchedule,
  getPaymentHistory,
  getAvailableGateways,
  getActiveCheckoutUrl,       // ← was exported but never imported here — this caused the 404
  createRazorpayOrder,
  verifyRazorpayPayment,
  createPayPalOrder,
  capturePayPalOrder,
  retryFailedPayment,
} = require('../controllers/paymentController');

// Available payment gateways
router.get('/gateways', protect, getAvailableGateways);

// ─── Stripe ──────────────────────────────────────────────────────────────────
// Create Stripe checkout session for initial deposit + 1st month rent
router.post('/create-checkout-session', protect, createCheckoutSession);

// Create Stripe checkout session for a specific monthly rent payment
router.post('/pay-rent', protect, createRentCheckoutSession);

// ─── Active checkout URL (pre-generated or on-demand for next unpaid month) ──
// FIX: This route was MISSING — getActiveCheckoutUrl existed in the controller
//      but was never wired up, causing: "Route not found: GET /api/payments/active-checkout/:id"
router.get('/active-checkout/:agreementId', protect, getActiveCheckoutUrl);

// ─── Razorpay ────────────────────────────────────────────────────────────────
router.post('/razorpay/create-order', protect, createRazorpayOrder);
router.post('/razorpay/verify',       protect, verifyRazorpayPayment);

// ─── PayPal ──────────────────────────────────────────────────────────────────
router.post('/paypal/create-order', protect, createPayPalOrder);
router.post('/paypal/capture',      protect, capturePayPalOrder);

// ─── Retry failed payments ───────────────────────────────────────────────────
router.post('/retry/:paymentId', protect, retryFailedPayment);

// ─── Schedules & History ─────────────────────────────────────────────────────
// Get rent schedule for an agreement
router.get('/schedule/:agreementId', protect, getRentSchedule);

// Get payment history
router.get('/history', protect, getPaymentHistory);

// NOTE: Webhook route is registered directly in server.js BEFORE express.json()
// so that the raw body is preserved for Stripe signature verification

module.exports = router;