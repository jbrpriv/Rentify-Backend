const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createAgreement, downloadAgreementPDF, getAgreements, signAgreement,
  proposeRenewal, respondToRenewal,
  getAvailableClauses, updateAgreementClauses, getDocumentUrl,
} = require('../controllers/agreementController');

// List / Create agreements
router.route('/')
  .post(protect, createAgreement)
  .get(protect, getAgreements);

// Clause picker — get approved clauses for the agreement builder (H4)
router.get('/clauses', protect, getAvailableClauses);

// Download agreement as PDF
router.get('/:id/pdf', protect, downloadAgreementPDF);

// S3 document vault — get pre-signed download URL (H3)
router.get('/:id/document-url', protect, getDocumentUrl);

// Signing
router.put('/:id/sign', protect, signAgreement);

// Clause set management (H4)
router.put('/:id/clauses', protect, updateAgreementClauses);

// Renewal workflow
router.post('/:id/renew',        protect, proposeRenewal);
router.put('/:id/renew/respond', protect, respondToRenewal);

module.exports = router;
