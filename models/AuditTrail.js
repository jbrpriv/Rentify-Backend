const mongoose = require('mongoose');

const auditTrailSchema = mongoose.Schema(
    {
        // ─── Actor ─────────────────────────────────────────────────────
        actor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        actorRole: {
            type: String,
            enum: ['landlord', 'tenant', 'admin', 'property_manager', 'law_reviewer', 'system'],
            required: true,
        },

        // ─── Action ────────────────────────────────────────────────────
        action: {
            type: String,
            enum: [
                // Auth
                'user_login', 'user_logout', 'user_registered', 'password_reset',
                'email_verified', '2fa_enabled', '2fa_disabled',
                // Agreements
                'agreement_created', 'agreement_updated', 'agreement_sent',
                'agreement_signed', 'agreement_activated', 'agreement_expired',
                'agreement_terminated', 'agreement_renewed',
                // Templates
                'template_created', 'template_updated', 'template_approved',
                'template_rejected', 'template_archived',
                // Payments
                'payment_created', 'payment_paid', 'payment_failed',
                'late_fee_applied', 'refund_issued',
                // Properties
                'property_created', 'property_updated', 'property_deleted',
                // Users (admin)
                'user_suspended', 'user_reactivated', 'user_role_changed',
                // Documents
                'document_uploaded', 'document_downloaded', 'document_deleted',
                // Disputes
                'dispute_opened', 'dispute_resolved', 'dispute_closed',
                // System
                'system_scheduler', 'system_error',
            ],
            required: true,
            index: true,
        },

        // ─── Resource ──────────────────────────────────────────────────
        resourceType: {
            type: String,
            enum: ['agreement', 'template', 'payment', 'property', 'user', 'document', 'dispute', 'system'],
            default: null,
        },
        resourceId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            index: true,
        },

        // ─── Details ───────────────────────────────────────────────────
        description: {
            type: String,
            default: '',
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        // ─── Request Context ───────────────────────────────────────────
        ipAddress: {
            type: String,
            default: null,
        },
        userAgent: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
        // Audit logs are immutable — no updates allowed
    }
);

// TTL: auto-delete audit logs older than 2 years
auditTrailSchema.index({ createdAt: 1 }, { expireAfterSeconds: 63072000 });
auditTrailSchema.index({ actor: 1, createdAt: -1 });
auditTrailSchema.index({ action: 1, createdAt: -1 });

// ─── Static helper to log from anywhere ────────────────────────────────────
auditTrailSchema.statics.log = async function ({
    actor,
    actorRole = 'system',
    action,
    resourceType = null,
    resourceId = null,
    description = '',
    metadata = {},
    ipAddress = null,
    userAgent = null,
}) {
    try {
        await this.create({
            actor,
            actorRole,
            action,
            resourceType,
            resourceId,
            description,
            metadata,
            ipAddress,
            userAgent,
        });
    } catch (err) {
        // Never crash the main flow for an audit write failure
        console.error('[AuditTrail] Failed to write log:', err.message);
    }
};

module.exports = mongoose.model('AuditTrail', auditTrailSchema);