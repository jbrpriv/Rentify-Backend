const express = require('express');
const router = express.Router();
const { protect, isAdmin } = require('../middlewares/authMiddleware');
const {
  fileDispute,
  getDisputes,
  getDisputeById,
  updateDispute,
  addComment,
} = require('../controllers/disputeController');

router.route('/')
  .get(protect, getDisputes)
  .post(protect, fileDispute);

router.route('/:id')
  .get(protect, getDisputeById)
  .put(protect, isAdmin, updateDispute);

router.post('/:id/comments', protect, addComment);

module.exports = router;

/**
 * @swagger
 * tags:
 *   name: Disputes
 *   description: Dispute filing and resolution
 *
 * /api/disputes:
 *   get:
 *     summary: Get disputes for the authenticated user
 *     tags: [Disputes]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Array of disputes }
 *   post:
 *     summary: File a new dispute
 *     tags: [Disputes]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [agreementId, title, description, category]
 *             properties:
 *               agreementId: { type: string }
 *               title: { type: string }
 *               description: { type: string }
 *               category: { type: string, enum: [maintenance, payment, noise, other] }
 *     responses:
 *       201: { description: Dispute filed }
 *
 * /api/disputes/{id}:
 *   put:
 *     summary: Update dispute status or add resolution note (admin/landlord)
 *     tags: [Disputes]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Dispute updated }
 */