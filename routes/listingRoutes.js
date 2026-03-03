const express = require('express');
const router  = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  getPublicListings,
  getListingById,
  submitOffer,
  getLandlordOffers,
  updateOfferStatus,
  toggleListingPublish,
  // Legacy aliases (still exported by the new controller for compatibility)
  applyForListing,
  getLandlordApplications,
  updateApplicationStatus,
} = require('../controllers/listingController');

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/', getPublicListings);

// ── Must be defined BEFORE /:id so Express doesn't treat 'offers' as an id ──
router.get('/offers',       protect, getLandlordOffers);       // landlord screening
router.get('/applications', protect, getLandlordApplications); // legacy alias

// ── Dynamic-id routes ─────────────────────────────────────────────────────────
router.get('/:id', getListingById);

// Offer submission (new)
router.post('/:id/offer', protect, submitOffer);

// Legacy apply route — still works, internally calls submitOffer with offerType='rent'
router.post('/:id/apply', protect, applyForListing);

// Offer / application status update
router.put('/offers/:id',       protect, updateOfferStatus);
router.put('/applications/:id', protect, updateApplicationStatus);

router.put('/:id/publish', protect, toggleListingPublish);

module.exports = router;