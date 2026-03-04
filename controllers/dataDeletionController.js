const nodemailer = require('nodemailer');

/**
 * POST /api/data-deletion
 * Public endpoint — no auth required (user may already be logged out).
 * Logs the request and sends a notification email to the admin/support address.
 */
const requestDataDeletion = async (req, res) => {
  try {
    const { email, reason } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'A valid email address is required.' });
    }

    const submittedAt = new Date().toISOString();
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

    console.log(`[DATA DELETION REQUEST] email=${email} ip=${ip} at=${submittedAt}`);

    // ── Send notification email if SMTP is configured ────────────────────────
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SUPPORT_EMAIL } = process.env;

    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT || '587'),
        secure: parseInt(SMTP_PORT || '587') === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });

      const adminEmail = SUPPORT_EMAIL || SMTP_USER;

      // Notify admin
      await transporter.sendMail({
        from: `"RentifyPro System" <${SMTP_USER}>`,
        to: adminEmail,
        subject: `[Action Required] Data Deletion Request — ${email}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
            <h2 style="color:#0B2D72;margin-top:0;">Data Deletion Request</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Account email</td><td style="padding:8px 0;font-weight:600;">${email}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Submitted at</td><td style="padding:8px 0;">${submittedAt}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">IP address</td><td style="padding:8px 0;">${ip}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Reason</td><td style="padding:8px 0;">${reason || '(none provided)'}</td></tr>
            </table>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
            <p style="color:#374151;font-size:13px;">
              Please process this request within <strong>30 days</strong> in accordance with
              your privacy policy. Delete or anonymise the user's account, profile, listings,
              messages, and maintenance records. Retain financial/legal records as required by law.
            </p>
            <p style="font-size:12px;color:#9ca3af;">This is an automated message from the RentifyPro platform.</p>
          </div>
        `,
      });

      // Acknowledge to the requester
      await transporter.sendMail({
        from: `"RentifyPro Privacy" <${SMTP_USER}>`,
        to: email,
        subject: 'We received your data deletion request — RentifyPro',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
            <h2 style="color:#0B2D72;margin-top:0;">Data Deletion Request Received</h2>
            <p style="color:#374151;font-size:14px;">
              Hi, we have received your request to delete all personal data associated with
              <strong>${email}</strong> from RentifyPro.
            </p>
            <p style="color:#374151;font-size:14px;">
              We will process your request and confirm deletion within <strong>30 days</strong>.
              If we need to verify your identity first, we will reach out to this email address.
            </p>
            <p style="color:#6b7280;font-size:13px;">
              If you did not submit this request, please ignore this email or contact us at
              privacy@rentifypro.com.
            </p>
            <p style="font-size:12px;color:#9ca3af;margin-top:24px;">RentifyPro · privacy@rentifypro.com</p>
          </div>
        `,
      });
    }

    return res.status(200).json({
      message: 'Your deletion request has been received. We will process it within 30 days.',
    });
  } catch (err) {
    console.error('[DATA DELETION ERROR]', err.message);
    return res.status(500).json({ message: 'Failed to submit request. Please email privacy@rentifypro.com directly.' });
  }
};

module.exports = { requestDataDeletion };
