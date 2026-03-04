const { Worker } = require('bullmq');
const redisConnection = require('../config/redis');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');
const Agreement      = require('../models/Agreement');
const User           = require('../models/User');
const { sendPush }   = require('../utils/firebaseService');

const notificationWorker = new Worker(
  'notifications',
  async (job) => {
    const { type, data } = job.data;
    console.log(`Processing job [${type}] - Job ID: ${job.id}`);

    // Helper: send push if user has FCM token
    const pushToUser = async (userId, template, ...args) => {
      try {
        const u = await User.findById(userId).select('fcmToken');
        if (u?.fcmToken) await sendPush(u.fcmToken, template, ...args);
      } catch {}
    };

    switch (type) {

      case 'RENT_DUE_REMINDER': {
        const { agreementId, dueDate } = data;

        const agreement = await Agreement.findById(agreementId)
          .populate('tenant', 'name email phoneNumber smsOptIn')
          .populate('property', 'title');

        if (!agreement) throw new Error(`Agreement ${agreementId} not found`);

        if (agreement.status !== 'active') {
          console.log(`Skipping reminder — agreement ${agreementId} is ${agreement.status}`);
          return;
        }

        const { tenant, property, financials } = agreement;

        // Always send email
        await sendEmail(
          tenant.email,
          'rentDueReminder',
          tenant.name,
          property.title,
          financials.rentAmount,
          dueDate
        );

        // Send SMS only if tenant has opted in
        if (tenant.smsOptIn && tenant.phoneNumber) {
          await sendSMS(
            tenant.phoneNumber,
            'rentDueReminder',
            property.title,
            financials.rentAmount,
            dueDate
          );
        }

        // Push notification
        await pushToUser(tenant._id, 'rentDueReminder', financials.rentAmount, property.title);

        // Log to audit trail
        agreement.auditLog.push({
          action: 'REMINDER_SENT',
          timestamp: new Date(),
          details: `Rent due reminder sent for ${dueDate}`,
        });
        await agreement.save();
        break;
      }

      case 'RENT_OVERDUE': {
        const { agreementId } = data;

        const agreement = await Agreement.findById(agreementId)
          .populate('tenant', 'name email phoneNumber smsOptIn')
          .populate('property', 'title');

        if (!agreement || agreement.status !== 'active') return;

        const { tenant, property, financials } = agreement;

        await sendEmail(
          tenant.email,
          'rentOverdue',
          tenant.name,
          property.title,
          financials.rentAmount,
          new Date()
        );

        if (tenant.smsOptIn && tenant.phoneNumber) {
          await sendSMS(
            tenant.phoneNumber,
            'rentOverdue',
            property.title,
            financials.rentAmount
          );
        }

        // Push notification
        await pushToUser(tenant._id, 'rentOverdue', financials.rentAmount, property.title);

        agreement.auditLog.push({
          action: 'OVERDUE_NOTICE_SENT',
          timestamp: new Date(),
          details: 'Overdue rent notice sent to tenant.',
        });
        await agreement.save();
        break;
      }

      case 'AGREEMENT_EXPIRY_WARNING': {
        const { agreementId } = data;

        const agreement = await Agreement.findById(agreementId)
          .populate('tenant', 'name email phoneNumber smsOptIn')
          .populate('landlord', 'name email phoneNumber smsOptIn')
          .populate('property', 'title');

        if (!agreement) return;

        const expiryDate = new Date(agreement.term.endDate).toDateString();
        const daysLeft = Math.ceil((new Date(agreement.term.endDate) - new Date()) / (1000 * 60 * 60 * 24));

        // Notify tenant
        await sendEmail(
          agreement.tenant.email,
          'expiryWarning',
          agreement.tenant.name,
          agreement.property.title,
          expiryDate,
          'tenant'
        );
        if (agreement.tenant.smsOptIn && agreement.tenant.phoneNumber) {
          await sendSMS(
            agreement.tenant.phoneNumber,
            'expiryWarning',
            agreement.property.title,
            expiryDate
          );
        }
        await pushToUser(agreement.tenant._id, 'leaseExpiring', agreement.property.title, daysLeft);

        // Notify landlord
        await sendEmail(
          agreement.landlord.email,
          'expiryWarning',
          agreement.landlord.name,
          agreement.property.title,
          expiryDate,
          'landlord'
        );
        if (agreement.landlord.smsOptIn && agreement.landlord.phoneNumber) {
          await sendSMS(
            agreement.landlord.phoneNumber,
            'expiryWarning',
            agreement.property.title,
            expiryDate
          );
        }
        await pushToUser(agreement.landlord._id, 'leaseExpiring', agreement.property.title, daysLeft);
        break;
      }

      case 'APPLICATION_ACCEPTED': {
        const { tenantEmail, tenantPhone, tenantName, propertyTitle, tenantSmsOptIn, tenantId } = data;

        await sendEmail(tenantEmail, 'applicationAccepted', tenantName, propertyTitle);

        if (tenantSmsOptIn && tenantPhone) {
          await sendSMS(tenantPhone, 'applicationAccepted', propertyTitle);
        }

        // Push if we have tenant userId
        if (tenantId) await pushToUser(tenantId, 'applicationUpdate', propertyTitle, 'accepted');
        break;
      }

      case 'APPLICATION_REJECTED': {
        const { tenantEmail, tenantPhone, tenantName, propertyTitle, tenantSmsOptIn, tenantId } = data;

        await sendEmail(tenantEmail, 'applicationRejected', tenantName, propertyTitle);

        if (tenantSmsOptIn && tenantPhone) {
          await sendSMS(tenantPhone, 'applicationRejected', propertyTitle);
        }

        // Push if we have tenant userId
        if (tenantId) await pushToUser(tenantId, 'applicationUpdate', propertyTitle, 'rejected');
        break;
      }

      case 'MAINTENANCE_RECEIVED': {
        const {
          landlordEmail, landlordPhone, landlordSmsOptIn,
          landlordName, tenantName, propertyTitle, requestTitle, landlordId,
        } = data;

        await sendEmail(
          landlordEmail,
          'newMaintenanceRequest',
          landlordName || 'Landlord',
          tenantName,
          propertyTitle,
          requestTitle,
          'medium'
        );

        if (landlordSmsOptIn && landlordPhone) {
          await sendSMS(
            landlordPhone,
            'maintenanceReceived',
            propertyTitle,
            requestTitle,
            tenantName
          );
        }

        // Push if we have landlord userId
        if (landlordId) await pushToUser(landlordId, 'maintenanceUpdate', requestTitle, 'new request received');
        break;
      }

      case 'MAINTENANCE_UPDATE': {
        const { tenantEmail, tenantPhone, tenantName, requestTitle, newStatus, tenantSmsOptIn, tenantId } = data;

        // Email notification for status change
        await sendEmail(tenantEmail, 'maintenanceUpdate', tenantName, requestTitle, newStatus);

        if (tenantSmsOptIn && tenantPhone) {
          await sendSMS(tenantPhone, 'maintenanceUpdate', requestTitle, newStatus);
        }

        // Push if we have tenant userId
        if (tenantId) await pushToUser(tenantId, 'maintenanceUpdate', requestTitle, newStatus);
        break;
      }

      case 'RENT_ESCALATED': {
        const { agreementId, tenantEmail, tenantName, oldRent, newRent, percentage } = data;

        const agreement = await Agreement.findById(agreementId)
          .populate('tenant', 'name email phoneNumber smsOptIn')
          .populate('landlord', 'name email')
          .populate('property', 'title');

        const tenant   = agreement?.tenant;
        const landlord = agreement?.landlord;

        if (tenant) {
          await sendEmail(
            tenant.email || tenantEmail,
            'rentEscalated',
            tenant.name || tenantName,
            agreement?.property?.title,
            oldRent,
            newRent,
            percentage
          );
          if (tenant.smsOptIn && tenant.phoneNumber) {
            await sendSMS(
              tenant.phoneNumber,
              'rentEscalated',
              agreement?.property?.title,
              oldRent,
              newRent
            );
          }
          await pushToUser(tenant._id, 'rentEscalated', newRent, agreement?.property?.title);
        }

        // Notify landlord too
        if (landlord) {
          await sendEmail(
            landlord.email,
            'rentEscalatedLandlord',
            landlord.name,
            agreement?.property?.title,
            oldRent,
            newRent,
            percentage
          );
        }
        break;
      }

      case 'LATE_FEE_APPLIED': {
        const { tenantEmail, tenantPhone, tenantName, propertyTitle, feeAmount, dueDate, tenantSmsOptIn, tenantId } = data;

        await sendEmail(tenantEmail, 'lateFeeApplied', tenantName, propertyTitle, feeAmount, dueDate);

        if (tenantSmsOptIn && tenantPhone) {
          await sendSMS(tenantPhone, 'lateFeeApplied', propertyTitle, feeAmount);
        }

        if (tenantId) await pushToUser(tenantId, 'lateFeeApplied', feeAmount, propertyTitle);
        break;
      }

      case 'NEW_MESSAGE_OFFLINE': {
        // M9: Notify a user who is offline that they received a new message
        const {
          receiverEmail, receiverName, receiverPhone,
          receiverSmsOptIn, senderName, preview, propertyTitle,
        } = data;

        await sendEmail(
          receiverEmail,
          'newMessageOffline',
          receiverName,
          senderName,
          preview,
          propertyTitle
        );

        if (receiverSmsOptIn && receiverPhone) {
          await sendSMS(
            receiverPhone,
            'newMessageOffline',
            senderName,
            propertyTitle
          );
        }
        break;
      }

      default:
        console.warn(`Unknown job type: ${type}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

// ─── Worker event listeners ───────────────────────────────────────────────────
notificationWorker.on('completed', (job) => {
  console.log(`✅ Job completed [${job.data.type}] - ID: ${job.id}`);
});

notificationWorker.on('failed', (job, err) => {
  console.error(`❌ Job failed [${job.data.type}] - ID: ${job.id} - Error: ${err.message}`);
});

module.exports = notificationWorker;