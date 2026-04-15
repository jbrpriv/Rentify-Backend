let puppeteer;
try {
  // Prefer puppeteer-core (lighter, no bundled Chromium) if available,
  // then fall back to the full puppeteer package.
  try {
    puppeteer = require('puppeteer-core');
  } catch (_) {
    puppeteer = require('puppeteer');
  }
} catch (e) {
  console.error('[pdfGenerator] Neither puppeteer nor puppeteer-core could be loaded:', e.message);
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
/**
 * Resolve the Chromium/Chrome executable path for the current environment.
 * Priority:
 *   1. PUPPETEER_EXECUTABLE_PATH env var  (set this in docker-compose / .env)
 *   2. The path bundled by the full `puppeteer` package
 *   3. Common system paths for Debian/Ubuntu Docker images
 */
function resolveChromiumPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Full `puppeteer` package exposes executablePath()
  if (typeof puppeteer.executablePath === 'function') {
    try {
      const p = puppeteer.executablePath();
      if (p) return p;
    } catch (_) {}
  }

  // Common system Chrome/Chromium locations on Debian/Ubuntu (typical Docker base)
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/local/bin/chromium',
  ];
  const fs = require('fs');
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Let Puppeteer try its own default (may work with full package)
  return undefined;
}

async function generatePuppeteerPDFBuffer(html) {
  if (!puppeteer) {
    throw new Error(
      'Puppeteer is not installed. Run "npm install puppeteer" (bundles Chromium) ' +
      'or "npm install puppeteer-core" and set PUPPETEER_EXECUTABLE_PATH in your environment.'
    );
  }

  const executablePath = resolveChromiumPath();

  const launchOptions = {
    headless: 'new',   // Use the new headless mode (avoids deprecation warning in newer Puppeteer)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',   // Critical in Docker: /dev/shm is often too small
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',          // Reduces memory, avoids sandbox issues in constrained containers
    ],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // Use domcontentloaded instead of networkidle0 for self-contained HTML (faster, no network wait)
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    return await page.pdf({
      format: 'A4',
      margin: { top: '60px', right: '60px', bottom: '60px', left: '60px' },
      printBackground: true,
    });
  } catch (err) {
    const hint = !executablePath
      ? ' Tip: Set PUPPETEER_EXECUTABLE_PATH in your .env or docker-compose to point to your Chrome/Chromium binary.'
      : ` (executablePath: ${executablePath})`;
    throw new Error(`Puppeteer failed to generate PDF: ${err.message}.${hint}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {}); // Swallow close errors — the PDF is already generated
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const generateAgreementPDF = async (agreement, landlord, tenant, property, res, options = {}) => {
  // NOTE: The caller (downloadAgreementPDF) must NOT set Content-Type before calling this.
  // We set it here so error responses can still use res.status(500).json().
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

    // Only set headers once we have a valid buffer — prevents header-conflict errors
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=agreement-${agreement._id}.pdf`);
    return res.end(buffer);
  } catch (error) {
    console.error('PDF Generation Error:', error);
    // Guard: only send JSON error if headers haven't been flushed yet
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF agreement.', details: error.message });
    }
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