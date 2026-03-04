const express = require('express');
const router  = express.Router();
const { protect, isAdmin } = require('../middlewares/authMiddleware');
const {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  reviewTemplate,
  useTemplate,
  getTemplateAnalytics,
} = require('../controllers/agreementTemplateController');

// Analytics (admin only) — must be before /:id to avoid route collision
router.get('/analytics', protect, isAdmin, getTemplateAnalytics);

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

// PUT /api/agreement-templates/:id/review → admin approves/rejects
router.put('/:id/review', protect, isAdmin, reviewTemplate);

// POST /api/agreement-templates/:id/use → track usage when creating agreement
router.post('/:id/use', protect, useTemplate);

module.exports = router;
