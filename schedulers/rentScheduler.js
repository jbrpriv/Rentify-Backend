const cron = require('node-cron');
const Agreement = require('../models/Agreement');
const notificationQueue = require('../queues/notificationQueue');

const startRentScheduler = () => {

  // ─── Daily 8AM: Rent Reminders + Expiry Warnings ─────────────────────────
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Running daily rent reminder check...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const activeAgreements = await Agreement.find({ status: 'active' });

      for (const agreement of activeAgreements) {
        const startDate = new Date(agreement.term.startDate);

        // Calculate next due date (same day-of-month as lease start)
        const nextDueDate = new Date(
          today.getFullYear(),
          today.getMonth(),
          startDate.getDate()
        );

        if (nextDueDate < today) {
          nextDueDate.setMonth(nextDueDate.getMonth() + 1);
        }

        const daysUntilDue = Math.ceil((nextDueDate - today) / (1000 * 60 * 60 * 24));

        // 3-day advance reminder
        if (daysUntilDue === 3) {
          await notificationQueue.add(
            `rent-reminder-${agreement._id}`,
            {
              type: 'RENT_DUE_REMINDER',
              data: {
                agreementId: agreement._id.toString(),
                dueDate: nextDueDate.toISOString(),
              },
            },
            { jobId: `rent-${agreement._id}-${nextDueDate.getMonth()}` }
          );
        }

        // 30-day lease expiry warning
        const endDate = new Date(agreement.term.endDate);
        const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

        if (daysUntilExpiry === 30) {
          await notificationQueue.add(
            `expiry-warning-${agreement._id}`,
            {
              type: 'AGREEMENT_EXPIRY_WARNING',
              data: { agreementId: agreement._id.toString() },
            },
            { jobId: `expiry-${agreement._id}` }
          );
        }
      }
    } catch (error) {
      console.error('Scheduler error (reminders):', error.message);
    }
  });

  // ─── Daily 9AM: Auto Late Fee Application ────────────────────────────────
  cron.schedule('0 9 * * *', async () => {
    console.log('💸 Running daily late fee check...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all active agreements that have a rent schedule
      const activeAgreements = await Agreement.find({
        status: 'active',
        'rentSchedule.0': { $exists: true },
      }).populate('tenant', 'name email phoneNumber smsOptIn')
        .populate('property', 'title');

      let feeCount = 0;

      for (const agreement of activeAgreements) {
        let modified = false;
        const gracePeriodDays = agreement.financials.lateFeeGracePeriodDays || 5;
        const lateFeeAmount = agreement.financials.lateFeeAmount || 0;

        if (lateFeeAmount === 0) continue; // Skip if no late fee configured

        for (const entry of agreement.rentSchedule) {
          if (entry.status !== 'pending' && entry.status !== 'overdue') continue;

          const dueDate = new Date(entry.dueDate);
          dueDate.setHours(0, 0, 0, 0);

          const daysPastDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

          // Snapshot the status BEFORE any in-memory mutations this iteration.
          // This prevents the late-fee block from immediately firing on an entry
          // that was just flipped to 'overdue' in the same loop pass (Bug 4).
          const statusBeforeThisRun = entry.status;

          // Mark as overdue as soon as it's past due date
          if (daysPastDue > 0 && entry.status === 'pending') {
            entry.status = 'overdue';
            modified = true;

            // Queue overdue notification
            await notificationQueue.add(
              `overdue-${agreement._id}-${entry.dueDate}`,
              {
                type: 'RENT_OVERDUE',
                data: { agreementId: agreement._id.toString() },
              },
              { jobId: `overdue-${agreement._id}-${dueDate.getMonth()}` }
            );
          }

          // Apply late fee after grace period — but ONLY if the entry was
          // already 'overdue' before the current scheduler run began.
          // This ensures tenants always see a grace-period window (Bug 4).
          if (
            daysPastDue > gracePeriodDays &&
            statusBeforeThisRun === 'overdue' &&
            !entry.lateFeeApplied
          ) {
            entry.lateFeeApplied = true;
            entry.lateFeeAmount = lateFeeAmount;
            entry.status = 'late_fee_applied';
            entry.amount = entry.amount + lateFeeAmount; // Total now includes late fee
            modified = true;
            feeCount++;

            // Log in audit trail
            agreement.auditLog.push({
              action: 'LATE_FEE_APPLIED',
              timestamp: new Date(),
              details: `Late fee of Rs. ${lateFeeAmount} applied to ${entry.dueDate} rent entry. ${daysPastDue} days past due.`,
            });

            // Notify tenant
            const t = agreement.tenant;
            if (t) {
              await notificationQueue.add(
                `late-fee-${agreement._id}-${entry.dueDate}`,
                {
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
                { jobId: `late-fee-${agreement._id}-${dueDate.getMonth()}` }
              );
            }

            console.log(`💸 Late fee applied for agreement ${agreement._id}, due ${entry.dueDate}`);
          }
        }

        if (modified) {
          await agreement.save();
        }
      }

      console.log(`✅ Late fee check complete. ${feeCount} fees applied.`);
    } catch (error) {
      console.error('Scheduler error (late fees):', error.message);
    }
  });

  // ─── Daily Midnight: Expire ended leases ─────────────────────────────────
  cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Checking for expired leases...');
    try {
      const today = new Date();

      const result = await Agreement.updateMany(
        {
          status: 'active',
          'term.endDate': { $lt: today },
        },
        {
          status: 'expired',
          $push: {
            auditLog: {
              action: 'AUTO_EXPIRED',
              timestamp: new Date(),
              details: 'Lease automatically marked as expired by scheduler.',
            },
          },
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ ${result.modifiedCount} lease(s) marked as expired.`);
      }

      // ── Set document retention expiry on newly expired leases ────────────
      // Regulation: retain for 7 years after lease end (legal standard)
      const retentionDeadline = new Date(today);
      retentionDeadline.setFullYear(retentionDeadline.getFullYear() + 7);

      await Agreement.updateMany(
        {
          status: 'expired',
          retentionExpiry: null,
          'term.endDate': { $lt: today },
        },
        { retentionExpiry: retentionDeadline }
      );
    } catch (error) {
      console.error('Scheduler error (expiry):', error.message);
    }
  });

  // ── Document retention purge — run weekly on Sunday midnight ─────────────
  cron.schedule('0 0 * * 0', async () => {
    try {
      const now = new Date();
      // Find agreements whose retention period has passed
      const expired = await Agreement.find({
        retentionExpiry: { $lt: now, $ne: null },
        documentsArchivedAt: null,
      }).select('_id documentUrl');

      for (const agr of expired) {
        // Mark documents as archived (actual S3 deletion/glaciering handled separately)
        await Agreement.findByIdAndUpdate(agr._id, {
          documentsArchivedAt: now,
          $push: {
            auditLog: {
              action:    'DOCUMENTS_ARCHIVED',
              timestamp: now,
              details:   'Document retention period exceeded. Documents flagged for archival per retention policy.',
            },
          },
        });
      }

      if (expired.length > 0) {
        console.log(`🗂️  ${expired.length} agreement(s) flagged for document archival (retention expired).`);
      }
    } catch (error) {
      console.error('Scheduler error (retention purge):', error.message);
    }
  });

  console.log('✅ Rent scheduler started (reminders @8AM, late fees @9AM, expiry @midnight, retention @Sunday)');

  // ─── Daily 10AM: Rent Escalation ─────────────────────────────────────────
  cron.schedule('0 10 * * *', async () => {
    console.log('📈 Running daily rent escalation check...');
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find active agreements with escalation enabled and due today or overdue
      const agreements = await Agreement.find({
        status: 'active',
        'rentEscalation.enabled': true,
        'rentEscalation.nextScheduledAt': { $lte: today },
      }).populate('tenant', 'name email phoneNumber smsOptIn')
        .populate('landlord', 'name email');

      for (const agreement of agreements) {
        const pct = agreement.rentEscalation.percentage || 0;
        if (pct <= 0) continue;

        const oldRent = agreement.financials.rentAmount;
        const increase = Math.round(oldRent * (pct / 100));
        const newRent  = oldRent + increase;

        // Apply new rent amount
        agreement.financials.rentAmount = newRent;

        // Update future unpaid rent schedule entries
        agreement.rentSchedule = agreement.rentSchedule.map(entry => {
          if (entry.status === 'pending' && new Date(entry.dueDate) > today) {
            return { ...entry.toObject(), amount: newRent };
          }
          return entry;
        });

        // Schedule next escalation (1 year from now)
        const nextDate = new Date(today);
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        agreement.rentEscalation.lastAppliedAt   = today;
        agreement.rentEscalation.nextScheduledAt = nextDate;

        agreement.auditLog.push({
          action:    'RENT_ESCALATED',
          timestamp: new Date(),
          details:   `Rent increased by ${pct}% from Rs. ${oldRent.toLocaleString()} to Rs. ${newRent.toLocaleString()}. Next escalation: ${nextDate.toDateString()}.`,
        });

        await agreement.save();

        // Notify tenant
        await notificationQueue.add(
          `escalation-${agreement._id}-${today.getFullYear()}`,
          {
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
          { jobId: `escalation-${agreement._id}-${today.getFullYear()}` }
        );

        console.log(`📈 Rent escalated for agreement ${agreement._id}: Rs. ${oldRent} → Rs. ${newRent}`);
      }
    } catch (error) {
      console.error('Scheduler error (escalation):', error.message);
    }
  });
};

module.exports = { startRentScheduler };