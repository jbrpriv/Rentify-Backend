const express = require('express');
const router  = express.Router();
const { protect, requireRole } = require('../middlewares/authMiddleware');
const {
  createProperty, getProperties, getPropertyById, updateProperty, deleteProperty,
  assignManager, inviteManager, respondToInvitation, getMyInvitations,
  archiveProperty, restoreProperty,
} = require('../controllers/propertyController');
const { body } = require('express-validator');

router.route('/')
  .post(
    protect,
    requireRole('landlord', 'admin'),
    [
      body('title').trim().escape().notEmpty().withMessage('Title is required'),
      body('financials.monthlyRent').isNumeric().withMessage('Rent must be a number'),
      body('financials.securityDeposit').isNumeric().withMessage('Deposit must be a number'),
      body('address.city').trim().escape().notEmpty().withMessage('City is required'),
      body('address.street').trim().escape().notEmpty().withMessage('Street is required'),
    ],
    createProperty
  )
  .get(protect, getProperties);

router.get('/my-invitations', protect, requireRole('property_manager'), getMyInvitations);

router.route('/:id')
  .get(protect, getPropertyById)
  .put(protect, requireRole('landlord', 'admin'), updateProperty)
  .delete(protect, requireRole('landlord', 'admin'), deleteProperty);

router.post('/:id/invite-manager',     protect, requireRole('landlord', 'admin'),    inviteManager);
router.put( '/:id/respond-invitation', protect, requireRole('property_manager'),     respondToInvitation);
router.put( '/:id/assign-manager',     protect, requireRole('admin'),                assignManager);
router.put( '/:id/archive',            protect, requireRole('landlord', 'admin'),    archiveProperty);
router.put( '/:id/restore',            protect, requireRole('landlord', 'admin'),    restoreProperty);

module.exports = router;
