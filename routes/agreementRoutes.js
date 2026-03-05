const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  downloadAgreementPDF, getAgreements, signAgreement,
  proposeRenewal, respondToRenewal,
  getAvailableClauses, updateAgreementClauses, getDocumentUrl,
  sendSigningInvites, signViaToken,
  getVersionHistory, snapshotAgreement, getAgreementPreview,
} = require('../controllers/agreementController');

// List agreements
router.route('/')
  .get(protect, getAgreements);

// Clause picker — get approved clauses for the agreement builder (H4)
router.get('/clauses', protect, getAvailableClauses);

// Download agreement as PDF
router.get('/:id/pdf', protect, downloadAgreementPDF);

// Inline PDF preview (base64 or S3 signed URL)
router.get('/:id/preview', protect, getAgreementPreview);

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
router.post('/:id/renew', protect, proposeRenewal);
router.put('/:id/renew/respond', protect, respondToRenewal);

module.exports = router;
