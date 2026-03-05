const Message = require('../models/Message');
const Application = require('../models/Application');
const MaintenanceRequest = require('../models/MaintenanceRequest');
const Agreement = require('../models/Agreement');
const Property = require('../models/Property');

// @desc    Get role-based notification badge counts for the dashboard nav
// @route   GET /api/notifications/counts
// @access  Private
const getNotificationCounts = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;
    const counts = {};

    // ── Messages (all roles) ────────────────────────────────────────
    counts.messages = await Message.countDocuments({ receiver: userId, isRead: false });

    if (role === 'landlord') {
      // Pending applications waiting for landlord review
      counts.applications = await Application.countDocuments({ landlord: userId, status: 'pending' });

      // Open/in-progress maintenance requests on landlord's properties
      counts.maintenance = await MaintenanceRequest.countDocuments({
        landlord: userId,
        status: { $in: ['open', 'in_progress'] },
      });

      // Agreements requiring landlord's signature
      counts.agreements = await Agreement.countDocuments({
        landlord: userId,
        status: 'sent',
        'signatures.landlord.signed': false,
      });

    } else if (role === 'tenant') {
      // Maintenance requests submitted by this tenant that are still open
      counts.maintenance = await MaintenanceRequest.countDocuments({
        tenant: userId,
        status: { $in: ['open', 'in_progress'] },
      });

    } else if (role === 'property_manager') {
      // Maintenance assigned to this PM that are open/in-progress
      counts.maintenance = await MaintenanceRequest.countDocuments({
        assignedTo: userId,
        status: { $in: ['open', 'in_progress'] },
      });

    } else if (role === 'law_reviewer') {
      // Agreements pending legal review (active agreements without terminated/expired)
      counts.agreements = await Agreement.countDocuments({
        status: { $in: ['sent', 'signed', 'active'] },
      });

    } else if (role === 'admin') {
      // Pending applications across all landlords
      counts.applications = await Application.countDocuments({ status: 'pending' });
    }

    res.json(counts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getNotificationCounts };