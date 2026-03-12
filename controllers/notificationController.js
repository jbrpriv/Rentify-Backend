const logger = require('../utils/logger');
const Message = require('../models/Message');
const MaintenanceRequest = require('../models/MaintenanceRequest');
const Agreement = require('../models/Agreement');
const NotificationLog = require('../models/NotificationLog');

// ─── Helper: persist a notification log entry ──────────────────────────────
// Call this from notificationWorker or anywhere a notification is dispatched.
const logNotification = async ({
  userId,
  type,
  title,
  body,
  agreementId = null,
  propertyId = null,
  paymentId = null,
  channels = {},
}) => {
  try {
    await NotificationLog.create({
      user: userId,
      type,
      title,
      body,
      agreement: agreementId,
      property: propertyId,
      payment: paymentId,
      channels: {
        email: { sent: !!channels.email, sentAt: channels.email ? new Date() : null },
        sms: { sent: !!channels.sms, sentAt: channels.sms ? new Date() : null },
        push: { sent: !!channels.push, sentAt: channels.push ? new Date() : null },
      },
    });
  } catch (err) {
    logger.error('[NotificationLog] Failed to persist', { err: err.message });
  }
};

// @desc    Get paginated notification history for the logged-in user
// @route   GET /api/notifications
// @access  Private
const getMyNotifications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const unreadOnly = req.query.unread === 'true';

    const filter = { user: req.user._id };
    if (unreadOnly) filter.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      NotificationLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('agreement', 'status term')
        .populate('property', 'title address')
        .lean(),
      NotificationLog.countDocuments(filter),
      NotificationLog.countDocuments({ user: req.user._id, isRead: false }),
    ]);

    res.json({
      notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark one notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
const markOneRead = async (req, res) => {
  try {
    const notification = await NotificationLog.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark ALL notifications as read for the logged-in user
// @route   PATCH /api/notifications/read-all
// @access  Private
const markAllRead = async (req, res) => {
  try {
    const result = await NotificationLog.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({ success: true, updated: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get role-based notification badge counts for the dashboard nav
// @route   GET /api/notifications/counts
// @access  Private
const getNotificationCounts = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;
    const counts = {};

    // Unread notification log entries
    counts.notifications = await NotificationLog.countDocuments({
      user: userId,
      isRead: false,
    });

    // Unread messages (all roles)
    counts.messages = await Message.countDocuments({ receiver: userId, isRead: false });

    if (role === 'landlord') {
      counts.maintenance = await MaintenanceRequest.countDocuments({
        landlord: userId,
        status: { $in: ['open', 'in_progress'] },
      });
      counts.agreements = await Agreement.countDocuments({
        landlord: userId,
        status: 'sent',
        'signatures.landlord.signed': false,
      });
    } else if (role === 'tenant') {
      counts.maintenance = await MaintenanceRequest.countDocuments({
        tenant: userId,
        status: { $in: ['open', 'in_progress'] },
      });
    } else if (role === 'property_manager') {
      counts.maintenance = await MaintenanceRequest.countDocuments({
        assignedTo: userId,
        status: { $in: ['open', 'in_progress'] },
      });
    } else if (role === 'law_reviewer') {
      counts.agreements = await Agreement.countDocuments({
        status: { $in: ['sent', 'signed', 'active'] },
      });
    }

    res.json(counts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  logNotification,
  getMyNotifications,
  markOneRead,
  markAllRead,
  getNotificationCounts,
};