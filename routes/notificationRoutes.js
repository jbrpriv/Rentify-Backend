const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { notificationCountLimiter } = require('../middlewares/rateLimiter');
const {
    getNotificationCounts,
    getMyNotifications,
    markOneRead,
    markAllRead,
} = require('../controllers/notificationController');

router.get('/', protect, getMyNotifications);
router.get('/counts', protect, notificationCountLimiter, getNotificationCounts);
router.patch('/read-all', protect, markAllRead);
router.patch('/:id/read', protect, markOneRead);

module.exports = router;
/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notification management
 *
 * /api/notifications:
 *   get:
 *     summary: Get notifications for the authenticated user
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: Paginated notifications }
 *
 * /api/notifications/counts:
 *   get:
 *     summary: Get unread notification count
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 unreadCount: { type: integer }
 *
 * /api/notifications/{id}/read:
 *   patch:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Notification marked as read }
 *
 * /api/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: All notifications marked as read }
 */