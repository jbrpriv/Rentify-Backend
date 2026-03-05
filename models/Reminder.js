/**
 * models/Reminder.js
 *
 * [FIX #3]  Dedicated Reminder collection.
 *
 * Previously the scheduler read directly from Agreement and queued jobs
 * without persisting reminder intent. The spec calls for a dedicated
 * reminders collection that:
 *   - records every reminder that was scheduled
 *   - tracks delivery status (pending → sent / failed)
 *   - allows admins to query reminder history per agreement / tenant
 *   - provides a deduplication key (jobId) so the scheduler never
 *     double-queues for the same period
 *
 * The rentScheduler.js is updated to write a Reminder document before
 * adding to the BullMQ queue.
 */

const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema(
  {
    // ─── Relation ────────────────────────────────────────────────────────────
    agreement: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Agreement',
      required: true,
      index:    true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },

    // ─── Type ────────────────────────────────────────────────────────────────
    type: {
      type: String,
      enum: [
        'RENT_DUE_REMINDER',       // 3-day advance notice before rent is due
        'RENT_OVERDUE',            // rent entry flipped to overdue
        'LATE_FEE_APPLIED',        // late fee stamped onto rent entry
        'AGREEMENT_EXPIRY_WARNING',// 30-day warning before lease end
        'RENT_ESCALATED',          // annual rent escalation fired
        'CUSTOM',                  // manually created by admin / landlord
      ],
      required: true,
    },

    // ─── Scheduling ──────────────────────────────────────────────────────────
    // The period this reminder refers to (e.g. the dueDate of the rent entry).
    // Used together with type as a natural deduplication key.
    periodDate: {
      type: Date,
    },

    // Deduplication key matching the BullMQ jobId
    jobId: {
      type:   String,
      unique: true,
      sparse: true, // allow null for manually created reminders
    },

    scheduledFor: {
      type:    Date,
      default: Date.now,
    },

    // ─── Delivery ────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['pending', 'sent', 'failed', 'skipped'],
      default: 'pending',
      index:   true,
    },

    // Set when the worker successfully delivers the notification
    sentAt: {
      type: Date,
    },

    // Error message if delivery failed
    failureReason: {
      type: String,
    },

    // Channels actually used for delivery
    channels: {
      email: { type: Boolean, default: false },
      sms:   { type: Boolean, default: false },
      push:  { type: Boolean, default: false },
      inApp: { type: Boolean, default: false },
    },

    // ─── Payload snapshot ───────────────────────────────────────────────────
    // Minimal context stored for audit / re-send capability
    meta: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// ─── Compound index for dedup queries in the scheduler ───────────────────────
// "Has a RENT_DUE_REMINDER already been created for agreement X in period Y?"
reminderSchema.index({ agreement: 1, type: 1, periodDate: 1 }, { unique: true, sparse: true });

// ─── Static helper used by rentScheduler ────────────────────────────────────
/**
 * findOrCreate — idempotent upsert used by the scheduler.
 *
 * Returns { doc, created } where `created` is true only when the document
 * was inserted for the first time. The scheduler uses this to decide whether
 * to also push to the BullMQ queue (avoids double-queuing on restart).
 */
reminderSchema.statics.findOrCreate = async function ({ agreement, type, periodDate, jobId, meta = {} }) {
  const filter = { agreement, type, periodDate };
  const update = {
    $setOnInsert: {
      agreement,
      type,
      periodDate,
      jobId,
      meta,
      status: 'pending',
    },
  };

  const doc = await this.findOneAndUpdate(filter, update, {
    upsert:    true,
    new:       true,
    setDefaultsOnInsert: true,
  });

  // Mongo returns the existing doc on upsert conflict; detect by comparing createdAt ≈ now
  const created = Date.now() - doc.createdAt.getTime() < 3000;
  return { doc, created };
};

module.exports = mongoose.model('Reminder', reminderSchema);
