const express = require('express');
const router  = express.Router();
const { protect, isAdmin } = require('../middlewares/authMiddleware');
const {
  getTemplates,
  getTemplateById,
  getAvailableTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplatePDF,
  approveTemplate,
  rejectTemplate,
  reviewTemplate,
  useTemplate,
  getTemplateAnalytics,
  getApprovedClauses,
} = require('../controllers/agreementTemplateController');

// Analytics (admin only) — must be before /:id to avoid route collision
router.get('/analytics', protect, isAdmin, getTemplateAnalytics);
router.get('/available', protect, getAvailableTemplates);
router.get('/approved-clauses', protect, getApprovedClauses);

// GET  /api/agreement-templates       → landlord: own | admin: all
// POST /api/agreement-templates       → landlord creates
router.route('/')
  .get(protect, getTemplates)
  .post(protect, createTemplate);

// GET /PUT /DELETE  /api/agreement-templates/:id
router.route('/:id')
  .get(protect, getTemplateById)
  .put(protect, updateTemplate)
  .delete(protect, deleteTemplate);

router.get('/:id/preview-pdf', protect, isAdmin, previewTemplatePDF);
router.put('/:id/approve', protect, isAdmin, approveTemplate);
router.put('/:id/reject', protect, isAdmin, rejectTemplate);
router.put('/:id/review', protect, isAdmin, reviewTemplate);

// POST /api/agreement-templates/:id/use → track usage when creating agreement
router.post('/:id/use', protect, useTemplate);

module.exports = router;
