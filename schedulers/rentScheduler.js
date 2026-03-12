/**
 * schedulers/rentScheduler.js
 *
 * [FIX #3]  Now writes to the Reminder collection before queuing jobs.
 *           findOrCreate() provides idempotency — safe to run on restart.
 *
 * [FIX #2]  console.error/log replaced with structured Winston logger.
 */

const cron             = require('node-cron');
const Agreement        = require('../models/Agreement');
const Reminder         = require('../models/Reminder');            // ← FIX #3
const notificationQueue = require('../queues/notificationQueue');
const logger           = require('../utils/logger');               // ← FIX #2

// ─── Helper: queue + record ──────────────────────────────────────────────────
/**
 * Persist a Reminder document and conditionally push to BullMQ.
 * If the Reminder already exists (scheduler restart) we skip re-queuing.
 */
async function scheduleReminder({ agreement, type, periodDate, jobId, queuePayload }) {
  const { created } = await Reminder.findOrCreate({
    agreement: agreement._id,
    type,
    periodDate,
    jobId,
    meta: queuePayload.data || {},
  });

  if (created) {
    await notificationQueue.add(jobId, queuePayload, { jobId });
    logger.debug('Reminder queued', { type, jobId });
  }
}

const startRentScheduler = () => {

  // ─── Daily 8AM: Rent Reminders + Expiry Warnings ─────────────────────────
  cron.schedule('0 8 * * *', async () => {
    logger.info('⏰ Running daily rent reminder check...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const activeAgreements = await Agreement.find({ status: 'active' });

      for (const agreement of activeAgreements) {
        const startDate = new Date(agreement.term.startDate);

        const nextDueDate = new Date(
          today.getFullYear(),
          today.getMonth(),
          startDate.getDate()
        );

        if (nextDueDate < today) {
          nextDueDate.setMonth(nextDueDate.getMonth() + 1);
        }

        const daysUntilDue = Math.ceil((nextDueDate - today) / (1000 * 60 * 60 * 24));

        if (daysUntilDue === 3) {
          await scheduleReminder({
            agreement,
            type:        'RENT_DUE_REMINDER',
            periodDate:  nextDueDate,
            jobId:       `rent-${agreement._id}-${nextDueDate.getMonth()}`,
            queuePayload: {
              type: 'RENT_DUE_REMINDER',
              data: {
                agreementId: agreement._id.toString(),
                dueDate:     nextDueDate.toISOString(),
              },
            },
          });
        }

        const endDate          = new Date(agreement.term.endDate);
        const daysUntilExpiry  = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

        if (daysUntilExpiry === 30) {
          await scheduleReminder({
            agreement,
            type:        'AGREEMENT_EXPIRY_WARNING',
            periodDate:  endDate,
            jobId:       `expiry-${agreement._id}`,
            queuePayload: {
              type: 'AGREEMENT_EXPIRY_WARNING',
              data: { agreementId: agreement._id.toString() },
            },
          });
        }
      }
    } catch (error) {
      logger.error('Scheduler error (reminders)', { err: error.message, stack: error.stack });
    }
  });

  // ─── Daily 9AM: Auto Late Fee Application ────────────────────────────────
  cron.schedule('0 9 * * *', async () => {
    logger.info('💸 Running daily late fee check...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const activeAgreements = await Agreement.find({
        status: 'active',
        'rentSchedule.0': { $exists: true },
      })
        .populate('tenant',   'name email phoneNumber smsOptIn')
        .populate('property', 'title');

      let feeCount = 0;

      for (const agreement of activeAgreements) {
        let modified = false;
        const gracePeriodDays = agreement.financials.lateFeeGracePeriodDays || 5;
        const lateFeeAmount   = agreement.financials.lateFeeAmount || 0;

        if (lateFeeAmount === 0) continue;

        for (const entry of agreement.rentSchedule) {
          if (entry.status !== 'pending' && entry.status !== 'overdue') continue;

          const dueDate = new Date(entry.dueDate);
          dueDate.setHours(0, 0, 0, 0);

          const daysPastDue       = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
          const statusBeforeThisRun = entry.status;

          if (daysPastDue > 0 && entry.status === 'pending') {
            entry.status = 'overdue';
            modified     = true;

            await scheduleReminder({
              agreement,
              type:        'RENT_OVERDUE',
              periodDate:  dueDate,
              jobId:       `overdue-${agreement._id}-${dueDate.getMonth()}`,
              queuePayload: {
                type: 'RENT_OVERDUE',
                data: { agreementId: agreement._id.toString() },
              },
            });
          }

          if (
            daysPastDue > gracePeriodDays &&
            statusBeforeThisRun === 'overdue' &&
            !entry.lateFeeApplied
          ) {
            entry.lateFeeApplied  = true;
            entry.lateFeeAmount   = lateFeeAmount;
            entry.status          = 'late_fee_applied';
            entry.amount          = entry.amount + lateFeeAmount;
            modified              = true;
            feeCount++;

            agreement.auditLog.push({
              action:    'LATE_FEE_APPLIED',
              timestamp: new Date(),
              details:   `Late fee of $${lateFeeAmount} applied to ${entry.dueDate} rent entry. ${daysPastDue} days past due.`,
            });

            const t = agreement.tenant;
            if (t) {
              await scheduleReminder({
                agreement,
                type:        'LATE_FEE_APPLIED',
                periodDate:  dueDate,
                jobId:       `late-fee-${agreement._id}-${dueDate.getMonth()}`,
                queuePayload: {
                  type: 'LATE_FEE_APPLIED',
                  data: {
                    tenantId:       t._id?.toString(),
                    tenantEmail:    t.email,
                    tenantPhone:    t.phoneNumber,
                    tenantName:     t.name,
                    tenantSmsOptIn: t.smsOptIn,
                    propertyTitle:  agreement.property?.title || 'your property',
                    feeAmount:      lateFeeAmount,
                    dueDate:        entry.dueDate,
                  },
                },
              });
            }

            logger.info(`Late fee applied`, { agreementId: agreement._id, dueDate: entry.dueDate, amount: lateFeeAmount });
          }
        }

        if (modified) await agreement.save();
      }

      logger.info(`✅ Late fee check complete`, { feesApplied: feeCount });
    } catch (error) {
      logger.error('Scheduler error (late fees)', { err: error.message, stack: error.stack });
    }
  });

  // ─── Daily Midnight: Expire ended leases + retention ─────────────────────
  cron.schedule('0 0 * * *', async () => {
    logger.info('🔄 Checking for expired leases...');
    try {
      const today = new Date();

      const result = await Agreement.updateMany(
        { status: 'active', 'term.endDate': { $lt: today } },
        {
          status: 'expired',
          $push: {
            auditLog: {
              action:    'AUTO_EXPIRED',
              timestamp: new Date(),
              details:   'Lease automatically marked as expired by scheduler.',
            },
          },
        }
      );

      if (result.modifiedCount > 0) {
        logger.info(`Leases expired`, { count: result.modifiedCount });
      }

      const retentionDeadline = new Date(today);
      retentionDeadline.setFullYear(retentionDeadline.getFullYear() + 7);

      await Agreement.updateMany(
        { status: 'expired', retentionExpiry: null, 'term.endDate': { $lt: today } },
        { retentionExpiry: retentionDeadline }
      );
    } catch (error) {
      logger.error('Scheduler error (expiry)', { err: error.message, stack: error.stack });
    }
  });

  // ─── Weekly Sunday Midnight: Document retention purge ────────────────────
  cron.schedule('0 0 * * 0', async () => {
    try {
      const now = new Date();
      const expired = await Agreement.find({
        retentionExpiry:      { $lt: now, $ne: null },
        documentsArchivedAt:  null,
      }).select('_id documentUrl');

      for (const agr of expired) {
        await Agreement.findByIdAndUpdate(agr._id, {
          documentsArchivedAt: now,
          $push: {
            auditLog: {
              action:    'DOCUMENTS_ARCHIVED',
              timestamp: now,
              details:   'Document retention period exceeded. Documents flagged for archival.',
            },
          },
        });
      }

      if (expired.length > 0) {
        logger.info(`Documents flagged for archival`, { count: expired.length });
      }
    } catch (error) {
      logger.error('Scheduler error (retention purge)', { err: error.message, stack: error.stack });
    }
  });

  // ─── Daily 10AM: Rent Escalation ─────────────────────────────────────────
  cron.schedule('0 10 * * *', async () => {
    logger.info('📈 Running daily rent escalation check...');
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const agreements = await Agreement.find({
        status: 'active',
        'rentEscalation.enabled':        true,
        'rentEscalation.nextScheduledAt': { $lte: today },
      })
        .populate('tenant',   'name email phoneNumber smsOptIn')
        .populate('landlord', 'name email');

      for (const agreement of agreements) {
        const pct = agreement.rentEscalation.percentage || 0;
        if (pct <= 0) continue;

        const oldRent  = agreement.financials.rentAmount;
        const increase = Math.round(oldRent * (pct / 100));
        const newRent  = oldRent + increase;

        agreement.financials.rentAmount = newRent;

        agreement.rentSchedule = agreement.rentSchedule.map((entry) => {
          if (entry.status === 'pending' && new Date(entry.dueDate) > today) {
            return { ...entry.toObject(), amount: newRent };
          }
          return entry;
        });

        const nextDate = new Date(today);
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        agreement.rentEscalation.lastAppliedAt   = today;
        agreement.rentEscalation.nextScheduledAt = nextDate;

        agreement.auditLog.push({
          action:    'RENT_ESCALATED',
          timestamp: new Date(),
          details:   `Rent increased by ${pct}% from $${oldRent.toLocaleString()} to $${newRent.toLocaleString()}. Next escalation: ${nextDate.toDateString()}.`,
        });

        await agreement.save();

        await scheduleReminder({
          agreement,
          type:        'RENT_ESCALATED',
          periodDate:  today,
          jobId:       `escalation-${agreement._id}-${today.getFullYear()}`,
          queuePayload: {
            type: 'RENT_ESCALATED',
            data: {
              agreementId: agreement._id.toString(),
              tenantEmail: agreement.tenant?.email,
              tenantName:  agreement.tenant?.name,
              oldRent,
              newRent,
              percentage:  pct,
            },
          },
        });

        logger.info(`Rent escalated`, { agreementId: agreement._id, oldRent, newRent });
      }
    } catch (error) {
      logger.error('Scheduler error (escalation)', { err: error.message, stack: error.stack });
    }
  });

  logger.info('✅ Rent scheduler started (reminders @8AM, late fees @9AM, expiry @midnight, retention @Sunday, escalation @10AM)');
};

module.exports = { startRentScheduler };
