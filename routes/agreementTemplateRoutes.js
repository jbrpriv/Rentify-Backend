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
} = require('../controllers/agreementTemplateController');

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

module.exports = router;
