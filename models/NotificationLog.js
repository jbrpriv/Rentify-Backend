const mongoose = require('mongoose');

const notificationLogSchema = mongoose.Schema(
    {
        // ─── Recipient ─────────────────────────────────────────────────
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        // ─── Related Entities (optional) ───────────────────────────────
        agreement: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Agreement',
            default: null,
        },
        property: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Property',
            default: null,
        },
        payment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Payment',
            default: null,
        },

        // ─── Notification Content ───────────────────────────────────────
        type: {
            type: String,
            enum: [
                'rent_due',
                'rent_overdue',
                'late_fee_applied',
                'payment_received',
                'agreement_signed',
                'agreement_sent',
                'agreement_expiring',
                'agreement_expired',
                'agreement_renewed',
                'maintenance_update',
                'dispute_update',
                'document_expiring',
                'new_message',
                'general',
            ],
            required: true,
        },
        title: {
            type: String,
            required: true,
        },
        body: {
            type: String,
            required: true,
        },

        // ─── Delivery Channels ──────────────────────────────────────────
        channels: {
            email: { sent: { type: Boolean, default: false }, sentAt: { type: Date, default: null } },
            sms: { sent: { type: Boolean, default: false }, sentAt: { type: Date, default: null } },
            push: { sent: { type: Boolean, default: false }, sentAt: { type: Date, default: null } },
        },

        // ─── Read State ─────────────────────────────────────────────────
        isRead: {
            type: Boolean,
            default: false,
            index: true,
        },
        readAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

// Compound index for fast unread queries per user
notificationLogSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);