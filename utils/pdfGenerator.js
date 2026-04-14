let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  // Silent fail - user will install manually on server
}

const { substituteVariables, buildVariableMap } = require('./clauseSubstitution');
const { getCurrencyContext } = require('./currencyService');
const AgreementTemplate = require('../models/AgreementTemplate');
const Agreement = require('../models/Agreement');
const { getPlatformBranding } = require('./platformSettings');

/**
 * Wraps the agreement body in a professional HTML document with Times New Roman styling.
 */
function wrapInHtmlTemplate(bodyHtml, agreement, landlord, tenant) {
  const landlordSig = agreement.signatures?.landlord;
  const tenantSig = agreement.signatures?.tenant;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: "Times New Roman", Times, serif;
          line-height: 1.5;
          margin: 0;
          padding: 0;
          color: #1a1a1a;
          font-size: 12pt;
        }
        .container {
          padding: 0;
        }
        h1, h2, h3 { color: #000; }
        p { margin-bottom: 1em; }
        .sig-section {
          margin-top: 50px;
          page-break-inside: avoid;
        }
        .sig-grid {
          display: flex;
          justify-content: space-between;
          gap: 40px;
          margin-top: 30px;
        }
        .sig-box {
          flex: 1;
          border-top: 1px solid #000;
          padding-top: 10px;
        }
        .sig-label {
          font-weight: bold;
          font-size: 10pt;
          text-transform: uppercase;
          margin-bottom: 5px;
        }
        .sig-image {
          max-height: 60px;
          display: block;
          margin-bottom: 5px;
        }
        .sig-name {
          font-size: 11pt;
          font-weight: bold;
        }
        .sig-meta {
          font-size: 8pt;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${bodyHtml}

        <div class="sig-section">
          <h2>Signatures</h2>
          <div class="sig-grid">
            <!-- Landlord -->
            <div class="sig-box">
              <div class="sig-label">Landlord Signature</div>
              ${landlordSig?.signed ? `<img class="sig-image" src="${landlordSig.drawData}" />` : '<div style="height: 50px;"></div>'}
              <div class="sig-name">${landlord?.name || '____________________'}</div>
              ${landlordSig?.signed ? `<div class="sig-meta">Signed on ${new Date(landlordSig.signedAt).toLocaleString()}</div>` : ''}
            </div>

            <!-- Tenant -->
            <div class="sig-box">
              <div class="sig-label">Tenant Signature</div>
              ${tenantSig?.signed ? `<img class="sig-image" src="${tenantSig.drawData}" />` : '<div style="height: 50px;"></div>'}
              <div class="sig-name">${tenant?.name || '____________________'}</div>
              ${tenantSig?.signed ? `<div class="sig-meta">Signed on ${new Date(tenantSig.signedAt).toLocaleString()}</div>` : ''}
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Professional Default Fallback HTML (used if no custom template is assigned)
 */
function getDefaultAgreementHtml() {
  return `
    <div style="text-align: center; margin-bottom: 40px;">
      <h1 style="margin-bottom: 5px;">RESIDENTIAL RENTAL AGREEMENT</h1>
      <p style="font-size: 10pt; color: #666;">Agreement ID: {{agreement_id}}</p>
    </div>

    <h3>1. THE PARTIES</h3>
    <p>This Agreement is entered into on <strong>{{current_date}}</strong> by and between <strong>{{landlord_name}}</strong> ("Landlord") and <strong>{{tenant_name}}</strong> ("Tenant").</p>

    <h3>2. THE PROPERTY</h3>
    <p>The Landlord agrees to lease the property located at: <br/>
    <strong>{{property_address}}</strong></p>

    <h3>3. LEASE TERM</h3>
    <p>The lease term shall begin on <strong>{{start_date}}</strong> and end on <strong>{{end_date}}</strong>, with a total duration of <strong>{{duration_months}} months</strong>.</p>

    <h3>4. FINANCIAL TERMS</h3>
    <ul>
      <li><strong>Monthly Rent:</strong> {{monthly_rent}}</li>
      <li><strong>Security Deposit:</strong> {{security_deposit}}</li>
      <li><strong>Total Move-In Cost:</strong> {{total_move_in}}</li>
    </ul>

    <h3>5. POLICIES</h3>
    <p><strong>Utilities:</strong> {{utilities_included}}</p>
    <p><strong>Pets:</strong> {{pet_allowed}}</p>

    <div style="margin-top: 40px;">
      <h3>6. STANDARD CONDITIONS</h3>
      <p>The Tenant shall keep the property in clean and habitable condition. Subletting is not permitted without prior written consent from the Landlord. The Landlord shall provide 24 hours notice before entering the property except in emergencies.</p>
    </div>
  `;
}

/**
 * Common Puppeteer PDF generation logic
 */
async function generatePuppeteerPDFBuffer(html) {
  if (!puppeteer) {
    throw new Error('Puppeteer is not installed on this server. Please run "npm install puppeteer" to enable high-fidelity PDF generation.');
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    return await page.pdf({
      format: 'A4',
      margin: { top: '60px', right: '60px', bottom: '60px', left: '60px' },
      printBackground: true
    });
  } finally {
    if (browser) await browser.close();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const generateAgreementPDF = async (agreement, landlord, tenant, property, res, options = {}) => {
  try {
    const templateId = agreement.agreementTemplate?._id || agreement.agreementTemplate;
    const template = templateId ? await AgreementTemplate.findById(templateId).lean() : null;
    
    // Get variables and body HTML
    const vars = buildVariableMap(agreement);
    let bodyHtml = template?.bodyHtml || getDefaultAgreementHtml();
    
    // Substitute variables
    const substitutedHtml = substituteVariables(bodyHtml, vars);
    const finalHtml = wrapInHtmlTemplate(substitutedHtml, agreement, landlord, tenant);
    
    const buffer = await generatePuppeteerPDFBuffer(finalHtml);
    res.setHeader('Content-Type', 'application/pdf');
    return res.end(buffer);
  } catch (error) {
    console.error('PDF Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate PDF agreement.', details: error.message });
  }
};

const generateAgreementPDFBuffer = async (agreement, landlord, tenant, property, options = {}) => {
  const templateId = agreement.agreementTemplate?._id || agreement.agreementTemplate;
  const template = templateId ? await AgreementTemplate.findById(templateId).lean() : null;
  
  const vars = buildVariableMap(agreement);
  let bodyHtml = template?.bodyHtml || getDefaultAgreementHtml();
  
  const substitutedHtml = substituteVariables(bodyHtml, vars);
  const finalHtml = wrapInHtmlTemplate(substitutedHtml, agreement, landlord, tenant);
  
  return await generatePuppeteerPDFBuffer(finalHtml);
};

/**
 * Placeholder Receipt PDF (Uses Puppeteer for consistency)
 */
const generateReceiptPDF = async (payment, tenant, property, res, options = {}) => {
  try {
    const currencyCtx = await getCurrencyContext(options.currency || 'USD');
    const branding = await getPlatformBranding();
    
    const html = `
      <html>
      <body style="font-family: 'Times New Roman'; padding: 50px;">
        <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px;">
          <h1>PAYMENT RECEIPT</h1>
          <p>${branding.brandName || 'RentifyPro'}</p>
        </div>
        <div style="margin-top: 30px;">
          <p><strong>Receipt Number:</strong> ${payment.receiptNumber || payment._id}</p>
          <p><strong>Date:</strong> ${new Date(payment.paidAt || payment.createdAt).toLocaleDateString()}</p>
          <p><strong>Tenant:</strong> ${tenant?.name || '—'}</p>
          <p><strong>Property:</strong> ${property?.title || '—'}</p>
          <hr/>
          <h2 style="text-align: right;">Amount Paid: ${currencyCtx.money(payment.amount)}</h2>
        </div>
        <div style="margin-top: 100px; text-align: center; font-size: 10pt; color: #666;">
          Thank you for your payment. This is a system-generated receipt.
        </div>
      </body>
      </html>
    `;
    
    const buffer = await generatePuppeteerPDFBuffer(html);
    res.setHeader('Content-Type', 'application/pdf');
    return res.end(buffer);
  } catch (error) {
    console.error('Receipt Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate PDF receipt.' });
  }
};

const generateReceiptPDFBuffer = async (payment, tenant, property, options = {}) => {
  const currencyCtx = await getCurrencyContext(options.currency || 'USD');
  const html = `<html><body style="padding:50px;"><h1>RECEIPT</h1><p>Amount: ${currencyCtx.money(payment.amount)}</p></body></html>`;
  return await generatePuppeteerPDFBuffer(html);
};

module.exports = {
  generateAgreementPDF,
  generateAgreementPDFBuffer,
  generateReceiptPDF,
  generateReceiptPDFBuffer,
};