const nodemailer = require('nodemailer');

// Lazy transporter — created on first use so a missing/wrong config
// does NOT crash the server on startup (just logs a warning when sending fails)
let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;

  const service = process.env.EMAIL_SERVICE;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!service || !user || !pass) {
    console.warn('⚠️  Email not configured (EMAIL_SERVICE / EMAIL_USER / EMAIL_PASS missing). Emails will be skipped.');
    return null;
  }

  _transporter = nodemailer.createTransport({ service, auth: { user, pass } });
  return _transporter;
};

// Base HTML template for all emails
const baseTemplate = (content) => `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
      .container { max-width: 600px; margin: 30px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      .header { background: #2563eb; color: white; padding: 24px 32px; }
      .header h1 { margin: 0; font-size: 24px; }
      .body { padding: 32px; color: #374151; line-height: 1.6; }
      .button { display: inline-block; background: #2563eb; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
      .footer { background: #f9fafb; padding: 16px 32px; text-align: center; color: #9ca3af; font-size: 13px; border-top: 1px solid #e5e7eb; }
      .detail-box { background: #f0f7ff; border-left: 4px solid #2563eb; padding: 16px; border-radius: 4px; margin: 16px 0; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header"><h1>🏠 RentifyPro</h1></div>
      <div class="body">${content}</div>
      <div class="footer">© ${new Date().getFullYear()} RentifyPro. This is an automated message.</div>
    </div>
  </body>
  </html>
`;

// ─── Email Templates ────────────────────────────────────────────────

const templates = {

  // Sent to tenant when a new agreement is created
  agreementCreated: (tenantName, landlordName, propertyTitle, startDate, endDate, rentAmount) => ({
    subject: `New Rental Agreement - ${propertyTitle}`,
    html: baseTemplate(`
      <h2>Hello ${tenantName},</h2>
      <p>A new rental agreement has been created for you by <strong>${landlordName}</strong>.</p>
      <div class="detail-box">
        <strong>Property:</strong> ${propertyTitle}<br/>
        <strong>Lease Start:</strong> ${new Date(startDate).toDateString()}<br/>
        <strong>Lease End:</strong> ${new Date(endDate).toDateString()}<br/>
        <strong>Monthly Rent:</strong> $${Number(rentAmount).toLocaleString()}
      </div>
      <p>Please log in to RentifyPro to review and sign your agreement.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/agreements" class="button">View Agreement</a>
    `)
  }),
  newApplication: (landlordName, tenantName, propertyTitle) => ({
    subject: `New Application Received - ${propertyTitle}`,
    html: baseTemplate(`
    <h2>Hello ${landlordName},</h2>
    <p>You have received a new rental application from <strong>${tenantName}</strong>.</p>
    <div class="detail-box">
      <strong>Property:</strong> ${propertyTitle}<br/>
      <strong>Applicant:</strong> ${tenantName}
    </div>
    <p>Log in to review and respond to this application.</p>
    <a href="${process.env.CLIENT_URL}/dashboard/applications" class="button">Review Application</a>
  `)
  }),

  applicationAccepted: (tenantName, propertyTitle) => ({
    subject: `Application Accepted - ${propertyTitle}`,
    html: baseTemplate(`
    <h2>Congratulations ${tenantName}! 🎉</h2>
    <p>Your rental application for <strong>${propertyTitle}</strong> has been <strong>accepted</strong>.</p>
    <p>A rental agreement has been created for you. Please log in to review and sign it.</p>
    <a href="${process.env.CLIENT_URL}/dashboard/my-lease" class="button">View & Sign Agreement</a>
  `)
  }),

  applicationRejected: (tenantName, propertyTitle) => ({
    subject: `Application Update - ${propertyTitle}`,
    html: baseTemplate(`
    <h2>Hello ${tenantName},</h2>
    <p>Thank you for your interest in <strong>${propertyTitle}</strong>.</p>
    <p>Unfortunately, the landlord has chosen another applicant at this time.</p>
    <p>Please continue browsing other available properties on RentifyPro.</p>
    <a href="${process.env.CLIENT_URL}/browse" class="button">Browse Listings</a>
  `)
  }),
  // Sent to landlord when tenant signs
  agreementSigned: (landlordName, tenantName, propertyTitle) => ({
    subject: `Agreement Signed - ${propertyTitle}`,
    html: baseTemplate(`
      <h2>Hello ${landlordName},</h2>
      <p>Good news! <strong>${tenantName}</strong> has signed the rental agreement for:</p>
      <div class="detail-box">
        <strong>Property:</strong> ${propertyTitle}
      </div>
      <p>The agreement is now active. You can download the signed copy from your dashboard.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/agreements" class="button">View Agreements</a>
    `)
  }),

  // Rent due reminder
  rentDueReminder: (tenantName, propertyTitle, amount, dueDate) => ({
    subject: `Rent Due Reminder - ${propertyTitle}`,
    html: baseTemplate(`
      <h2>Hello ${tenantName},</h2>
      <p>This is a friendly reminder that your rent is due soon.</p>
      <div class="detail-box">
        <strong>Property:</strong> ${propertyTitle}<br/>
        <strong>Amount Due:</strong> $${Number(amount).toLocaleString()}<br/>
        <strong>Due Date:</strong> ${new Date(dueDate).toDateString()}
      </div>
      <a href="${process.env.CLIENT_URL}/dashboard" class="button">Go to Dashboard</a>
    `)
  }),

  // Rent OVERDUE notice (urgent — tenant is already late)
  rentOverdue: (tenantName, propertyTitle, amount, dueDate) => ({
    subject: `⚠️ Rent Overdue - Immediate Action Required - ${propertyTitle}`,
    html: baseTemplate(`
      <h2 style="color:#dc2626;">Hello ${tenantName},</h2>
      <p>Your rent payment is <strong>overdue</strong>. Please make payment immediately to avoid additional late fees.</p>
      <div class="detail-box" style="border-left: 4px solid #dc2626;">
        <strong>Property:</strong> ${propertyTitle}<br/>
        <strong>Overdue Amount:</strong> $${Number(amount).toLocaleString()}<br/>
        <strong>Original Due Date:</strong> ${new Date(dueDate).toDateString()}
      </div>
      <p style="color:#dc2626;"><strong>Failure to pay may result in late fees and affect your tenancy.</strong></p>
      <a href="${process.env.CLIENT_URL}/dashboard/payments" class="button" style="background:#dc2626;">Pay Now</a>
    `)
  }),

  // Payment failed — prompt tenant to retry
  paymentFailed: (tenantName, agreementId) => ({
    subject: '❌ Payment Failed - Action Required',
    html: baseTemplate(`
      <h2 style="color:#dc2626;">Hello ${tenantName},</h2>
      <p>Your recent payment attempt was <strong>unsuccessful</strong>.</p>
      <p>Please update your payment details and try again to keep your rental agreement active.</p>
      <div class="detail-box" style="border-left: 4px solid #dc2626;">
        <strong>Agreement ID:</strong> ${agreementId}
      </div>
      <a href="${process.env.CLIENT_URL}/dashboard/my-lease" class="button" style="background:#dc2626;">Retry Payment</a>
    `)
  }),

  // Welcome email on registration
  welcome: (userName, role) => ({
    subject: 'Welcome to RentifyPro!',
    html: baseTemplate(`
      <h2>Welcome, ${userName}! 🎉</h2>
      <p>Your account has been created successfully as a <strong>${role}</strong>.</p>
      <p>Here's what you can do next:</p>
      ${role === 'landlord'
        ? '<p>➡️ Add your first property and generate a rental agreement.</p>'
        : '<p>➡️ Check your dashboard to view any agreements sent to you.</p>'
      }
      <a href="${process.env.CLIENT_URL}/dashboard" class="button">Go to Dashboard</a>
    `)
  }),

  expiryWarning: (name, propertyTitle, expiryDate, role) => ({
    subject: `Lease Expiring Soon - ${propertyTitle}`,
    html: baseTemplate(`
    <h2>Hello ${name},</h2>
    <p>This is a reminder that the rental agreement for <strong>${propertyTitle}</strong> 
    is expiring in <strong>30 days</strong>.</p>
    <div class="detail-box">
      <strong>Property:</strong> ${propertyTitle}<br/>
      <strong>Expiry Date:</strong> ${expiryDate}
    </div>
    ${role === 'landlord'
        ? '<p>Please contact your tenant to discuss renewal or next steps.</p>'
        : '<p>Please contact your landlord to discuss renewal or find alternative arrangements.</p>'
      }
    <a href="${process.env.CLIENT_URL}/dashboard/agreements" class="button">View Agreement</a>`)
  }),

  newMaintenanceRequest: (recipientName, tenantName, propertyTitle, requestTitle, priority) => ({
    subject: `New Maintenance Request - ${propertyTitle}`,
    html: baseTemplate(`
      <h2>Hello ${recipientName},</h2>
      <p>A new maintenance request has been submitted by <strong>${tenantName}</strong>.</p>
      <div class="detail-box">
        <strong>Property:</strong> ${propertyTitle}<br/>
        <strong>Issue:</strong> ${requestTitle}<br/>
        <strong>Priority:</strong> <span style="color:${priority === 'urgent' ? '#dc2626' : priority === 'medium' ? '#d97706' : '#16a34a'}">${priority.toUpperCase()}</span>
      </div>
      <p>Log in to review and update the request status.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/maintenance" class="button">View Request</a>
    `)
  }),

  maintenanceUpdate: (tenantName, requestTitle, newStatus) => ({
    subject: `Maintenance Update - ${requestTitle}`,
    html: baseTemplate(`
      <h2>Hello ${tenantName},</h2>
      <p>Your maintenance request has been updated.</p>
      <div class="detail-box">
        <strong>Request:</strong> ${requestTitle}<br/>
        <strong>New Status:</strong> ${newStatus.replace('_', ' ').toUpperCase()}
      </div>
      <p>Log in for more details.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/maintenance" class="button">View Request</a>
    `)
  }),

  paymentConfirmed: (tenantName, propertyTitle, amount) => ({
    subject: `Payment Confirmed - ${propertyTitle}`,
    html: baseTemplate(`
      <h2>Hello ${tenantName},</h2>
      <p>Your payment has been confirmed and your lease is now <strong>active</strong>.</p>
      <div class="detail-box">
        <strong>Property:</strong> ${propertyTitle}<br/>
        <strong>Amount Paid:</strong> $${Number(amount).toLocaleString()}
      </div>
      <p>Your full rent schedule is now available in your dashboard.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/my-lease" class="button">View Lease & Schedule</a>
    `)
  }),

  // Sent on registration — link to verify email address
  emailVerification: (userName, verifyUrl) => ({
    subject: 'Verify your RentifyPro email address',
    html: baseTemplate(`
      <h2>Hello ${userName},</h2>
      <p>Thanks for signing up! Please verify your email address to activate your account.</p>
      <p>This link expires in <strong>24 hours</strong>.</p>
      <a href="${verifyUrl}" class="button">Verify Email</a>
      <p style="margin-top:24px;color:#6b7280;font-size:13px;">
        If you did not create a RentifyPro account, you can safely ignore this email.
      </p>
    `)
  }),

  // Sent when user requests a password reset
  passwordReset: (userName, resetUrl) => ({
    subject: 'Reset your RentifyPro password',
    html: baseTemplate(`
      <h2>Hello ${userName},</h2>
      <p>We received a request to reset your password. Click the button below to choose a new one.</p>
      <p>This link expires in <strong>1 hour</strong>.</p>
      <a href="${resetUrl}" class="button">Reset Password</a>
      <p style="margin-top:24px;color:#6b7280;font-size:13px;">
        If you did not request a password reset, please ignore this email — your password will not change.
      </p>
    `)
  }),

  // OTP code email (for 2FA disable, phone verify fallback, etc.)
  emailOTP: (userName, otpCode) => ({
    subject: 'RentifyPro – Your Verification Code',
    html: baseTemplate(`
      <h2>Hello ${userName},</h2>
      <p>Your one-time verification code is:</p>
      <div class="detail-box" style="text-align:center;font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb;">${otpCode}</div>
      <p>This code expires in <strong>24 hours</strong>. Do not share it with anyone.</p>
    `)
  }),

  // PM invitation from landlord
  pmInvitation: (pmName, landlordName, propertyTitle, propertyId) => ({
    subject: `Property Management Invitation – ${propertyTitle}`,
    html: baseTemplate(`
      <h2>Hello ${pmName},</h2>
      <p><strong>${landlordName}</strong> has invited you to manage their property:</p>
      <div class="detail-box"><strong>${propertyTitle}</strong></div>
      <p>Please log in to your RentifyPro dashboard to accept or decline this invitation.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/pm/properties" class="button">Review Invitation</a>
    `)
  }),

  // Late fee applied to tenant's account
  lateFeeApplied: (tenantName, propertyTitle, feeAmount, dueDate) => ({
    subject: `⚠️ Late Fee Applied - ${propertyTitle}`,
    html: baseTemplate(`
      <h2 style="color:#d97706;">Hello ${tenantName},</h2>
      <p>A late fee has been applied to your account because your rent payment is overdue.</p>
      <div class="detail-box" style="border-left: 4px solid #d97706;">
        <strong>Property:</strong> ${propertyTitle}<br/>
        <strong>Late Fee Amount:</strong> $${Number(feeAmount).toLocaleString()}<br/>
        <strong>Original Due Date:</strong> ${new Date(dueDate).toDateString()}
      </div>
      <p>Please make payment as soon as possible to avoid further charges.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/payments" class="button" style="background:#d97706;">Pay Now</a>
    `)
  }),

  // Payment receipt confirmation
  paymentReceipt: (tenantName, propertyTitle, amount, receiptNumber, month) => ({
    subject: `Payment Receipt #${receiptNumber} - ${propertyTitle}`,
    html: baseTemplate(`
      <h2>Hello ${tenantName},</h2>
      <p>Your payment has been received. Please keep this receipt for your records.</p>
      <div class="detail-box">
        <strong>Receipt Number:</strong> ${receiptNumber}<br/>
        <strong>Property:</strong> ${propertyTitle}<br/>
        <strong>Period:</strong> ${month}<br/>
        <strong>Amount Paid:</strong> $${Number(amount).toLocaleString()}<br/>
        <strong>Date:</strong> ${new Date().toDateString()}
      </div>
      <p>A PDF copy of your receipt is available in your dashboard.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/payments" class="button">View Receipts</a>
    `)
  }),

  // Sent to tenant when landlord proposes a lease renewal
  renewalProposed: (tenantName, propertyTitle, newEndDate, newRentAmount) => ({
    subject: `Lease Renewal Proposed - ${propertyTitle}`,
    html: baseTemplate(`
      <h2>Hello ${tenantName},</h2>
      <p>Your landlord has proposed a lease renewal for <strong>${propertyTitle}</strong>.</p>
      <div class="detail-box">
        <strong>Property:</strong> ${propertyTitle}<br/>
        <strong>Proposed New End Date:</strong> ${new Date(newEndDate).toDateString()}<br/>
        <strong>Proposed Rent:</strong> $${Number(newRentAmount).toLocaleString()} / month
      </div>
      <p>Please log in to accept or decline the renewal proposal.</p>
      <a href="${process.env.CLIENT_URL}/dashboard/agreements" class="button">Review Proposal</a>
    `)
  }),

  // ─── DocuSign-style signing invitation ─────────────────────────
  signingInvite: (partyName, propertyTitle, signingUrl) => ({
    subject: `Action Required: Sign Your Rental Agreement — ${propertyTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#3b82f6,#6366f1);padding:24px;border-radius:8px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:22px;">📄 Agreement Ready to Sign</h1>
        </div>
        <div style="background:#fff;padding:24px;border-radius:8px;border:1px solid #e2e8f0;">
          <p style="color:#374151;font-size:16px;">Hi <strong>${partyName}</strong>,</p>
          <p style="color:#374151;">A rental agreement for <strong>${propertyTitle}</strong> is ready for your signature.</p>
          <p style="color:#6b7280;font-size:14px;">Please review the full agreement and sign using the secure link below. This link expires in 7 days.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${signingUrl}"
               style="background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;">
              ✍️ Review &amp; Sign Agreement
            </a>
          </div>
          <p style="color:#9ca3af;font-size:12px;border-top:1px solid #f1f5f9;padding-top:12px;margin-top:16px;">
            Your electronic signature is legally binding. If you did not expect this email, please ignore it.
          </p>
        </div>
      </div>
    `,
    text: `Hi ${partyName}, your rental agreement for ${propertyTitle} is ready to sign. Use this link: ${signingUrl}`,
  }),


  // ── New Message (Offline recipient) ─────────────────────────────────────────
  newMessageOffline: (recipientName, senderName, preview, propertyTitle) => ({
    subject: `New message from ${senderName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#F8FBFC;border-radius:12px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#0B2D72,#0992C2);padding:28px 32px">
          <h2 style="color:white;margin:0;font-size:20px">New Message</h2>
        </div>
        <div style="padding:28px 32px">
          <p style="color:#374151">Hi <strong>${recipientName}</strong>,</p>
          <p style="color:#374151">You have a new message from <strong>${senderName}</strong>${propertyTitle ? ` regarding <em>${propertyTitle}</em>` : ''}.</p>
          <div style="background:#EFF6FF;border-left:4px solid #3B82F6;border-radius:6px;padding:14px 18px;margin:20px 0">
            <p style="color:#1E40AF;margin:0;font-style:italic">"${preview}${preview.length >= 100 ? '\u2026' : ''}"</p>
          </div>
          <a href="${process.env.CLIENT_URL}/dashboard/messages"
             style="display:inline-block;background:#0992C2;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            View Message \u2192
          </a>
        </div>
        <div style="padding:16px 32px;border-top:1px solid #E5E7EB;text-align:center">
          <p style="color:#9CA3AF;font-size:12px;margin:0">RentifyPro \u00b7 You're receiving this because you were offline when the message was sent.</p>
        </div>
      </div>
    `,
  }),

  // ── Support request notification (sent to admin) ─────────────────────────────
  supportRequest: ({ email, category, message, ip }) => ({
    subject: `[Support] ${category} request from ${email}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><style>
        body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0}
        .container{max-width:600px;margin:30px auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
        .header{background:#2563eb;color:white;padding:24px 32px}.header h1{margin:0;font-size:24px}
        .body{padding:32px;color:#374151;line-height:1.6}
        .detail-box{background:#f0f7ff;border-left:4px solid #2563eb;padding:16px;border-radius:4px;margin:16px 0}
        .footer{background:#f9fafb;padding:16px 32px;text-align:center;color:#9ca3af;font-size:13px;border-top:1px solid #e5e7eb}
      </style></head>
      <body><div class="container">
        <div class="header"><h1>\uD83C\uDFE0 RentifyPro — Support Request</h1></div>
        <div class="body">
          <h2>New Support Ticket</h2>
          <div class="detail-box">
            <strong>From:</strong> ${email}<br/>
            <strong>Category:</strong> ${category}<br/>
            <strong>IP Address:</strong> ${ip || 'N/A'}<br/>
          </div>
          <p><strong>Message:</strong></p>
          <p style="background:#f9fafb;padding:16px;border-radius:6px;color:#374151">${message || '(no message body provided)'}</p>
        </div>
        <div class="footer">\u00a9 ${new Date().getFullYear()} RentifyPro. Automated support notification.</div>
      </div></body></html>
    `,
  }),

  // ── Support acknowledgement (sent to user who submitted the request) ─────────
  supportAcknowledgement: ({ name, category }) => ({
    subject: `We got your message — RentifyPro Support`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><style>
        body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0}
        .container{max-width:600px;margin:30px auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
        .header{background:#2563eb;color:white;padding:24px 32px}.header h1{margin:0;font-size:24px}
        .body{padding:32px;color:#374151;line-height:1.6}
        .detail-box{background:#f0f7ff;border-left:4px solid #2563eb;padding:16px;border-radius:4px;margin:16px 0}
        .footer{background:#f9fafb;padding:16px 32px;text-align:center;color:#9ca3af;font-size:13px;border-top:1px solid #e5e7eb}
      </style></head>
      <body><div class="container">
        <div class="header"><h1>\uD83C\uDFE0 RentifyPro</h1></div>
        <div class="body">
          <h2>We received your request, ${name || 'there'}!</h2>
          <p>Thanks for reaching out. Our team has received your <strong>${category}</strong> support request and will respond within 1\u20132 business days.</p>
          <div class="detail-box">
            <strong>Category:</strong> ${category}<br/>
            <strong>Status:</strong> Under review
          </div>
          <p>In the meantime, you can check our help centre or reply to this email if you have additional information to add.</p>
          <p>\u2014 The RentifyPro Support Team</p>
        </div>
        <div class="footer">\u00a9 ${new Date().getFullYear()} RentifyPro. This is an automated message.</div>
      </div></body></html>
    `,
  }),

};

// ─── Send Function ──────────────────────────────────────────────────

const sendEmail = async (to, templateName, ...args) => {
  try {
    const transport = getTransporter();
    if (!transport) return false; // Email not configured — silently skip

    const template = templates[templateName];
    if (!template) {
      console.error(`Email template not found: ${templateName}`);
      return false;
    }

    const { subject, html } = template(...args);

    await transport.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html,
    });

    console.log(`Email sent [${templateName}] → ${to}`);
    return true;
  } catch (error) {
    // Never crash the app over a failed email
    console.error(`Email failed [${templateName}] → ${to}:`, error.message);
    return false;
  }
};



module.exports = { sendEmail };