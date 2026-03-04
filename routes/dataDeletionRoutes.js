const express = require('express');
const router  = express.Router();
const { requestDataDeletion } = require('../controllers/dataDeletionController');

// POST /api/data-deletion  — public, no auth required
router.post('/', requestDataDeletion);

module.exports = router;
