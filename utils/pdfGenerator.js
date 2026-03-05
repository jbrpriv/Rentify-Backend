const PDFDocument = require('pdfkit');
const { substituteClauses } = require('./clauseSubstitution');

/**
 * Shared PDF body builder — populates a PDFDocument instance.
 * Used by both the streaming (HTTP download) and buffer (S3 upload) paths.
 */
function _buildPDF(doc, agreement, landlord, tenant, property) {
  // ─── HEADER ──────────────────────────────────────────────────────────────────
  doc.fontSize(20).text('RESIDENTIAL RENTAL AGREEMENT', { align: 'center' });
  doc.moveDown();

  // ─── PARTIES ─────────────────────────────────────────────────────────────────
  doc.fontSize(12).text(`This Agreement is made on ${new Date().toLocaleDateString()}`);
  doc.moveDown();
  doc.text(`BETWEEN: ${landlord.name} ("Landlord")`);
  doc.text(`AND: ${tenant.name} ("Tenant")`);
  doc.moveDown();

  // ─── PROPERTY ────────────────────────────────────────────────────────────────
  doc.text('FOR THE PROPERTY AT:');
  doc.text(`${property.address.street}, ${property.address.city}, ${property.address.state}`);
  doc.moveDown();

  // ─── TERMS ───────────────────────────────────────────────────────────────────
  doc.fontSize(14).text('TERMS AND CONDITIONS', { underline: true });
  doc.fontSize(12);
  doc.moveDown();
  doc.text(`1. TERM: Commencing ${new Date(agreement.term.startDate).toDateString()} and ending ${new Date(agreement.term.endDate).toDateString()}.`);
  doc.moveDown();
  doc.text(`2. RENT: The Tenant agrees to pay Rs. ${agreement.financials.rentAmount.toLocaleString()} per month.`);
  doc.moveDown();
  doc.text(`3. SECURITY DEPOSIT: A refundable deposit of Rs. ${agreement.financials.depositAmount.toLocaleString()} shall be held by the Landlord.`);
  doc.moveDown();
  doc.text(`4. LATE FEE: A late fee of Rs. ${agreement.financials.lateFeeAmount || 0} applies after ${agreement.financials.lateFeeGracePeriodDays || 5} days grace period.`);
  doc.moveDown();

  // Optional policy fields
  if (agreement.utilitiesIncluded) {
    doc.text(`5. UTILITIES: Utilities are included in the monthly rent.${agreement.utilitiesDetails ? ' ' + agreement.utilitiesDetails : ''}`);
    doc.moveDown();
  }
  if (agreement.petPolicy?.allowed) {
    doc.text(`6. PET POLICY: Pets are permitted with an additional deposit of Rs. ${agreement.petPolicy.deposit || 0}.`);
    doc.moveDown();
  } else {
    doc.text('6. PET POLICY: No pets are permitted on the premises.');
    doc.moveDown();
  }
  if (agreement.terminationPolicy) {
    doc.text(`7. TERMINATION: ${agreement.terminationPolicy}`);
    doc.moveDown();
  }

  // ─── ADDITIONAL CLAUSES (C3 fix — renders full clauseSet with variable substitution) ──
  const resolvedClauses = substituteClauses(agreement);

  if (resolvedClauses.length > 0) {
    doc.addPage();
    doc.fontSize(14).text('ADDITIONAL CLAUSES', { underline: true });
    doc.moveDown();

    resolvedClauses.forEach((clause, i) => {
      doc.fontSize(12).font('Helvetica-Bold').text(`${i + 1}. ${clause.title}`);
      doc.fontSize(10).font('Helvetica').text(clause.body);
      doc.moveDown();
    });
  }

  doc.moveDown(2);

  // ─── DIGITAL SIGNATURE BLOCK ─────────────────────────────────────────────────
  doc.fontSize(14).text('DIGITAL SIGNATURES', { underline: true });
  doc.moveDown();

  if (agreement.signatures?.landlord?.signed) {
    doc.fontSize(11).text('LANDLORD SIGNATURE:', { continued: false });
    // Draw canvas signature image if present
    const llDrawData = agreement.signatures.landlord.drawData;
    if (llDrawData) {
      try {
        const base64 = llDrawData.replace(/^data:image\/\w+;base64,/, '');
        const imgBuf = Buffer.from(base64, 'base64');
        doc.image(imgBuf, { width: 220, height: 70 });
      } catch (_) { /* image decode failed — skip */ }
    }
    doc.fontSize(10)
      .text(`Name: ${landlord.name}`)
      .text(`Signed At: ${new Date(agreement.signatures.landlord.signedAt).toLocaleString()}`)
      .text('Status: \u2713 Digitally Signed');
  } else {
    doc.fontSize(11).text('LANDLORD SIGNATURE:');
    doc.fontSize(10).text('Status: \u26A0 Pending Signature');
    doc.moveDown();
    doc.text('__________________________');
    doc.text(`${landlord.name} (Landlord)`);
  }

  doc.moveDown(2);

  if (agreement.signatures?.tenant?.signed) {
    doc.fontSize(11).text('TENANT SIGNATURE:', { continued: false });
    const tnDrawData = agreement.signatures.tenant.drawData;
    if (tnDrawData) {
      try {
        const base64 = tnDrawData.replace(/^data:image\/\w+;base64,/, '');
        const imgBuf = Buffer.from(base64, 'base64');
        doc.image(imgBuf, { width: 220, height: 70 });
      } catch (_) { /* image decode failed — skip */ }
    }
    doc.fontSize(10)
      .text(`Name: ${tenant.name}`)
      .text(`Signed At: ${new Date(agreement.signatures.tenant.signedAt).toLocaleString()}`)
      .text('Status: \u2713 Digitally Signed');
  } else {
    doc.fontSize(11).text('TENANT SIGNATURE:');
    doc.fontSize(10).text('Status: \u26A0 Pending Signature');
    doc.moveDown();
    doc.text('__________________________');
    doc.text(`${tenant.name} (Tenant)`);
  }

  doc.moveDown(2);

  doc.fontSize(9)
    .fillColor('#666666')
    .text(
      'This document was generated by RentifyPro. Digital signatures recorded above constitute legally binding acceptance of the terms herein.',
      { align: 'center' }
    );
}

/**
 * Stream a PDF directly to an HTTP response object.
 * Used by GET /api/agreements/:id/pdf
 */
const generateAgreementPDF = (agreement, landlord, tenant, property, res) => {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  _buildPDF(doc, agreement, landlord, tenant, property);
  doc.end();
};

/**
 * Generate a PDF and return it as a Buffer (for S3 upload).
 * Returns a Promise<Buffer>.
 */
const generateAgreementPDFBuffer = (agreement, landlord, tenant, property) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    _buildPDF(doc, agreement, landlord, tenant, property);
    doc.end();
  });
};

module.exports = { generateAgreementPDF, generateAgreementPDFBuffer };

// ─── RECEIPT PDF ──────────────────────────────────────────────────────────────

function _buildReceiptPDF(doc, payment, tenant, property) {
  // ─── HEADER ────────────────────────────────────────────────────────────────
  doc.fontSize(20).text('PAYMENT RECEIPT', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#2563eb').text('RentifyPro', { align: 'center' });
  doc.fillColor('#000000').moveDown();

  // ─── RECEIPT META ──────────────────────────────────────────────────────────
  doc.fontSize(12).text(`Receipt Number: ${payment.receiptNumber || 'N/A'}`);
  doc.text(`Date: ${new Date(payment.paidAt || payment.createdAt).toDateString()}`);
  doc.moveDown();

  // ─── PARTIES ──────────────────────────────────────────────────────────────
  doc.fontSize(12).text(`Received from: ${tenant.name}`);
  doc.text(`Email: ${tenant.email}`);
  doc.moveDown();

  // ─── PROPERTY ─────────────────────────────────────────────────────────────
  doc.text(`Property: ${property.title || 'N/A'}`);
  if (property.address) {
    doc.text(`Address: ${property.address.street || ''}, ${property.address.city || ''}`);
  }
  doc.moveDown();

  // ─── PAYMENT DETAILS ──────────────────────────────────────────────────────
  doc.fontSize(14).text('PAYMENT DETAILS', { underline: true });
  doc.fontSize(12).moveDown(0.5);

  doc.text(`Payment Type: ${payment.type.replace('_', ' ').toUpperCase()}`);
  if (payment.dueDate) {
    doc.text(`Period Covered: ${new Date(payment.dueDate).toLocaleString('default', { month: 'long', year: 'numeric' })}`);
  }
  doc.text(`Amount Paid: Rs. ${Number(payment.amount).toLocaleString()}`);
  if (payment.lateFeeIncluded && payment.lateFeeAmount > 0) {
    doc.text(`  Includes Late Fee: Rs. ${Number(payment.lateFeeAmount).toLocaleString()}`);
  }
  doc.text(`Status: PAID`);
  if (payment.stripePaymentIntent) {
    doc.fontSize(9).fillColor('#6b7280').text(`Transaction Reference: ${payment.stripePaymentIntent}`);
    doc.fillColor('#000000').fontSize(12);
  }
  doc.moveDown(2);

  // ─── FOOTER ────────────────────────────────────────────────────────────────
  doc.fontSize(9).fillColor('#6b7280').text(
    'This is an official payment receipt generated by RentifyPro. Please retain for your records.',
    { align: 'center' }
  );
}

/**
 * Stream a receipt PDF directly to an HTTP response.
 */
const generateReceiptPDF = (payment, tenant, property, res) => {
  const doc = new PDFDocument({ margin: 50, size: 'A5' });
  doc.pipe(res);
  _buildReceiptPDF(doc, payment, tenant, property);
  doc.end();
};

/**
 * Generate a receipt PDF as a Buffer (for S3 upload).
 * @returns {Promise<Buffer>}
 */
const generateReceiptPDFBuffer = (payment, tenant, property) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A5' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    _buildReceiptPDF(doc, payment, tenant, property);
    doc.end();
  });
};

module.exports = {
  generateAgreementPDF,
  generateAgreementPDFBuffer,
  generateReceiptPDF,
  generateReceiptPDFBuffer,
};
