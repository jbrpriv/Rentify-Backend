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
/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Rent payments, receipts, and Stripe checkout sessions
 *
 * /api/payments/gateways:
 *   get:
 *     summary: List available payment gateways (Stripe only)
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Array of enabled gateway objects
 *
 * /api/payments/create-checkout-session:
 *   post:
 *     summary: Create Stripe Checkout for the initial deposit + first month rent
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [agreementId]
 *             properties:
 *               agreementId: { type: string }
 *     responses:
 *       200:
 *         description: Stripe Checkout URL
 *       400:
 *         description: Already paid or agreement not in signed state
 *       403:
 *         description: Not the tenant on this agreement
 *       404:
 *         description: Agreement not found
 *
 * /api/payments/pay-rent:
 *   post:
 *     summary: Create a Stripe Checkout for a specific monthly rent entry
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [agreementId, scheduleIndex]
 *             properties:
 *               agreementId: { type: string }
 *               scheduleIndex: { type: integer, description: Zero-based index into rentSchedule }
 *     responses:
 *       200:
 *         description: Stripe Checkout URL
 *       400:
 *         description: Already paid or invalid index
 *
 * /api/payments/active-checkout/{agreementId}:
 *   get:
 *     summary: Get a pre-generated checkout URL for the next unpaid month
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: agreementId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Checkout URL and schedule index
 *       400:
 *         description: Agreement not active
 *
 * /api/payments/{paymentId}/receipt:
 *   get:
 *     summary: Download or stream a payment receipt PDF
 *     description: >
 *       If S3 is configured, returns a JSON object with a short-lived signed URL.
 *       Otherwise streams the PDF directly as application/pdf.
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Either { url } JSON (S3) or PDF binary stream
 *       403:
 *         description: Not authorized to access this receipt
 *       404:
 *         description: Payment not found
 *
 * /api/payments/schedule/{agreementId}:
 *   get:
 *     summary: Get the full rent schedule for an agreement
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: agreementId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Schedule entries with summary statistics
 *       403:
 *         description: Not a party to this agreement
 *
 * /api/payments/history:
 *   get:
 *     summary: Get payment history (role-scoped; supports agreementId, type, status filters)
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: agreementId
 *         schema: { type: string }
 *         description: Filter by specific agreement
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [paid, failed, retry_scheduled] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated payment list
 *
 * /api/payments/retry/{paymentId}:
 *   post:
 *     summary: Queue a failed payment for automatic retry (up to 3 attempts)
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Retry scheduled with next attempt timestamp
 *       400:
 *         description: Already paid or max retries reached
 */
