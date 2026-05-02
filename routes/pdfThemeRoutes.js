const express = require('express');
const router = express.Router();
const { getPdfThemes, getThemeById, getThemeBySlug, updatePdfTheme, setDefaultTheme, setReceiptDefaultTheme, previewPdfTheme } = require('../controllers/pdfThemeController');
const { protect, isAdmin } = require('../middlewares/authMiddleware');

router.route('/').get(protect, getPdfThemes);
router.route('/slug/:slug').get(protect, getThemeBySlug);
router.route('/:id').get(protect, getThemeById);
router.route('/:id').put(protect, isAdmin, updatePdfTheme);
router.route('/:id/set-default').put(protect, isAdmin, setDefaultTheme);
router.route('/:id/set-receipt-default').put(protect, isAdmin, setReceiptDefaultTheme);
router.route('/:id/preview').get(protect, previewPdfTheme);

module.exports = router;