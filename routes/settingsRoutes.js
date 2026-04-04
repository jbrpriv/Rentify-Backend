const express = require('express');
const router = express.Router();
const { getPublicBrandingSettings } = require('../controllers/adminController');

router.get('/branding', getPublicBrandingSettings);

module.exports = router;