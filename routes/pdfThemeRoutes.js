const express = require('express');
const router = express.Router();
const { getPdfThemes } = require('../controllers/pdfThemeController');
const { protect } = require('../middlewares/authMiddleware');

router.route('/').get(protect, getPdfThemes);

module.exports = router;
