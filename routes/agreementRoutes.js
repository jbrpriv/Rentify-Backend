const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createAgreement,
  downloadAgreementPDF, getAgreements, getAgreementById, signAgreement,
  proposeRenewal, respondToRenewal,
  getAvailableClauses, updateAgreementClauses, getDocumentUrl,
  sendSigningInvites, signViaToken,
  getVersionHistory, snapshotAgreement, getAgreementPreview, getAgreementPreviewPublic,
  updateEscalation,
} = require('../controllers/agreementController');

// List agreements / create agreement
router.route('/')
  .get(protect, getAgreements)
  .post(protect, createAgreement);

// Clause picker — get approved clauses for the agreement builder (H4)
router.get('/clauses', protect, getAvailableClauses);

// Download agreement as PDF
router.get('/:id/pdf', protect, downloadAgreementPDF);

// Single agreement detail
router.get('/:id', protect, getAgreementById);

// Inline PDF preview (base64 or S3 signed URL)
router.get('/:id/preview', protect, getAgreementPreview);
// Public preview — validated via signing token query param (for sign/ page)
router.get('/:id/preview/public', getAgreementPreviewPublic);

// S3 document vault — get pre-signed download URL (H3)
router.get('/:id/document-url', protect, getDocumentUrl);

// Signing
router.put('/:id/sign', protect, signAgreement);
router.post('/:id/send-invites', protect, sendSigningInvites);
router.post('/:id/sign-via-token', signViaToken);   // public — token-authenticated

// Version history & snapshots
router.get('/:id/version-history', protect, getVersionHistory);
router.post('/:id/snapshot', protect, snapshotAgreement);

// Clause set management (H4)
router.put('/:id/clauses', protect, updateAgreementClauses);

// Renewal workflow
router.put('/:id/renew', protect, proposeRenewal);
router.put('/:id/renew/respond', protect, respondToRenewal);

// Rent escalation settings (landlord only)
router.put('/:id/escalation', protect, updateEscalation);

module.exports = router;

/**
 * @swagger
 * tags:
 *   name: Agreements
 *   description: Rental agreement lifecycle
 *
 * /api/agreements:
 *   get:
 *     summary: List agreements (role-filtered)
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Array of agreements
 *   post:
 *     summary: Create a draft agreement directly (landlord only)
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId, propertyId, startDate, endDate, rentAmount, depositAmount]
 *             properties:
 *               tenantId: { type: string }
 *               propertyId: { type: string }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               rentAmount: { type: number }
 *               depositAmount: { type: number }
 *               signerOrder: { type: string, enum: [landlord_first, tenant_first, any] }
 *     responses:
 *       201: { description: Draft agreement created }
 *       400: { description: Validation error }
 *       403: { description: Property not owned by requester }
 *
 * /api/agreements/{id}/sign:
 *   put:
 *     summary: Sign an agreement (landlord or tenant)
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               drawData: { type: string, description: "Base64 canvas draw data" }
 *     responses:
 *       200: { description: Agreement signed }
 *       400: { description: Already signed or signer order violation }
 *       403: { description: Not a party to this agreement }
 *
 * /api/agreements/{id}/renew:
 *   post:
 *     summary: Propose a lease renewal (landlord only)
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               newEndDate: { type: string, format: date }
 *               newRentAmount: { type: number }
 *     responses:
 *       200: { description: Renewal proposal submitted }
 *       403: { description: Not the landlord }
 *
 * /api/agreements/{id}/version-history:
 *   get:
 *     summary: Get audit log and version snapshots for an agreement
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Audit log and version history }
 *       403: { description: Not a party to this agreement }
 *
 * /api/agreements/{id}/escalation:
 *   put:
 *     summary: Update rent escalation settings for an agreement
 *     tags: [Agreements]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               percentage: { type: number, minimum: 1, maximum: 50 }
 *     responses:
 *       200: { description: Escalation settings updated }
 *       403: { description: Not the landlord }
 */