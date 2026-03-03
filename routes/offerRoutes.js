const express = require('express');
const router  = express.Router();
const { protect, requireRole } = require('../middlewares/authMiddleware');
const {
  getOffers, getOfferById, createOffer,
  counterOffer, acceptOffer, declineOffer, withdrawOffer,
} = require('../controllers/offerController');

// GET  /api/offers          → role-aware list
// POST /api/offers          → tenant submits initial offer
router.route('/')
  .get(protect, getOffers)
  .post(protect, requireRole('tenant'), createOffer);

// GET    /api/offers/:id    → single offer detail
// DELETE /api/offers/:id    → tenant withdraws offer
router.route('/:id')
  .get(protect, getOfferById)
  .delete(protect, requireRole('tenant'), withdrawOffer);

// POST /api/offers/:id/counter  → landlord or tenant counters
router.post('/:id/counter', protect, counterOffer);

// PUT /api/offers/:id/accept    → landlord accepts
router.put('/:id/accept', protect, requireRole('landlord'), acceptOffer);

// PUT /api/offers/:id/decline   → landlord declines
router.put('/:id/decline', protect, requireRole('landlord'), declineOffer);

module.exports = router;
