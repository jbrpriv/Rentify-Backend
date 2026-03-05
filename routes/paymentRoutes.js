/**
 * routes/paymentRoutes.js
 *
 * [FIX #7]  Razorpay and PayPal routes removed.
 *           Dead code cleaned from both this router and paymentController.js.
 *
 * ─── What was removed ────────────────────────────────────────────────────────
 *   Routes:
 *     POST /razorpay/create-order
 *     POST /razorpay/verify
 *     POST /paypal/create-order
 *     POST /paypal/capture
 *
 *   Controller exports (delete these from paymentController.js):
 *     createRazorpayOrder
 *     verifyRazorpayPayment
 *     createPayPalOrder
 *     capturePayPalOrder
 *
 *   Controller internals (delete from paymentController.js):
 *     getRazorpayClient()
 *     getPayPalClient()
 *     The try/catch require blocks for razorpay + @paypal/checkout-server-sdk
 *     The 'razorpay' entry in getAvailableGateways()
 *     The 'paypal'   entry in getAvailableGateways()
 *
 *   getAvailableGateways now returns only:
 *     [{ id: 'stripe', name: 'Stripe', enabled: true }]
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const router  = express.Router();
const { protect } = require('../middlewares/authMiddleware');

const {
  createCheckoutSession,
  createRentCheckoutSession,
  getRentSchedule,
  getPaymentHistory,
  getAvailableGateways,
  getActiveCheckoutUrl,
  retryFailedPayment,
} = require('../controllers/paymentController');

// ─── Available gateways (Stripe only) ────────────────────────────────────────
router.get('/gateways', protect, getAvailableGateways);

// ─── Stripe ──────────────────────────────────────────────────────────────────
// Initial deposit + first month rent checkout
router.post('/create-checkout-session', protect, createCheckoutSession);

// Monthly rent payment checkout
router.post('/pay-rent', protect, createRentCheckoutSession);

// Pre-generated or on-demand checkout URL for next unpaid rent period
router.get('/active-checkout/:agreementId', protect, getActiveCheckoutUrl);

// ─── Retry failed payment ────────────────────────────────────────────────────
router.post('/retry/:paymentId', protect, retryFailedPayment);

// ─── Schedules & History ─────────────────────────────────────────────────────
router.get('/schedule/:agreementId', protect, getRentSchedule);
router.get('/',                      protect, getPaymentHistory);
router.get('/history',               protect, getPaymentHistory);

// NOTE: Stripe webhook is registered in server.js before express.json()

module.exports = router;
