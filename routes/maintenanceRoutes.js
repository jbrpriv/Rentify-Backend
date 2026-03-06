const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middlewares/authMiddleware');
const {
  createRequest,
  getRequests,
  getRequestById,
  updateRequest,
  deleteRequest,
} = require('../controllers/maintenanceController');
const { body } = require('express-validator');

// GET all + POST new
router.route('/')
  .get(protect, getRequests)
  .post(
    protect,
    requireRole('tenant'),
    [
      body('propertyId').notEmpty().withMessage('Property ID is required'),
      body('title').trim().notEmpty().withMessage('Title is required'),
      body('description').trim().notEmpty().withMessage('Description is required'),
      body('priority').optional().isIn(['low', 'medium', 'urgent']),
      body('category').optional().isIn(['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'pest', 'other']),
    ],
    createRequest
  );

// GET single + PUT update + DELETE
router.route('/:id')
  .get(protect, getRequestById)
  .put(protect, requireRole('landlord', 'property_manager', 'admin'), updateRequest)
  .delete(protect, deleteRequest);

module.exports = router;
/**
 * @swagger
 * tags:
 *   name: Maintenance
 *   description: Maintenance request management
 *
 * /api/maintenance:
 *   get:
 *     summary: Get maintenance requests (role-filtered)
 *     tags: [Maintenance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Array of maintenance requests }
 *   post:
 *     summary: Submit a maintenance request (tenant only)
 *     tags: [Maintenance]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, title, description, category]
 *             properties:
 *               propertyId: { type: string }
 *               title: { type: string }
 *               description: { type: string }
 *               category: { type: string, enum: [plumbing, electrical, structural, appliance, other] }
 *               priority: { type: string, enum: [low, medium, urgent] }
 *     responses:
 *       201: { description: Request created }
 *
 * /api/maintenance/{id}:
 *   put:
 *     summary: Update a maintenance request status or notes
 *     tags: [Maintenance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Request updated }
 *   delete:
 *     summary: Delete a maintenance request (creator only)
 *     tags: [Maintenance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Request deleted }
 */