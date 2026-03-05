const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
    getNotificationCounts,
    getMyNotifications,
    markOneRead,
    markAllRead,
} = require('../controllers/notificationController');

router.get('/', protect, getMyNotifications);
router.get('/counts', protect, getNotificationCounts);
router.patch('/read-all', protect, markAllRead);
router.patch('/:id/read', protect, markOneRead);

module.exports = router;