const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middlewares/authMiddleware');
const { getUserByEmail, getProfile, getMe, updateProfile, updatePreferences, getContacts, getLandlordAnalytics, submitVerificationDocuments } = require('../controllers/userController');

// Look up any user by email (used by landlord when creating agreements)
router.post('/lookup', protect, getUserByEmail);

// Own profile — get and update
router.get('/me', protect, getMe);
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.patch('/me/preferences', protect, updatePreferences);

// Messaging contacts based on role
router.get('/contacts', protect, getContacts);

// Landlord analytics
router.get('/landlord-analytics', protect, requireRole('landlord'), getLandlordAnalytics);

// Document verification submission (landlord + property_manager)
router.post('/verification/submit', protect, submitVerificationDocuments);

module.exports = router;