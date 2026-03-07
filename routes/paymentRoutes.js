/**
 * routes/paymentRoutes.js
 *
 * [FIX #7]  Razorpay and PayPal routes removed.
 *           Only Stripe is supported.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createCheckoutSession,
  createRentCheckoutSession,
  handleStripeWebhook,
  getRentSchedule,
  getPaymentHistory,
  getAvailableGateways,
  getActiveCheckoutUrl,
  retryFailedPayment,
  downloadReceipt,
} = require('../controllers/paymentController');

// ─── Available gateways (Stripe only) ────────────────────────────────────────
router.get('/gateways', protect, getAvailableGateways);

// ─── Stripe checkout ──────────────────────────────────────────────────────────
router.post('/create-checkout-session', protect, createCheckoutSession);
router.post('/pay-rent', protect, createRentCheckoutSession);
router.get('/active-checkout/:agreementId', protect, getActiveCheckoutUrl);

// ─── Receipts ─────────────────────────────────────────────────────────────────
router.get('/:paymentId/receipt', protect, downloadReceipt);

// ─── Retry failed payment ─────────────────────────────────────────────────────
router.post('/retry/:paymentId', protect, retryFailedPayment);

// ─── Schedule & History ───────────────────────────────────────────────────────
router.get('/schedule/:agreementId', protect, getRentSchedule);
router.get('/history', protect, getPaymentHistory);
router.get('/', protect, getPaymentHistory);

// NOTE: Stripe webhook is registered in server.js BEFORE express.json() middleware

module.exports = router;