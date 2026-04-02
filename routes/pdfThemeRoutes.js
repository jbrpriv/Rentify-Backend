const express = require('express');
const router = express.Router();
const { getPdfThemes, updatePdfTheme, setDefaultTheme, previewPdfTheme } = require('../controllers/pdfThemeController');
const { protect, isAdmin } = require('../middlewares/authMiddleware');

router.route('/').get(protect, getPdfThemes);
router.route('/:id').put(protect, isAdmin, updatePdfTheme);
router.route('/:id/set-default').put(protect, isAdmin, setDefaultTheme);
router.route('/:id/preview').get(protect, previewPdfTheme);

module.exports = router;
