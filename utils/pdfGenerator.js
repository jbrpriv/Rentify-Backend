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

const { substituteVariables, buildVariableMap, substituteClauses } = require('./clauseSubstitution');
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
        .container { padding: 0; }

        /* ── Headings ── */
        h1 { font-size: 2.25rem; font-weight: 800; margin-bottom: 1.5rem; color: #000; }
        h2 { font-size: 1.5rem;  font-weight: 700; margin-top: 1.5rem; margin-bottom: 1rem; color: #000; }
        h3 { font-size: 1.25rem; font-weight: 700; margin-top: 1rem; margin-bottom: 0.75rem; color: #000; }
        p  { margin-bottom: 1em; }
        ul, ol { margin-left: 1.5em; margin-bottom: 1em; }

        /* ── Alignment — TipTap emits style="text-align:..." on block elements ── */
        h1, h2, h3, p, div { display: block; margin-bottom: 0.5em; }
        h1[style*="text-align"], h2[style*="text-align"], h3[style*="text-align"], p[style*="text-align"], div[style*="text-align"] { text-align: inherit !important; }
        [style*="text-align:left"] { text-align: left !important; }
        [style*="text-align:center"] { text-align: center !important; }
        [style*="text-align:right"] { text-align: right !important; }
        [style*="text-align:justify"] { text-align: justify !important; }

        /* ── Font sizes — TipTap FontSize mark emits <span style="font-size:..."> ── */
        span[style*="font-size"] { font-size: inherit; } /* reset then let inline win */

        /* ── Bold / Italic / Underline ── */
        strong, b { font-weight: bold; }
        em, i     { font-style: italic; }
        u         { text-decoration: underline; }

        /* ── Variables rendered as plain text (data-type="variable" stripped) ── */
        span[data-type="variable"] { font-weight: bold; }

        /* ── Clause sections injected by the PDF generator ── */
        .clause-section { margin-top: 1.5em; margin-bottom: 1em; }
        .clause-section h3 { font-size: 1rem; font-weight: 700; margin-bottom: 0.5em; }
        .clause-section p  { margin: 0; }

        /* ── Signature block ──
             The image sits ABOVE the rule line. We achieve this by putting the
             image and name inside the box first, then drawing the top border via
             a separate <div class="sig-rule"> element underneath.            ── */
        .sig-section {
          margin-top: 60px;
          page-break-inside: avoid;
        }
        .sig-grid {
          display: flex;
          justify-content: space-between;
          gap: 40px;
          margin-top: 20px;
        }
        .sig-box {
          flex: 1;
        }
        .sig-label {
          font-weight: bold;
          font-size: 9pt;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #444;
          margin-bottom: 6px;
        }
        .sig-image {
          display: block;
          max-height: 64px;
          max-width: 200px;
          margin-bottom: 4px;
          object-fit: contain;
        }
        .sig-blank {
          height: 64px;
          margin-bottom: 4px;
        }
        /* The rule sits BELOW the signature image, above the name */
        .sig-rule {
          border-top: 1.5px solid #000;
          margin-bottom: 8px;
        }
        .sig-name {
          font-size: 11pt;
          font-weight: bold;
        }
        .sig-meta {
          font-size: 8pt;
          color: #666;
          margin-top: 2px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${bodyHtml}

        <div class="sig-section">
          <h2>Signatures</h2>
          <div class="sig-grid">
            <!-- Landlord: image first, THEN the rule line, THEN name -->
            <div class="sig-box">
              <div class="sig-label">Landlord Signature</div>
              ${landlordSig?.signed
                ? `<img class="sig-image" src="${landlordSig.drawData}" />`
                : '<div class="sig-blank"></div>'}
              <div class="sig-rule"></div>
              <div class="sig-name">${landlord?.name || '____________________'}</div>
              ${landlordSig?.signed
                ? `<div class="sig-meta">Signed on ${new Date(landlordSig.signedAt).toLocaleString()}</div>`
                : ''}
            </div>

            <!-- Tenant: same structure -->
            <div class="sig-box">
              <div class="sig-label">Tenant Signature</div>
              ${tenantSig?.signed
                ? `<img class="sig-image" src="${tenantSig.drawData}" />`
                : '<div class="sig-blank"></div>'}
              <div class="sig-rule"></div>
              <div class="sig-name">${tenant?.name || '____________________'}</div>
              ${tenantSig?.signed
                ? `<div class="sig-meta">Signed on ${new Date(tenantSig.signedAt).toLocaleString()}</div>`
                : ''}
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

// Shared HTML builder for agreements (keeps generateAgreementPDF and buffer variant DRY)
async function _buildAgreementHtml(agreement, landlord, tenant, property, options = {}) {
  const templateId = agreement.agreementTemplate?._id || agreement.agreementTemplate;
  const template = templateId ? await AgreementTemplate.findById(templateId).lean() : null;

  const vars = buildVariableMap(agreement);
  let bodyHtml = template?.bodyHtml || getDefaultAgreementHtml();

  // 1. Substitute {{variable}} placeholders (simple token replacement)
  let substitutedHtml = substituteVariables(bodyHtml, vars);

  // 2. Resolve TipTap Variable nodes using regex with proper handling of nested spans
  //    Pattern matches: <span data-type="variable" data-name="varname" ...>label</span>
  //    Handles variations in attribute order and nested structures
  const variablePattern = /<span\b[^>]*\bdata-type=["']variable["'][^>]*>[\s\S]*?<\/span>/gi;
  substitutedHtml = substitutedHtml.replace(variablePattern, (match) => {
    // Extract data-name attribute - handle both single and double quotes, any position
    const nameMatch = match.match(/\bdata-name=["']([^"']+)["']/i) || match.match(/\bdata-name=([^\s>]+)/i);
    const varName = nameMatch ? (nameMatch[1] || nameMatch[0]) : null;
    
    // Extract display label from inside the span (anything between > and </span>)
    const labelMatch = match.match(/>([^<]+)<\/?span[^>]*>/i);
    const displayLabel = labelMatch ? labelMatch[1].trim() : varName;
    
    if (varName && vars[varName]) {
      return `<strong>${vars[varName]}</strong>`;
    } else if (varName) {
      return `<strong>{{${varName}}}</strong>`;
    }
    return match; // Keep original if no variable name found
  });

  // 3. Also handle any remaining {{variable}} placeholders in bodyHtml that weren't caught
  substitutedHtml = substituteVariables(substitutedHtml, vars);

  // 4. Pre-process alignment styles - extract text-align from style attribute
  //    and apply it as a style attribute that Puppeteer will honor
  substitutedHtml = substitutedHtml.replace(
    /<(h1|h2|h3|p|div|span)\b([^>]*)style="([^"]*text-align:[^;]*;([^"]*[^"]*)"([^>]*)?>/gi,
    (match, tag, pre, styleContent, middle, post) => {
      const align = styleContent.match(/text-align:\s*(left|center|right|justify)/);
      if (!align) return match;
      const alignment = align[1];
      const cleanStyle = styleContent.replace(/text-align:[^;]*;?/, '').replace(/;$/, '').replace(/;$/, '');
      const newStyle = cleanStyle ? cleanStyle + '; text-align: ' + alignment : 'text-align: ' + alignment;
      return `<${tag}${pre}style="${newStyle}"${post}>`;
    }
  );

  // 5. Replace the ClausesPlaceholder block with actual clause content
  const clauses = substituteClauses(agreement);
  const clauseHtml = clauses.length > 0
    ? clauses.map(c => `
        <div class="clause-section">
          <h3>${c.title}</h3>
          <p>${c.body}</p>
        </div>`).join('\n')
    : '<p><em>No clauses have been added to this agreement.</em></p>';

  const placeholderRegex = /<div[^>]*\bdata-type=(?:"|')clauses-placeholder(?:"|')[^>]*>[\s\S]*?<\/div>/gi;
  if (placeholderRegex.test(substitutedHtml)) {
    substitutedHtml = substitutedHtml.replace(placeholderRegex, clauseHtml);
  } else if (clauses.length > 0) {
    // No placeholder found in template — append clauses at end
    substitutedHtml += `\n<div class="clause-section-container">${clauseHtml}</div>`;
  }

  return wrapInHtmlTemplate(substitutedHtml, agreement, landlord, tenant);
}

const generateAgreementPDF = async (agreement, landlord, tenant, property, res, options = {}) => {
  try {
    const finalHtml = await _buildAgreementHtml(agreement, landlord, tenant, property, options);
    const buffer = await generatePuppeteerPDFBuffer(finalHtml);

    // Only set headers once we have a valid buffer — prevents header-conflict errors
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=agreement-${agreement._id}.pdf`);
    return res.end(buffer);
  } catch (error) {
    console.error('PDF Generation Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF agreement.', details: error.message });
    }
  }
};

const generateAgreementPDFBuffer = async (agreement, landlord, tenant, property, options = {}) => {
  const finalHtml = await _buildAgreementHtml(agreement, landlord, tenant, property, options);
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