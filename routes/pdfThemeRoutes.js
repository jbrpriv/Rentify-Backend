const express = require('express');
const router = express.Router();
const { getPdfThemes, setDefaultTheme } = require('../controllers/pdfThemeController');
const { protect, isAdmin } = require('../middlewares/authMiddleware');

router.route('/').get(protect, getPdfThemes);
router.route('/:id/set-default').put(protect, isAdmin, setDefaultTheme);

module.exports = router;
