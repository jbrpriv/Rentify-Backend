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

const { substituteVariables, buildVariableMap, substituteClauses, resolvePath } = require('./clauseSubstitution');
const { generateHtmlFromJson } = require('./tiptapParser');
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
        h4 { font-size: 1.1rem; font-weight: 700; margin-top: 0.75rem; margin-bottom: 0.5rem; color: #000; }
        h5, h6 { font-size: 1rem; font-weight: 700; margin-top: 0.5rem; margin-bottom: 0.5rem; color: #000; }
        p  { margin-bottom: 1em; }
        ul, ol { margin-left: 1.5em; margin-bottom: 1em; }

        /* ── Alignment ──────────────────────────────────────────────────────
           TipTap TextAlign extension emits style="text-align: center" (with
           a space after the colon) on block elements.  We cover both the
           spaced and un-spaced forms, utility classes, and the legacy align
           attribute.  Selectors use !important so they win over any reset.
        ─────────────────────────────────────────────────────────────────── */
        h1, h2, h3, h4, h5, h6, p, div, li, blockquote {
            const titleText = vars.receiptNumber || vars.receipt_number || `Receipt ${String(payment._id).slice(-6)}`;
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
                  h4 { font-size: 1.1rem; font-weight: 700; margin-top: 0.75rem; margin-bottom: 0.5rem; color: #000; }
                  h5, h6 { font-size: 1rem; font-weight: 700; margin-top: 0.5rem; margin-bottom: 0.5rem; color: #000; }
                  p  { margin-bottom: 1em; }
                  ul, ol { margin-left: 1.5em; margin-bottom: 1em; }
                  /* ── Alignment ──────────────────────────────────────────────────────
                     TipTap TextAlign extension emits style="text-align: center" (with
                     a space after the colon) on block elements.  We cover both the
                     spaced and un-spaced forms, utility classes, and the legacy align
                     attribute.  Selectors use !important so they win over any reset.
                  ─────────────────────────────────────────────────────────────────── */
                  h1, h2, h3, h4, h5, h6, p, div, li, blockquote {
                    display: block;
                    margin-bottom: 0.5em;
                  }
                  /* center */
                  [style*="text-align: center"],
                  [style*="text-align:center"],
                  .text-center,
                  [align="center"] {
                    text-align: center !important;
                  }
                  /* right */
                  [style*="text-align: right"],
                  [style*="text-align:right"],
                  .text-right,
                  [align="right"] {
                    text-align: right !important;
                  }
                  /* justify */
                  [style*="text-align: justify"],
                  [style*="text-align:justify"],
                  .text-justify,
                  [align="justify"] {
                    text-align: justify !important;
                  }
                  /* left (explicit — Puppeteer inherits left by default, but be explicit) */
                  [style*="text-align: left"],
                  [style*="text-align:left"],
                  .text-left,
                  [align="left"] {
                    text-align: left !important;
                  }
                  /* ── Font sizes — TipTap FontSize mark emits <span style="font-size:..."> ── */
                  /* Inline font-size styles are preserved; no stylesheet override here. */
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

/**
 * Convert a Mongoose Map (or plain object) stored in template.variables into a
 * plain { key: value } object that can be spread into the variable map.
 */
function flattenTemplateVariables(variables) {
  if (!variables) return {};
  // Mongoose Map has a .toObject() or we can use Object.fromEntries on its entries
  if (variables instanceof Map) {
    return Object.fromEntries(variables.entries());
  }
  if (typeof variables.toObject === 'function') {
    return variables.toObject();
  }
  if (typeof variables === 'object') {
    return { ...variables };
  }
  return {};
}

// Shared HTML builder for agreements (keeps generateAgreementPDF and buffer variant DRY)
async function _buildAgreementHtml(agreement, landlord, tenant, property, options = {}) {
  const templateId = agreement.agreementTemplate?._id || agreement.agreementTemplate;
  const template = templateId ? await AgreementTemplate.findById(templateId).lean() : null;

  // Build variable map: system variables first, then template-level custom variables on top,
  // then any caller-injected overrides (e.g. from options.customVars) last.
  // This order means caller overrides win, then template defaults, then system values.
  const vars = {
    ...buildVariableMap(agreement),
    ...flattenTemplateVariables(template?.variables),
    ...(options.customVars || {}),
  };

  let bodyHtml = '';
  if (template?.bodyJson && template.bodyJson.type === 'doc') {
    bodyHtml = generateHtmlFromJson(template.bodyJson);
  } else {
    bodyHtml = template?.bodyHtml || getDefaultAgreementHtml();
  }

  // 1. Substitute {{variable}} placeholders (simple token replacement)
  let substitutedHtml = substituteVariables(bodyHtml, vars);

  // 2. Resolve TipTap Variable nodes using regex with proper handling of nested spans
  //    Pattern matches: <span data-type="variable" data-name="varname" ...>label</span>
  //    Handles variations in attribute order and nested structures. Also resolve dotted paths from the agreement.
  const agreementObj = typeof agreement.toObject === 'function' ? agreement.toObject() : agreement;

  const variablePattern = /<span\b[^>]*\bdata-type=["']variable["'][^>]*>[\s\S]*?<\/span>/gi;
  substitutedHtml = substitutedHtml.replace(variablePattern, (match) => {
    // Extract data-name attribute - handle both single and double quotes, any position
    const nameMatch = match.match(/\bdata-name=["']([^"']+)["']/i) || match.match(/\bdata-name=([^\s>]+)/i);
    const varName = nameMatch ? (nameMatch[1] || null) : null;

    // Resolve value: first try vars map (includes template variables), then dotted-path on agreement object
    let value;
    if (varName) {
      if (Object.prototype.hasOwnProperty.call(vars, varName)) {
        value = vars[varName];
      } else {
        const resolved = resolvePath(agreementObj, varName);
        if (resolved !== undefined && resolved !== null) value = String(resolved);
      }
    }

    if (value !== undefined && value !== null) {
      return `<strong>${value}</strong>`;
    }

    // Fallbacks: label inside span, then placeholder
    const labelMatch = match.match(/>([^<]+)<\/?span[^>]*>/i);
    const displayLabel = labelMatch ? labelMatch[1].trim() : '';
    if (displayLabel) return `<strong>${displayLabel}</strong>`;
    if (varName) return `<strong>{{${varName}}}</strong>`;
    return match;
  });

  // 3. Also handle any remaining {{variable}} placeholders that weren't caught above
  substitutedHtml = substituteVariables(substitutedHtml, vars);

  // NOTE: The alignment pre-processing regex that previously rewrote opening tags has been
  // intentionally removed. It was stripping non-style attributes (class, data-*, id) from
  // elements and was redundant — Puppeteer correctly applies the CSS attribute selectors
  // defined in wrapInHtmlTemplate ([style*="text-align: center"] etc.) without any
  // pre-processing. TipTap's TextAlign extension emits inline style attributes directly,
  // which the CSS selectors handle correctly.

  // 4. Replace the ClausesPlaceholder block with actual clause content
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
 * Receipt generation using TipTap templates (falls back to simple HTML)
 * - Resolution order: landlord-specific receipt template -> global default receipt template -> simple fallback
 */
const generateReceiptPDF = async (payment, tenant, property, res, options = {}) => {
  try {
    const buffer = await generateReceiptPDFBuffer(payment, tenant, property, options);
    if (!buffer) throw new Error('No PDF buffer generated');

    res.setHeader('Content-Type', 'application/pdf');
    const filename = `receipt-${payment.receiptNumber || payment._id}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.end(buffer);
  } catch (error) {
    console.error('Receipt Generation Error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF receipt.' });
  }
};

const generateReceiptPDFBuffer = async (payment, tenant, property, options = {}) => {
  // Try to resolve a receipt template: landlord-specific first, then global default
  let template = null;
  try {
    const landlordId = (payment && payment.landlord && (payment.landlord._id || payment.landlord)) || (property && property.landlord) || null;
    if (landlordId) {
      template = await AgreementTemplate.findOne({
        landlord: landlordId,
        templateType: 'receipt',
        status: 'approved',
        isArchived: false,
      }).sort('-updatedAt').lean();
    }
  } catch (_) {
    template = null;
  }

  if (!template) {
    template = await AgreementTemplate.findOne({ isGlobalDefault: true, templateType: 'receipt', status: 'approved', isArchived: false }).lean();
  }

  const currencyCtx = await getCurrencyContext(options.currency || 'USD');
  const branding = await getPlatformBranding();

  // Build common receipt variables (snake_case + camelCase aliases)
  const paidDate = payment.paidAt ? new Date(payment.paidAt) : new Date(payment.createdAt || Date.now());
  const now = new Date();
  const nowStr = now.toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });
  const paidDateStr = paidDate.toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });
  const paidTimeStr = paidDate.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

  // Human-readable payment method
  let paymentMethodDisplay = '';
  if (payment.gateway) {
    const g = String(payment.gateway).toLowerCase();
    if (g === 'stripe') paymentMethodDisplay = 'Stripe';
    else if (g === 'paypal') paymentMethodDisplay = 'PayPal';
    else if (g === 'manual') paymentMethodDisplay = 'Manual';
    else paymentMethodDisplay = payment.gateway;
  } else if (payment.stripePaymentIntent) {
    paymentMethodDisplay = 'Stripe';
  }

  // Period covered (best-effort): prefer dueDate (month + year)
  let periodCovered = '';
  if (payment.dueDate) {
    try {
      const d = new Date(payment.dueDate);
      periodCovered = d.toLocaleDateString('en-PK', { year: 'numeric', month: 'long' });
    } catch (_) {
      periodCovered = '';
    }
  }

  // Property address formatting (if available)
  let propertyAddress = '';
  if (property && property.address) {
    const parts = [property.address.street, property.address.city, property.address.state].filter(Boolean);
    propertyAddress = parts.join(', ');
  }

  const vars = {
    // Amounts
    paid_amount: currencyCtx.money(payment.amount),
    amount_paid: currencyCtx.money(payment.amount),
    paidAmount: currencyCtx.money(payment.amount),
    amount: currencyCtx.money(payment.amount),

    // Dates & times
    payment_date: paidDateStr,
    paymentDate: paidDateStr,
    payment_time: paidTimeStr,
    paymentTime: paidTimeStr,

    // Receipt & transaction
    receipt_number: payment.receiptNumber || String(payment._id),
    receiptNumber: payment.receiptNumber || String(payment._id),
    transaction_id: payment.stripePaymentIntent || payment.gatewayPaymentId || payment.gatewayOrderId || String(payment._id),
    transactionId: payment.stripePaymentIntent || payment.gatewayPaymentId || payment.gatewayOrderId || String(payment._id),

    // Payment method
    payment_method: paymentMethodDisplay,
    paymentMethod: paymentMethodDisplay,

    // Period covered
    period_covered: periodCovered,
    periodCovered: periodCovered,

    // Parties & contact
    tenant_name: tenant?.name || '',
    tenantName: tenant?.name || '',
    tenant_email: tenant?.email || '',
    tenantEmail: tenant?.email || '',
    property_title: property?.title || '',
    propertyTitle: property?.title || '',
    property_address: propertyAddress,
    propertyAddress: propertyAddress,
    landlord_name: (payment.landlord && payment.landlord.name) || property?.landlord?.name || '',
    landlordName: (payment.landlord && payment.landlord.name) || property?.landlord?.name || '',
    landlord_email: (payment.landlord && payment.landlord.email) || property?.landlord?.email || '',
    landlordEmail: (payment.landlord && payment.landlord.email) || property?.landlord?.email || '',

    // Metadata
    current_date: nowStr,
    currentDate: nowStr,
    payment_notes: payment.notes || '',
    paymentNotes: payment.notes || '',
    gateway: payment.gateway || '',
    gateway_payment_id: payment.gatewayPaymentId || '',
    gatewayOrderId: payment.gatewayOrderId || '',
    receipt_url: payment.receiptUrl || '',

    // merge template custom variables (if any)
    ...flattenTemplateVariables(template?.variables),
  };

  // Render body HTML from template if available, otherwise fall back to a simple receipt layout
  let bodyHtml = '';
  if (template && template.bodyJson && template.bodyJson.type === 'doc') {
    bodyHtml = generateHtmlFromJson(template.bodyJson);
  } else if (template && template.bodyHtml) {
    bodyHtml = template.bodyHtml;
  } else {
    bodyHtml = `
      <div style="margin-top: 20px;">
        <p><strong>Receipt Number:</strong> ${vars.receipt_number}</p>
        <p><strong>Date:</strong> ${vars.payment_date}</p>
        <p><strong>Tenant:</strong> ${vars.tenant_name || '—'}</p>
        <p><strong>Property:</strong> ${vars.property_title || '—'}</p>
        <div style="margin-top:12px; text-align: right;">
          <h2 style="margin:0;">Amount Paid: ${vars.paid_amount}</h2>
        </div>
      </div>
    `;
  }

  // Replace TipTap variable spans (<span data-type="variable" data-name="..."></span>) with values from vars
  const variablePattern = /<span\b[^>]*\bdata-type=["']variable["'][^>]*>[\s\S]*?<\/span>/gi;
  bodyHtml = bodyHtml.replace(variablePattern, (match) => {
    const nameMatch = match.match(/\bdata-name=["']([^"']+)["']/i) || match.match(/\bdata-name=([^\s>]+)/i);
    const varName = nameMatch ? (nameMatch[1] || null) : null;

    if (varName) {
      if (Object.prototype.hasOwnProperty.call(vars, varName)) {
        return `<strong>${vars[varName]}</strong>`;
      }
    }

    const labelMatch = match.match(/>([^<]+)<\/?span[^>]*>/i);
    const displayLabel = labelMatch ? labelMatch[1].trim() : '';
    if (displayLabel) return `<strong>${displayLabel}</strong>`;
    if (varName) return `<strong>{{${varName}}}</strong>`;
    return match;
  });

  // Substitute remaining {{variable}} tokens
  bodyHtml = substituteVariables(bodyHtml, vars);

  // Remove any clauses placeholders — receipts do not include clauses
  const placeholderRegex = /<div[^>]*\bdata-type=(?:"|')clauses-placeholder(?:"|')[^>]*>[\s\S]*?<\/div>/gi;
  bodyHtml = bodyHtml.replace(placeholderRegex, '');

  // Final wrapper for receipts (minimal — no hardcoded header or brand)
  const finalHtml = `
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: "Times New Roman", Times, serif; line-height: 1.4; color: #111; }
      </style>
    </head>
    <body style="padding:50px;">
      ${bodyHtml}
      <div style="margin-top: 60px; text-align:center; font-size:10pt; color:#666;">Thank you for your payment. This is a system-generated receipt.</div>
    </body>
    </html>
  `;

  return await generatePuppeteerPDFBuffer(finalHtml);
};

module.exports = {
  generateAgreementPDF,
  generateAgreementPDFBuffer,
  generateReceiptPDF,
  generateReceiptPDFBuffer,
};
