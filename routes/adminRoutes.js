const express = require('express');
const router = express.Router();
const { protect, isAdmin, isLawReviewer } = require('../middlewares/authMiddleware');
const {
  getStats,
  getUsers,
  getUserById,
  toggleUserBan,
  changeUserRole,
  getAllAgreements,
  getAuditLogs,
  getClauses,
  createClause,
  reviewClause,
  archiveClause,
  getAllProperties,
  kickTenantFromProperty,
  getAdminAnalytics,
  getBillingUsers,
} = require('../controllers/adminController');

// ─── Platform Stats ───────────────────────────────────────────────────────────
router.get('/stats', protect, isAdmin, getStats);
router.get('/analytics', protect, isAdmin, getAdminAnalytics);

// ─── User Management ──────────────────────────────────────────────────────────
router.get('/users', protect, isAdmin, getUsers);
router.get('/users/:id', protect, isAdmin, getUserById);
router.put('/users/:id/ban', protect, isAdmin, toggleUserBan);
router.put('/users/:id/role', protect, isAdmin, changeUserRole);

// ─── Agreements Monitor ───────────────────────────────────────────────────────
router.get('/agreements', protect, isAdmin, getAllAgreements);

// ─── Property Management ─────────────────────────────────────────────────────
router.get('/properties', protect, isAdmin, getAllProperties);
router.post('/properties/:id/kick-tenant', protect, isAdmin, kickTenantFromProperty);

// ─── Audit Logs ───────────────────────────────────────────────────────────────
router.get('/audit-logs', protect, isAdmin, getAuditLogs);

// ─── Clause / Template Management (Admin + Law Reviewer) ─────────────────────
// isLawReviewer allows both admin and law_reviewer roles
router.get('/clauses', protect, isLawReviewer, getClauses);
router.post('/clauses', protect, isLawReviewer, createClause);
router.put('/clauses/:id/approve', protect, isLawReviewer, reviewClause);
router.put('/clauses/:id/archive', protect, isAdmin, archiveClause);

// ─── Document Verification ────────────────────────────────────────────────────
const { getPendingVerifications, getApprovedVerifications, approveVerification, rejectVerification } = require('../controllers/adminController');
router.get('/verifications/pending', protect, isAdmin, getPendingVerifications);
router.get('/verifications/approved', protect, isAdmin, getApprovedVerifications);
router.put('/verifications/:userId/approve', protect, isAdmin, approveVerification);
router.put('/verifications/:userId/reject', protect, isAdmin, rejectVerification);

// ─── Billing Overview ─────────────────────────────────────────────────────────
router.get('/billing/users', protect, isAdmin, getBillingUsers);

module.exports = router;