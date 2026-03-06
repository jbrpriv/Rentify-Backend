const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  sendMessage,
  getConversation,
  getInbox,
  getUnreadCount,
  deleteMessage,
} = require('../controllers/messageController');
const { body, validationResult } = require('express-validator');

// Inbox (all conversations)
router.get('/', protect, getInbox);

// Unread count (for navbar badge)
router.get('/unread-count', protect, getUnreadCount);

// Send a message
router.post(
  '/',
  protect,
  [
    body('receiverId').notEmpty().withMessage('Receiver ID is required'),
    body('content').trim().notEmpty().withMessage('Message content cannot be empty'),
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }
    next();
  },
  sendMessage
);

// Get conversation thread
router.get('/:propertyId/:otherUserId', protect, getConversation);

// Delete a message
router.delete('/:id', protect, deleteMessage);

module.exports = router;
/**
 * @swagger
 * tags:
 *   name: Messages
 *   description: Real-time messaging between landlords and tenants
 *
 * /api/messages:
 *   post:
 *     summary: Send a message
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receiverId, content]
 *             properties:
 *               receiverId: { type: string }
 *               content: { type: string }
 *               agreementId: { type: string }
 *     responses:
 *       201: { description: Message sent }
 *
 * /api/messages/inbox:
 *   get:
 *     summary: Get inbox (list of conversations)
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Array of conversation summaries }
 *
 * /api/messages/conversation/{userId}:
 *   get:
 *     summary: Get full conversation with a specific user
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Array of messages }
 */