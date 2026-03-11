const express = require('express');
const router = express.Router();
const { submitSupportRequest } = require('../controllers/supportController');

// Public support form — no authentication required
router.post('/', submitSupportRequest);

module.exports = router;
