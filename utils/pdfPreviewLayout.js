const LAYOUTS_WITH_SIDEBAR = new Set([
  'sidebar-left',
  'sidebar-right',
  'asymmetric',
  'timeline',
  'grid-modular',
  'infographic',
  'portfolio',
  'card-header',
  'split-screen',
  'three-column',
  'two-column-body',
]);

const SIDEBAR_CATEGORIES = {
  parties: { title: 'Parties', fields: ['landlord_name', 'tenant_name'] },
  dates: { title: 'Key Dates', fields: ['start_date', 'end_date', 'duration_months', 'current_date'] },
  financials: { title: 'Financial Terms', fields: ['rent_amount', 'security_deposit', 'total_move_in', 'maintenance_fee', 'late_fee', 'pet_deposit'] },
  policies: { title: 'Policies', fields: ['utilities_included', 'pet_allowed', 'rent_escalation_enabled', 'rent_escalation_percentage', 'termination_policy'] },
};

const VARIABLE_LABELS = {
  landlord_name: 'Landlord',
  tenant_name: 'Tenant',
  start_date: 'Start Date',
  end_date: 'End Date',
  duration_months: 'Duration',
  current_date: 'Date',
  rent_amount: 'Monthly Rent',
  security_deposit: 'Deposit',
  total_move_in: 'Move-in Total',
  maintenance_fee: 'Maintenance',
  late_fee: 'Late Fee',
  pet_deposit: 'Pet Deposit',
  utilities_included: 'Utilities',
  pet_allowed: 'Pets',
  rent_escalation_enabled: 'Escalation',
  rent_escalation_percentage: 'Escalation %',
  termination_policy: 'Termination',
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractFirstBlock(html, regex) {
  const match = html.match(regex);
  if (!match) return { block: '', rest: html };

  const block = match[0];
  return {
    block,
    rest: html.replace(block, ''),
  };
}

function buildSidebarHtml(vars, theme, logoUrl, signatureHtml = '') {
  const sections = theme?.layout?.sidebarSections || [];
  if (!sections.length && !signatureHtml) return '';

  const logoPos = theme?.layout?.logoPosition || 'header-left';
  let sidebarContent = '';

  if (logoUrl && (logoPos === 'sidebar-top' || logoPos === 'sidebar-center')) {
    const isCenteredLayout = ['grid-modular', 'three-column', 'card-header', 'infographic'].includes(theme?.layout?.type);
    const shouldCenter = logoPos === 'sidebar-center' || isCenteredLayout;
    
    sidebarContent += `<img src="${logoUrl}" class="sidebar-logo" alt="Logo" style="display:block;${shouldCenter ? 'margin:0 auto;' : ''}" />`;
  }

  for (const sectionKey of sections) {
    const cat = SIDEBAR_CATEGORIES[sectionKey];
    if (!cat) continue;

    sidebarContent += `<div class="sidebar-section"><div class="sidebar-title">${cat.title}</div>`;

    for (const field of cat.fields) {
      const value = vars[field];
      if (value) {
        const label = VARIABLE_LABELS[field] || field.replace(/_/g, ' ');
        sidebarContent += `
          <div style="margin-bottom: calc(6px * var(--onepage-margin-scale, 1));">
            <div class="sidebar-label">${label}</div>
            <div class="sidebar-value">${escapeHtml(value)}</div>
          </div>`;
      }
    }

    sidebarContent += '</div>';
  }

  if (signatureHtml) {
    sidebarContent += `
      <div class="sidebar-section sidebar-signature">
        ${signatureHtml}
      </div>
    `;
  }

  return sidebarContent;
}

function buildInfoStripHtml(vars, theme) {
  const sections = theme?.layout?.sidebarSections || ['parties', 'dates'];
  const stripFields = {
    parties: [
      { label: 'Landlord', key: 'landlord_name' },
      { label: 'Tenant', key: 'tenant_name' },
    ],
    dates: [
      { label: 'Start', key: 'start_date' },
      { label: 'End', key: 'end_date' },
    ],
    financials: [
      { label: 'Rent', key: 'rent_amount' },
      { label: 'Deposit', key: 'security_deposit' },
    ],
  };

  let leftCol = '';
  let rightCol = '';

  const sectionData = sections.map((s) => stripFields[s]).filter(Boolean);
  const allFields = sectionData.flat();
  const mid = Math.ceil(allFields.length / 2);

  allFields.slice(0, mid).forEach((f) => {
    const val = vars[f.key] || '—';
    leftCol += `<div class="info-label">${f.label}</div><div class="info-value">${escapeHtml(val)}</div>`;
  });

  allFields.slice(mid).forEach((f) => {
    const val = vars[f.key] || '—';
    rightCol += `<div class="info-label">${f.label}</div><div class="info-value">${escapeHtml(val)}</div>`;
  });

  return `
    <div class="layout-info-strip">
      <div class="info-col">${leftCol}</div>
      <div class="info-col">${rightCol}</div>
    </div>
  `;
}

function buildPreviewLayoutHtml(bodyHtml, vars, theme, logoUrl, signatureHtml = '', signaturePlacement = 'body') {
  const sourceHtml = bodyHtml || '';
  const { block: headingBlock, rest: bodyHtmlRemaining } = extractFirstBlock(sourceHtml, /<h1\b[^>]*>[\s\S]*?<\/h1>/i);
  const headingInner = headingBlock
    ? headingBlock.replace(/<\/h1>/gi, '').replace(/<h1\b[^>]*>/gi, '').trim()
    : '';
  const heroTitle = headingInner || 'Untitled Document';
  const bodyContent = (bodyHtmlRemaining || sourceHtml || '').trim();

  const layoutType = theme?.layout?.type || 'full-width';
  const isHero = Boolean(theme?.hero?.enabled);
  const logoPos = theme?.layout?.logoPosition || 'header-left';
  const hasSidebar = LAYOUTS_WITH_SIDEBAR.has(layoutType);
  const showLogoInHeader = !hasSidebar || !['sidebar-top', 'sidebar-center'].includes(logoPos);

  const logoHtml = logoUrl && showLogoInHeader
    ? `<div class="hero-logo-container"><img src="${logoUrl}" class="hero-logo-img" /></div>`
    : '';

  const headerHtml = `
    <div class="${isHero ? 'theme-hero-band' : 'standard-header-box'}">
      ${logoHtml}
      <div class="hero-title">${heroTitle}</div>
    </div>
  `;

  const infoStripHtml = layoutType === 'split-header' ? buildInfoStripHtml(vars, theme) : '';
  const signatureInSidebar = signaturePlacement === 'sidebar';
  const sidebarHtml = hasSidebar
    ? buildSidebarHtml(vars, theme, logoUrl, signatureInSidebar ? signatureHtml : '')
    : '';

  const bodySignatureHtml = signatureInSidebar ? '' : signatureHtml;
  const bodySection = `<div class="a4-page-body">${bodyContent}${bodySignatureHtml}</div>`;

  if (hasSidebar) {
    return `
      <div class="a4-page layout-page-wrapper layout-${layoutType}">
        <div class="layout-sidebar">${sidebarHtml}</div>
        <div class="layout-main">
          ${headerHtml}
          ${infoStripHtml}
          ${bodySection}
        </div>
      </div>
    `;
  }

  return `
    <div class="a4-page layout-page-wrapper layout-${layoutType}">
      <div class="layout-main">
        ${headerHtml}
        ${infoStripHtml}
        ${bodySection}
      </div>
    </div>
  `;
}

const ONE_PAGE_ENFORCER_SCRIPT = `
  (function() {
    const A4_HEIGHT = 1123;
    const SCALE_STEPS = [
      { fontScale: 1.0,  lineHeight: 1.0,  paddingScale: 1.0,  tablePadding: '10px 14px', marginScale: 1.0, headingScale: 1.0 },
      { fontScale: 0.95, lineHeight: 0.95, paddingScale: 0.9,  tablePadding: '8px 12px',  marginScale: 0.9, headingScale: 0.95 },
      { fontScale: 0.88, lineHeight: 0.9,  paddingScale: 0.8,  tablePadding: '6px 10px',  marginScale: 0.8, headingScale: 0.88 },
      { fontScale: 0.82, lineHeight: 0.85, paddingScale: 0.7,  tablePadding: '5px 8px',   marginScale: 0.7, headingScale: 0.82 },
      { fontScale: 0.75, lineHeight: 0.82, paddingScale: 0.6,  tablePadding: '4px 6px',   marginScale: 0.6, headingScale: 0.75 },
      { fontScale: 0.68, lineHeight: 0.78, paddingScale: 0.5,  tablePadding: '3px 5px',   marginScale: 0.5, headingScale: 0.68 },
      { fontScale: 0.60, lineHeight: 0.75, paddingScale: 0.4,  tablePadding: '2px 4px',   marginScale: 0.4, headingScale: 0.60 },
      { fontScale: 0.55, lineHeight: 0.72, paddingScale: 0.35, tablePadding: '2px 3px',   marginScale: 0.35, headingScale: 0.55 },
    ];

    function applyScale(el, scale) {
      el.style.setProperty('--onepage-font-scale', scale.fontScale);
      el.style.setProperty('--onepage-line-height', scale.lineHeight);
      el.style.setProperty('--onepage-padding-scale', scale.paddingScale);
      el.style.setProperty('--onepage-table-padding', scale.tablePadding);
      el.style.setProperty('--onepage-margin-scale', scale.marginScale);
      el.style.setProperty('--onepage-heading-scale', scale.headingScale);
    }

    const pageEl = document.querySelector('.a4-page');
    if (!pageEl) return;

    let currentHeight = pageEl.scrollHeight;
    if (currentHeight <= A4_HEIGHT) return;

    for (let i = 1; i < SCALE_STEPS.length; i++) {
      applyScale(pageEl, SCALE_STEPS[i]);
      if (pageEl.scrollHeight <= A4_HEIGHT) break;
    }
  })();
`;

function buildPreviewThemeFromPdfTheme(theme = {}) {
  const layoutType = theme.layoutStyle || 'full-width';
  const hasSidebar = LAYOUTS_WITH_SIDEBAR.has(layoutType);
  const heroEnabled = theme.headerStyle === 'banner';

  return {
    layout: {
      type: layoutType,
      sidebarWidthPx: theme.sidebarWidthPx || 0,
      mainContentWidthPx: theme.mainContentWidthPx || 794,
      leftWidthPercent: theme.leftWidthPercent || 60,
      rightWidthPercent: theme.rightWidthPercent || 40,
      bodyMaxWidthPx: theme.bodyMaxWidthPx || 580,
      sidebarSections: theme.sidebarSections || [],
      logoPosition: hasSidebar ? 'sidebar-top' : 'header-left',
    },
    hero: {
      enabled: heroEnabled,
      height: theme.heroHeight || 0,
      background: theme.heroBackground || theme.primaryColor || 'transparent',
      titleColor: theme.tableHeaderText || '#FFFFFF',
      titleFontSize: '2.2rem',
    },
  };
}

function buildThemeVarsFromPdfTheme(theme = {}, previewTheme = {}) {
  const heroTitleColor = previewTheme.hero?.titleColor || theme.headingColor || '#FFFFFF';
  const heroHeight = previewTheme.hero?.height || 0;

  return {
    '--theme-heading-font': theme.headingFont || theme.bodyFont || 'Helvetica',
    '--theme-body-font': theme.bodyFont || theme.fontFamily || 'Helvetica',
    '--theme-heading-color': theme.headingColor || theme.primaryColor || '#111111',
    '--theme-body-color': theme.bodyTextColor || '#334155',
    '--theme-primary': theme.primaryColor || '#000000',
    '--theme-accent': theme.accentColor || '#666666',
    '--theme-table-border': theme.tableBorder || '#cbd5e1',
    '--theme-table-header-bg': theme.tableHeaderBg || '#f8fafc',
    '--theme-table-header-text': theme.tableHeaderText || '#334155',
    '--theme-hero-bg': theme.heroBackground || 'transparent',
    '--theme-hero-pattern': theme.heroPattern || 'none',
    '--theme-page-texture': theme.pageTexture || 'none',
    '--theme-header-rule': theme.headerRule || 'none',
    '--theme-section-rule': theme.sectionRule || 'none',
    '--theme-watermark-opacity': theme.watermarkEnabled ? theme.watermarkOpacity : 0,
    '--theme-watermark-color': theme.watermarkColor || 'transparent',
    '--theme-watermark-text': theme.watermarkEnabled && theme.watermarkText ? `"${theme.watermarkText}"` : '""',
    '--theme-font-scale': theme.fontSizeScale || 1,
    '--theme-heading-scale': 1,
    '--theme-aside-width': theme.sidebarWidthPx ? `${theme.sidebarWidthPx}px` : '0px',
    '--theme-page-bg': theme.pageBackground || theme.backgroundColor || '#FFFFFF',
    '--theme-hero-enabled': previewTheme.hero?.enabled ? '1' : '0',
    '--theme-hero-height': `${heroHeight}px`,
    '--theme-hero-title-color': heroTitleColor,
    '--theme-hero-title-size': previewTheme.hero?.titleFontSize || '2.2rem',
    '--theme-logo-max-height': theme.logoMaxHeight || '120px',
    '--theme-logo-align': theme.logoAlignment || 'left',
    '--theme-table-radius': theme.tableRadius || '0px',
    '--theme-table-alt-row': theme.tableAltRowBg || 'transparent',
    '--theme-body-line-height': 1.5,
    '--theme-content-padding': '40px',
    '--theme-sidebar-bg': theme.tableHeaderBg || theme.primaryColor || '#111111',
    '--theme-sidebar-text': theme.tableHeaderText || '#F8FAFC',
    '--theme-sidebar-accent': theme.accentColor || theme.primaryColor || '#3B82F6',
    '--theme-sidebar-width': `${previewTheme.layout?.sidebarWidthPx || 0}px`,
    '--theme-main-width': `${previewTheme.layout?.mainContentWidthPx || 794}px`,
    '--theme-layout-type': previewTheme.layout?.type || 'full-width',
  };
}

function generateLayoutCss(theme, themeVars) {
  const tv = (key, fallback) => themeVars[key] || fallback;

  const tableBorder = tv('--theme-table-border', '#cbd5e1');
  const tableHeaderBg = tv('--theme-table-header-bg', '#f8fafc');
  const tableHeaderText = tv('--theme-table-header-text', '#334155');
  const heroBg = tv('--theme-hero-bg', 'transparent');
  const heroHeight = tv('--theme-hero-height', '0px');
  const pageBg = tv('--theme-page-bg', '#FFFFFF');
  const tableRadius = tv('--theme-table-radius', '0px');
  const logoMaxH = tv('--theme-logo-max-height', '100px');
  const headingFont = tv('--theme-heading-font', 'inherit');
  const bodyFont = tv('--theme-body-font', 'inherit');
  const headingColor = tv('--theme-heading-color', '#0f172a');
  const bodyColor = tv('--theme-body-color', '#334155');
  const headerRule = tv('--theme-header-rule', 'none');
  const sectionRule = tv('--theme-section-rule', 'none');
  const heroTitleColor = tv('--theme-hero-title-color', '#FFFFFF');
  const heroTitleSize = tv('--theme-hero-title-size', '2.5rem');
  const contentPad = tv('--theme-content-padding', '60px');
  const pageTexture = tv('--theme-page-texture', 'none');
  const fontScale = tv('--theme-font-scale', 1);
  const headingScale = tv('--theme-heading-scale', 1);
  const bodyLineH = tv('--theme-body-line-height', 1.6);
  const accent = tv('--theme-primary', '#000');
  const sidebarBg = tv('--theme-sidebar-bg', 'transparent');
  const sidebarText = tv('--theme-sidebar-text', '#000');
  const sidebarAccent = tv('--theme-sidebar-accent', '#3B82F6');
  const primary = tv('--theme-primary', '#1F2937');

  const heroEnabled = theme?.hero?.enabled;
  const layoutType = theme?.layout?.type || 'full-width';
  const sidebarWidth = theme?.layout?.sidebarWidthPx || 0;

  const baseCss = `
    *, *::before, *::after { box-sizing: border-box; }

    .a4-page {
      --onepage-font-scale: 1;
      --onepage-line-height: 1;
      --onepage-padding-scale: 1;
      --onepage-table-padding: 10px 14px;
      --onepage-margin-scale: 1;
      --onepage-heading-scale: 1;
    }

    .a4-page {
      background-color: ${pageBg};
      background-image: ${pageTexture !== 'none' ? pageTexture : 'none'};
      height: 1123px;
      max-height: 1123px;
      width: 794px;
      margin: 0 auto;
      position: relative;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07), 0 20px 40px -8px rgba(0,0,0,0.15);
      overflow: hidden;
      font-size: calc(16px * ${fontScale} * var(--onepage-font-scale, 1));
      font-family: ${bodyFont};
    }

    .a4-page::before {
      content: var(--theme-watermark-text, "");
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-35deg);
      font-size: 100px; font-weight: 900; letter-spacing: 0.15em;
      color: var(--theme-watermark-color, rgba(0,0,0,0.05));
      opacity: var(--theme-watermark-opacity, 0);
      pointer-events: none; 
      z-index: 9999; 
      white-space: nowrap;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .theme-hero-band {
      width: 100%;
      background: ${heroBg};
      display: ${heroEnabled ? 'flex' : 'none'};
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: ${heroEnabled ? heroHeight : '0px'};
      min-height: ${heroEnabled ? heroHeight : '0px'};
      overflow: hidden;
      position: relative;
      z-index: 1;
    }

    .standard-header-box {
      width: 100%;
      padding: calc(30px * var(--onepage-padding-scale, 1)) calc(${contentPad} * var(--onepage-padding-scale, 1)) calc(8px * var(--onepage-padding-scale, 1));
      display: ${heroEnabled ? 'none' : 'flex'};
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .hero-logo-container {
      margin-bottom: calc(0.5rem * var(--onepage-margin-scale, 1));
    }

    .standard-header-box .hero-title {
      border-bottom: ${headerRule};
      padding-bottom: calc(0.4rem * var(--onepage-margin-scale, 1));
      margin-bottom: calc(0.3rem * var(--onepage-margin-scale, 1));
      font-size: calc(${heroTitleSize} * ${headingScale} * var(--onepage-heading-scale, 1));
      text-transform: none;
      letter-spacing: normal;
    }

    .hero-logo-img {
      max-height: calc(${logoMaxH} * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
    }

    .theme-hero-band .hero-title {
      font-family: ${headingFont};
      color: ${heroTitleColor} !important;
      font-size: calc(${heroTitleSize} * var(--onepage-heading-scale, 1));
      font-weight: 900;
      text-align: center;
      padding: 0 40px;
      margin: 0;
      line-height: 1.15;
    }

    .a4-page-body {
      padding: calc(${contentPad} * var(--onepage-padding-scale, 1));
      ${!heroEnabled ? `padding-top: calc(15px * var(--onepage-padding-scale, 1));` : ''}
      position: relative;
      z-index: 2;
    }

    hr {
      border: none;
      border-top: 2px solid ${accent};
      margin: calc(1.2rem * var(--onepage-margin-scale, 1)) 0;
      opacity: 0.3;
    }

    .a4-page h1, .a4-page h2, .a4-page h3 {
      font-family: ${headingFont};
      color: ${headingColor};
    }
    .a4-page h1 {
      font-size: calc(2rem * ${headingScale} * var(--onepage-heading-scale, 1));
      font-weight: 900; line-height: 1.15;
      margin-bottom: calc(0.3em * var(--onepage-margin-scale, 1));
      padding-bottom: calc(0.3rem * var(--onepage-margin-scale, 1));
      border-bottom: ${headerRule};
    }
    .a4-page h1:first-of-type { display: none !important; }

    .a4-page h2 {
      font-size: calc(1.2rem * ${headingScale} * var(--onepage-heading-scale, 1));
      font-weight: 700;
      margin-top: calc(1em * var(--onepage-margin-scale, 1));
      margin-bottom: calc(0.3em * var(--onepage-margin-scale, 1));
      padding-bottom: calc(0.15rem * var(--onepage-margin-scale, 1));
      border-bottom: ${sectionRule};
    }
    .a4-page h3 {
      font-size: calc(1.05rem * ${headingScale} * var(--onepage-heading-scale, 1));
      font-weight: 700;
      margin-top: calc(0.8em * var(--onepage-margin-scale, 1));
      margin-bottom: calc(0.25em * var(--onepage-margin-scale, 1));
    }
    .a4-page p, .a4-page li {
      font-family: ${bodyFont};
      color: ${bodyColor};
      line-height: calc(${bodyLineH} * var(--onepage-line-height, 1));
      margin-bottom: calc(0.5em * var(--onepage-margin-scale, 1));
    }
    .a4-page span, .a4-page blockquote {
      font-family: ${bodyFont};
      color: ${bodyColor};
    }

    .a4-page table {
      width: 100%;
      border-collapse: collapse;
      margin: calc(1rem * var(--onepage-margin-scale, 1)) 0;
      font-size: calc(0.85em * var(--onepage-font-scale, 1));
    }
    .a4-page .tableWrapper {
      border-radius: ${tableRadius};
      overflow: hidden;
      margin: calc(1rem * var(--onepage-margin-scale, 1)) 0;
      overflow-x: auto;
    }
    .a4-page th, .a4-page td {
      border: 1px solid ${tableBorder};
      padding: var(--onepage-table-padding, 10px 14px);
      text-align: left;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .a4-page th {
      background: ${tableHeaderBg};
      color: ${tableHeaderText};
      font-weight: 700;
      font-family: ${headingFont};
      font-size: 0.9em;
    }
    .a4-page th p { color: ${tableHeaderText}; margin: 0; }
    .a4-page td p { margin: 0; }

    .dual-column-wrapper {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 0; position: relative;
      margin: calc(1rem * var(--onepage-margin-scale, 1)) 0;
    }
    .dual-column-wrapper::after {
      content: ''; position: absolute;
      top: 0; bottom: 0; left: 50%;
      border-left: 2px dotted ${tableBorder};
      transform: translateX(-50%); z-index: 1;
    }
    .dual-column-side {
      padding: 0 15px; position: relative; z-index: 2;
      min-width: 0; word-wrap: break-word; overflow-wrap: break-word;
    }

    .preview-clauses-placeholder {
      width: 100%;
      margin: calc(1rem * var(--onepage-margin-scale, 1)) 0;
      background: rgba(0,0,0,0.02);
      border: 1px dashed ${tableBorder};
      border-radius: ${tableRadius || '8px'};
      padding: calc(20px * var(--onepage-padding-scale, 1));
    }

    .preview-variable { color: #0f172a; font-weight: 800; }

    /* ── Signatures ── */
    .sig-section {
      margin-top: calc(40px * var(--onepage-margin-scale, 1));
      page-break-inside: avoid;
    }
    .sig-grid {
      display: flex;
      justify-content: space-between;
      gap: calc(20px * var(--onepage-padding-scale, 1));
      margin-top: calc(15px * var(--onepage-margin-scale, 1));
    }
    .sig-box { flex: 1; }
    .sig-label {
      font-weight: 800;
      font-size: calc(0.65rem * var(--onepage-font-scale, 1));
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      margin-bottom: 4px;
    }
    .sig-image {
      display: block;
      max-height: calc(60px * var(--onepage-padding-scale, 1));
      max-width: 100%;
      margin-bottom: 4px;
      object-fit: contain;
    }
    .sig-blank {
      height: calc(50px * var(--onepage-padding-scale, 1));
      margin-bottom: 4px;
    }
    .sig-rule {
      border-top: 1.5px solid ${primary};
      margin-bottom: 6px;
      opacity: 0.8;
    }
    .sig-name {
      font-size: calc(0.9rem * var(--onepage-font-scale, 1));
      font-weight: 700;
      color: ${headingColor};
    }
    .sig-meta {
      font-size: calc(0.6rem * var(--onepage-font-scale, 1));
      opacity: 0.5;
      margin-top: 2px;
    }

    @media print {
      .preview-clauses-placeholder { border: none !important; background: transparent !important; }
    }
  `;

  const layoutCss = getLayoutSpecificCss(layoutType, {
    sidebarWidth,
    sidebarBg,
    sidebarText,
    sidebarAccent,
    contentPad,
    headingFont,
    bodyFont,
    headingColor,
    accent,
    primary,
    tableBorder,
    heroEnabled,
    heroBg,
    heroHeight,
    heroTitleColor,
    heroTitleSize,
    headingScale,
    fontScale,
    bodyLineH,
    theme,
  });

  return baseCss + layoutCss;
}

function getLayoutSpecificCss(layoutType, vars) {
  switch (layoutType) {
    case 'full-width':
      return fullWidthCss(vars);
    case 'sidebar-left':
      return sidebarCss(vars, 'left');
    case 'sidebar-right':
      return sidebarCss(vars, 'right');
    case 'split-header':
      return splitHeaderCss(vars);
    case 'centered-narrow':
      return centeredNarrowCss(vars);
    case 'top-band':
      return topBandCss(vars);
    case 'two-column-body':
      return twoColumnBodyCss(vars);
    case 'asymmetric':
      return asymmetricCss(vars);
    case 'timeline':
      return timelineCss(vars);
    case 'grid-modular':
      return gridModularCss(vars);
    case 'infographic':
      return infographicCss(vars);
    case 'portfolio':
      return portfolioCss(vars);
    case 'card-header':
      return cardHeaderCss(vars);
    case 'split-screen':
      return splitScreenCss(vars);
    case 'three-column':
      return threeColumnCss(vars);
    case 'banner-circle':
      return bannerCircleCss(vars);
    default:
      return fullWidthCss(vars);
  }
}

function fullWidthCss() {
  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .layout-sidebar { display: none; }
    .layout-main { flex: 1; }
  `;
}

function sidebarCss(vars, side) {
  const { sidebarWidth, sidebarBg, sidebarText, sidebarAccent, headingFont } = vars;
  const gridCols = side === 'left'
    ? `${sidebarWidth}px 1fr`
    : `1fr ${sidebarWidth}px`;

  return `
    .layout-page-wrapper {
      display: grid;
      grid-template-columns: ${gridCols};
      min-height: 1123px;
    }

    .layout-sidebar {
      background: ${sidebarBg};
      color: ${sidebarText};
      padding: calc(30px * var(--onepage-padding-scale, 1)) calc(20px * var(--onepage-padding-scale, 1));
      display: flex;
      flex-direction: column;
      gap: calc(14px * var(--onepage-margin-scale, 1));
      order: ${side === 'left' ? 0 : 1};
      border-${side === 'left' ? 'right' : 'left'}: 3px solid ${sidebarAccent};
    }

    .layout-sidebar .sidebar-logo {
      max-height: calc(50px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
    }
    .layout-sidebar .sidebar-logo-wrapper {
      width: auto;
      margin-bottom: calc(8px * var(--onepage-margin-scale, 1));
    }

    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.95rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(4px * var(--onepage-margin-scale, 1)) 0;
      padding-bottom: calc(4px * var(--onepage-margin-scale, 1));
      border-bottom: 2px solid ${sidebarAccent}40;
    }

    .layout-sidebar .sidebar-section {
      margin-bottom: calc(10px * var(--onepage-margin-scale, 1));
    }

    .layout-sidebar .sidebar-label {
      font-size: calc(0.6rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.6;
      margin-bottom: 2px;
    }

    .layout-sidebar .sidebar-value {
      font-size: calc(0.75rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      line-height: 1.3;
      word-break: break-word;
    }

    .layout-main {
      order: ${side === 'left' ? 1 : 0};
      min-height: 0;
    }

    .theme-hero-band, .standard-header-box {
      grid-column: ${side === 'left' ? '2' : '1'};
    }

    .layout-main .a4-page-body table {
      font-size: calc(0.8em * var(--onepage-font-scale, 1));
    }
    .layout-main .a4-page-body th,
    .layout-main .a4-page-body td {
      padding: var(--onepage-table-padding, 6px 8px);
    }
  `;
}

function splitHeaderCss(vars) {
  const { sidebarBg, sidebarText, sidebarAccent, headingFont } = vars;

  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .layout-sidebar { display: none; }
    .layout-main { flex: 1; }

    .layout-info-strip {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      background: ${sidebarBg};
      border-bottom: 3px solid ${sidebarAccent};
    }

    .layout-info-strip .info-col {
      padding: calc(12px * var(--onepage-padding-scale, 1)) calc(20px * var(--onepage-padding-scale, 1));
      color: ${sidebarText};
    }

    .layout-info-strip .info-col:first-child {
      border-right: 1px solid ${sidebarAccent}30;
    }

    .layout-info-strip .info-label {
      font-size: calc(0.6rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      opacity: 0.5;
      margin-bottom: 2px;
    }

    .layout-info-strip .info-value {
      font-size: calc(0.8rem * var(--onepage-font-scale, 1));
      font-weight: 700;
      font-family: ${headingFont};
    }
  `;
}

function centeredNarrowCss(vars) {
  const bodyMaxWidth = vars.theme?.layout?.bodyMaxWidthPx || 580;

  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
    }
    .layout-sidebar { display: none; }
    .layout-main {
      max-width: ${bodyMaxWidth}px;
      width: 100%;
      margin: 0 auto;
    }

    .standard-header-box, .theme-hero-band {
      max-width: ${bodyMaxWidth}px;
      margin: 0 auto;
    }

    .a4-page-body {
      max-width: ${bodyMaxWidth}px;
      margin: 0 auto;
      padding-left: calc(20px * var(--onepage-padding-scale, 1)) !important;
      padding-right: calc(20px * var(--onepage-padding-scale, 1)) !important;
    }
  `;
}

function topBandCss() {
  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .layout-sidebar { display: none; }
    .layout-main {
      flex: 1;
    }

    .a4-page-body {
      padding: calc(25px * var(--onepage-padding-scale, 1)) calc(40px * var(--onepage-padding-scale, 1)) !important;
    }

    .a4-page h2 {
      margin-top: calc(0.7em * var(--onepage-margin-scale, 1));
      margin-bottom: calc(0.2em * var(--onepage-margin-scale, 1));
    }
    .a4-page p, .a4-page li {
      margin-bottom: calc(0.3em * var(--onepage-margin-scale, 1));
    }
  `;
}

function twoColumnBodyCss(vars) {
  const { tableBorder, sidebarWidth, sidebarBg, sidebarText, sidebarAccent, headingFont } = vars;

  return `
    .layout-page-wrapper {
      display: grid;
      grid-template-columns: ${sidebarWidth}px 1fr;
      width: 794px;
      height: 1123px;
    }

    .layout-sidebar {
      background: ${sidebarBg};
      color: ${sidebarText};
      padding: calc(30px * var(--onepage-padding-scale, 1)) calc(20px * var(--onepage-padding-scale, 1));
      display: flex;
      flex-direction: column;
      gap: calc(14px * var(--onepage-margin-scale, 1));
      border-right: 3px solid ${sidebarAccent};
    }

    .layout-sidebar .sidebar-logo {
      max-height: calc(50px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
    }

    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.95rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(4px * var(--onepage-margin-scale, 1)) 0;
      padding-bottom: calc(4px * var(--onepage-margin-scale, 1));
      border-bottom: 2px solid ${sidebarAccent}40;
    }

    .layout-sidebar .sidebar-section {
      margin-bottom: calc(10px * var(--onepage-margin-scale, 1));
    }

    .layout-sidebar .sidebar-label {
      font-size: calc(0.6rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.6;
      margin-bottom: 2px;
    }

    .layout-sidebar .sidebar-value {
      font-size: calc(0.75rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      line-height: 1.3;
      word-break: break-word;
    }

    .layout-main { 
       display: flex;
       flex-direction: column;
       min-height: 0;
       width: 100%;
       overflow: hidden;
    }

    .a4-page-body {
      column-gap: 30px;
      column-rule: 1px solid ${tableBorder};
      padding: calc(40px * var(--onepage-padding-scale, 1)) calc(30px * var(--onepage-padding-scale, 1));
    }
    .a4-page-body:not(:has(.ProseMirror)) {
      columns: 2;
    }
    .a4-page-body .ProseMirror {
      columns: 2;
    }

    .a4-page-body h1, .a4-page-body h2, .a4-page-body h3,
    .a4-page-body .tableWrapper, .a4-page-body table,
    .a4-page-body .preview-clauses-placeholder,
    .a4-page-body .dual-column-wrapper {
      break-inside: avoid;
    }

    .a4-page-body .tableWrapper, .a4-page-body table {
      column-span: all;
      width: 100%;
    }

    .a4-page-body .preview-clauses-placeholder,
    .a4-page-body .dual-column-wrapper {
      column-span: all;
    }
  `;
}

function asymmetricCss(vars) {
  const { sidebarBg, sidebarText, sidebarAccent, headingFont } = vars;
  const leftPct = vars.theme?.layout?.leftWidthPercent || 60;
  const rightPct = vars.theme?.layout?.rightWidthPercent || 40;

  return `
    .layout-page-wrapper {
      display: grid;
      grid-template-columns: ${leftPct}% ${rightPct}%;
      min-height: 1123px;
    }

    .layout-main {
      order: 0;
      min-height: 0;
    }

    .layout-sidebar {
      order: 1;
      background: ${sidebarBg};
      color: ${sidebarText};
      padding: calc(25px * var(--onepage-padding-scale, 1)) calc(18px * var(--onepage-padding-scale, 1));
      display: flex;
      flex-direction: column;
      gap: calc(10px * var(--onepage-margin-scale, 1));
      border-left: 3px solid ${sidebarAccent};
      overflow: hidden;
    }

    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.8rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(3px * var(--onepage-margin-scale, 1)) 0;
      padding-bottom: calc(3px * var(--onepage-margin-scale, 1));
      border-bottom: 2px solid ${sidebarAccent}30;
    }

    .layout-sidebar .sidebar-label {
      font-size: calc(0.55rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.5;
      margin-bottom: 1px;
    }

    .layout-sidebar .sidebar-value {
      font-size: calc(0.7rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      line-height: 1.25;
      word-break: break-word;
    }

    .layout-sidebar .sidebar-logo {
      max-height: calc(40px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
      margin-bottom: calc(6px * var(--onepage-margin-scale, 1));
    }

    .layout-main .a4-page-body .tableWrapper {
      font-size: calc(0.8em * var(--onepage-font-scale, 1));
    }
    .layout-main .a4-page-body th,
    .layout-main .a4-page-body td {
      padding: var(--onepage-table-padding, 5px 8px);
    }
  `;
}

function timelineCss(vars) {
  const { accent, sidebarBg, sidebarText, sidebarAccent, headingFont } = vars;
  return `
    .layout-page-wrapper {
      display: grid;
      grid-template-columns: 200px 1fr;
      min-height: 1123px;
    }
    .layout-sidebar {
      background: ${sidebarBg};
      color: ${sidebarText};
      padding: calc(30px * var(--onepage-padding-scale, 1)) calc(16px * var(--onepage-padding-scale, 1));
      border-right: 3px solid ${accent};
      display: flex;
      flex-direction: column;
      gap: 0;
      position: relative;
    }
    .layout-sidebar::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 30px;
      bottom: 30px;
      width: 2px;
      background: ${accent}40;
      transform: translateX(-50%);
      pointer-events: none;
    }
    .layout-sidebar .sidebar-section {
      position: relative;
      padding-right: calc(12px * var(--onepage-padding-scale, 1));
      padding-bottom: calc(20px * var(--onepage-margin-scale, 1));
    }
    .layout-sidebar .sidebar-section::after {
      content: '';
      position: absolute;
      right: -8px;
      top: 4px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: ${accent};
      border: 2px solid ${sidebarBg};
    }
    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.65rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(3px * var(--onepage-margin-scale, 1)) 0;
    }
    .layout-sidebar .sidebar-label {
      font-size: calc(0.55rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.55;
      margin-bottom: 1px;
    }
    .layout-sidebar .sidebar-value {
      font-size: calc(0.7rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      line-height: 1.3;
      word-break: break-word;
    }
    .layout-sidebar .sidebar-logo,
    .layout-sidebar .sidebar-logo-wrapper {
      max-height: calc(44px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
      margin-bottom: calc(12px * var(--onepage-margin-scale, 1));
    }
    .layout-main { min-height: 0; }
  `;
}

function gridModularCss(vars) {
  const { primary, sidebarText, sidebarAccent, headingFont } = vars;
  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .layout-sidebar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: calc(10px * var(--onepage-margin-scale, 1));
      padding: calc(16px * var(--onepage-padding-scale, 1)) calc(24px * var(--onepage-padding-scale, 1));
      background: ${primary};
      border-bottom: 3px solid ${sidebarAccent};
    }
    .layout-sidebar .sidebar-section {
      border: 1px solid ${sidebarAccent}40;
      border-radius: 6px;
      padding: calc(10px * var(--onepage-padding-scale, 1)) calc(12px * var(--onepage-padding-scale, 1));
      background: rgba(255,255,255,0.07);
    }
    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.6rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(4px * var(--onepage-margin-scale, 1)) 0;
      padding-bottom: calc(3px * var(--onepage-margin-scale, 1));
      border-bottom: 1px solid ${sidebarAccent}30;
    }
    .layout-sidebar .sidebar-label {
      font-size: calc(0.5rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: ${sidebarText};
      opacity: 0.55;
      margin-bottom: 1px;
    }
    .layout-sidebar .sidebar-value {
      font-size: calc(0.65rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      color: ${sidebarText};
      line-height: 1.3;
      word-break: break-word;
    }
    .layout-sidebar .sidebar-logo {
      max-height: calc(36px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
      margin-bottom: calc(6px * var(--onepage-margin-scale, 1));
      grid-column: 1 / -1; justify-self: center;
    }
    .layout-main { flex: 1; }
  `;
}

function infographicCss(vars) {
  const { primary, sidebarText, sidebarAccent, headingFont } = vars;
  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .layout-sidebar {
      display: flex;
      justify-content: space-around;
      align-items: flex-start;
      background: ${primary};
      color: ${sidebarText};
      padding: calc(14px * var(--onepage-padding-scale, 1)) calc(20px * var(--onepage-padding-scale, 1));
      border-bottom: 3px solid ${sidebarAccent};
      gap: calc(8px * var(--onepage-margin-scale, 1));
      flex-wrap: wrap;
    }
    .layout-sidebar .sidebar-section {
      flex: 1;
      text-align: center;
      padding: calc(8px * var(--onepage-padding-scale, 1));
      border-right: 1px solid ${sidebarAccent}30;
    }
    .layout-sidebar .sidebar-section:last-child {
      border-right: none;
    }
    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.6rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 0 0 calc(4px * var(--onepage-margin-scale, 1)) 0;
    }
    .layout-sidebar .sidebar-label {
      font-size: calc(0.5rem * var(--onepage-font-scale, 1));
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      color: ${sidebarText};
      margin-bottom: 1px;
    }
    .layout-sidebar .sidebar-value {
      font-size: calc(0.75rem * var(--onepage-font-scale, 1));
      font-weight: 700;
      color: ${sidebarText};
      line-height: 1.3;
    }
    .layout-sidebar .sidebar-logo {
      max-height: calc(36px * var(--onepage-padding-scale, 1));
      width: 100%;
      object-fit: contain;
    }
    .layout-sidebar .sidebar-logo-wrapper {
      width: 100%;
      margin-bottom: calc(12px * var(--onepage-margin-scale, 1));
    }
    .layout-main { flex: 1; }
  `;
}

function portfolioCss(vars) {
  const { sidebarBg, sidebarText, sidebarAccent, headingFont } = vars;
  return `
    .layout-page-wrapper {
      display: grid;
      grid-template-columns: 200px 1fr;
      min-height: 1123px;
    }
    .layout-sidebar {
      background: ${sidebarBg};
      color: ${sidebarText};
      padding: calc(28px * var(--onepage-padding-scale, 1)) calc(16px * var(--onepage-padding-scale, 1));
      border-right: 3px solid ${sidebarAccent};
      display: flex;
      flex-direction: column;
      gap: calc(12px * var(--onepage-margin-scale, 1));
    }
    .layout-sidebar .sidebar-section {
      padding: calc(10px * var(--onepage-padding-scale, 1)) calc(10px * var(--onepage-padding-scale, 1));
      background: rgba(255,255,255,0.06);
      border-radius: 6px;
      border: 1px solid ${sidebarAccent}25;
    }
    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.6rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(4px * var(--onepage-margin-scale, 1)) 0;
      padding-bottom: calc(3px * var(--onepage-margin-scale, 1));
      border-bottom: 1px solid ${sidebarAccent}30;
    }
    .layout-sidebar .sidebar-label {
      font-size: calc(0.5rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.55;
      margin-bottom: 1px;
    }
    .layout-sidebar .sidebar-value {
      font-size: calc(0.68rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      line-height: 1.3;
      word-break: break-word;
    }
    .layout-sidebar .sidebar-logo {
      max-height: calc(44px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
    }
    .layout-sidebar .sidebar-logo-wrapper {
      width: auto;
      margin-bottom: calc(8px * var(--onepage-margin-scale, 1));
    }
    .layout-main { min-height: 0; }
  `;
}

function cardHeaderCss(vars) {
  const { primary, sidebarAccent, headingFont, tableBorder } = vars;
  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .layout-sidebar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: calc(8px * var(--onepage-margin-scale, 1));
      margin: calc(16px * var(--onepage-margin-scale, 1)) calc(24px * var(--onepage-margin-scale, 1));
      padding: calc(14px * var(--onepage-padding-scale, 1));
      border: 2px solid ${primary};
      border-radius: 8px;
      box-shadow: 4px 4px 0 ${primary}33;
      background: #FFFFFF;
    }
    .layout-sidebar .sidebar-section {
      padding: calc(8px * var(--onepage-padding-scale, 1));
      border-right: 1px solid ${tableBorder}50;
    }
    .layout-sidebar .sidebar-section:last-child {
      border-right: none;
    }
    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.6rem * var(--onepage-heading-scale, 1));
      color: ${primary};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(4px * var(--onepage-margin-scale, 1)) 0;
      padding-bottom: calc(3px * var(--onepage-margin-scale, 1));
      border-bottom: 1px solid ${primary}25;
    }
    .layout-sidebar .sidebar-label {
      font-size: calc(0.5rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: ${primary};
      opacity: 0.5;
      margin-bottom: 1px;
    }
    .layout-sidebar .sidebar-value {
      font-size: calc(0.65rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      color: ${primary};
      line-height: 1.3;
      word-break: break-word;
    }
    .layout-sidebar .sidebar-logo {
      max-height: calc(36px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
      margin-bottom: calc(6px * var(--onepage-margin-scale, 1));
      grid-column: 1 / -1; justify-self: center;
    }
    .layout-main { flex: 1; }
  `;
}

function splitScreenCss(vars) {
  const { primary, sidebarText, sidebarAccent, headingFont } = vars;
  return `
    .layout-page-wrapper {
      display: grid;
      grid-template-columns: 220px 1fr;
      min-height: 1123px;
    }
    .layout-sidebar {
      background: ${primary};
      color: ${sidebarText};
      padding: calc(30px * var(--onepage-padding-scale, 1)) calc(20px * var(--onepage-padding-scale, 1));
      display: flex;
      flex-direction: column;
      gap: calc(12px * var(--onepage-margin-scale, 1));
      border-right: none;
      overflow: hidden;
    }
    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.65rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(4px * var(--onepage-margin-scale, 1)) 0;
      padding-bottom: calc(3px * var(--onepage-margin-scale, 1));
      border-bottom: 1px solid ${sidebarAccent}40;
    }
    .layout-sidebar .sidebar-section {
      margin-bottom: calc(8px * var(--onepage-margin-scale, 1));
    }
    .layout-sidebar .sidebar-label {
      font-size: calc(0.5rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: rgba(255,255,255,0.5);
      margin-bottom: 1px;
    }
    .layout-sidebar .sidebar-value {
      font-size: calc(0.7rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      color: ${sidebarText};
      line-height: 1.3;
      word-break: break-word;
    }
    .layout-sidebar .sidebar-logo,
    .layout-sidebar .sidebar-logo-wrapper {
      max-height: calc(44px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
      margin-bottom: calc(12px * var(--onepage-margin-scale, 1));
    }
    .layout-main { min-height: 0; background: #FFFFFF; }
  `;
}

function threeColumnCss(vars) {
  const { primary, sidebarBg, sidebarText, sidebarAccent, headingFont } = vars;
  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .layout-sidebar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0;
      border-bottom: 2px solid ${primary};
      background: ${sidebarBg};
    }
    .layout-sidebar .sidebar-section {
      padding: calc(12px * var(--onepage-padding-scale, 1)) calc(16px * var(--onepage-padding-scale, 1));
      border-right: 1px solid ${sidebarAccent}30;
    }
    .layout-sidebar .sidebar-section:last-child {
      border-right: none;
    }
    .layout-sidebar .sidebar-title {
      font-family: ${headingFont};
      font-weight: 900;
      font-size: calc(0.62rem * var(--onepage-heading-scale, 1));
      color: ${sidebarAccent};
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 calc(4px * var(--onepage-margin-scale, 1)) 0;
      padding-bottom: calc(3px * var(--onepage-margin-scale, 1));
      border-bottom: 1px solid ${sidebarAccent}30;
    }
    .layout-sidebar .sidebar-label {
      font-size: calc(0.5rem * var(--onepage-font-scale, 1));
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: ${sidebarText};
      opacity: 0.55;
      margin-bottom: 1px;
    }
    .layout-sidebar .sidebar-value {
      font-size: calc(0.68rem * var(--onepage-font-scale, 1));
      font-weight: 600;
      color: ${sidebarText};
      line-height: 1.3;
      word-break: break-word;
    }
    .layout-sidebar .sidebar-logo {
      max-height: calc(36px * var(--onepage-padding-scale, 1));
      width: auto;
      object-fit: contain;
      grid-column: 1 / -1; justify-self: center;
    }
    .layout-sidebar .sidebar-logo-wrapper {
      width: auto;
      margin-bottom: calc(12px * var(--onepage-margin-scale, 1));
      grid-column: 1 / -1; justify-self: center;
    }
    .layout-main { flex: 1; }
  `;
}

function bannerCircleCss(vars) {
  const { primary } = vars;
  return `
    .layout-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .layout-sidebar { display: none; }
    .layout-main {
      flex: 1;
      position: relative;
    }
    .theme-hero-band {
      position: relative;
      margin-bottom: calc(70px * var(--onepage-padding-scale, 1));
    }
    .agreement-logo-wrap {
      position: absolute;
      bottom: calc(-50px * var(--onepage-padding-scale, 1));
      left: 50%;
      transform: translateX(-50%);
      width: calc(100px * var(--onepage-padding-scale, 1));
      height: calc(100px * var(--onepage-padding-scale, 1));
      border-radius: 50%;
      background: white;
      border: 4px solid ${primary};
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      box-shadow: 0 4px 10px rgba(0,0,0,0.15);
      z-index: 10;
    }
  `;
}

module.exports = {
  LAYOUTS_WITH_SIDEBAR,
  buildPreviewLayoutHtml,
  buildPreviewThemeFromPdfTheme,
  buildThemeVarsFromPdfTheme,
  generateLayoutCss,
  ONE_PAGE_ENFORCER_SCRIPT,
};
