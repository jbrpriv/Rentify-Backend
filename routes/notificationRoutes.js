const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { getNotificationCounts } = require('../controllers/notificationController');

router.get('/counts', protect, getNotificationCounts);

module.exports = router;