/**
 * utils/tiptapParser.js
 *
 * Reconstructs accurate HTML directly from TipTap's JSON representation.
 * Bypasses the loss of styles and custom attributes (like data-type, data-name, etc.)
 * caused by global XSS sanitization on string bodies.
 */

function generateHtmlFromJson(node) {
  if (!node) return '';

  if (node.type === 'text') {
    let text = node.text || '';
    // Escape standard HTML entities
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'bold') text = `<strong>${text}</strong>`;
        if (mark.type === 'italic') text = `<em>${text}</em>`;
        if (mark.type === 'underline') text = `<u>${text}</u>`;
        if (mark.type === 'strike') text = `<s>${text}</s>`;
        if (mark.type === 'fontSize' && mark.attrs?.size) text = `<span style="font-size: ${mark.attrs.size}">${text}</span>`;
      }
    }
    return text;
  }

  const children = (node.content || []).map(generateHtmlFromJson).join('');

  switch (node.type) {
    case 'doc':
      return children;

    case 'paragraph': {
      const align = node.attrs?.textAlign;
      const style = align ? ` style="text-align: ${align}"` : '';
      return `<p${style}>${children || '<br>'}</p>`;
    }

    case 'heading': {
      const level = node.attrs?.level || 1;
      const align = node.attrs?.textAlign;
      const style = align ? ` style="text-align: ${align}"` : '';
      return `<h${level}${style}>${children}</h${level}>`;
    }

    case 'bulletList':
      return `<ul>${children}</ul>`;

    case 'orderedList':
      return `<ol>${children}</ol>`;

    case 'listItem':
      return `<li>${children}</li>`;

    case 'blockquote':
      return `<blockquote>${children}</blockquote>`;

    case 'hardBreak':
      return '<br>';

    case 'horizontalRule':
      return '<hr>';

    case 'table':
      return `<table><tbody>${children}</tbody></table>`;

    case 'tableRow':
      return `<tr>${children}</tr>`;

    case 'tableHeader':
      return `<th>${children}</th>`;

    case 'tableCell':
      return `<td>${children}</td>`;

    // ─── Custom Rentify Extensions ──────────────────────────────
    case 'variable':
      const name = node.attrs?.name || '';
      const label = node.attrs?.label || '';
      return `<span data-type="variable" data-name="${name}">${label}</span>`;

    case 'clausesPlaceholder':
      return `<div data-type="clauses-placeholder"></div>`;

    case 'image': {
      const src = node.attrs?.src || '';
      const alt = node.attrs?.alt || '';
      const title = node.attrs?.title || '';
      const width = node.attrs?.width;
      const align = node.attrs?.textAlign;

      const styles = [];
      if (width && width !== 'auto') styles.push(`width: ${width}`);

      if (align === 'center') {
        styles.push('display: block', 'margin-left: auto', 'margin-right: auto');
      } else if (align === 'right') {
        styles.push('display: block', 'margin-left: auto', 'margin-right: 0');
      } else if (align === 'left') {
        styles.push('display: block', 'margin-right: auto', 'margin-left: 0');
      }

      const styleAttr = styles.length > 0 ? ` style="${styles.join('; ')}"` : '';
      return `<img src="${src}" alt="${alt}" title="${title}" class="document-image"${styleAttr} />`;
    }

    default:
      return children;
  }
}

module.exports = {
  generateHtmlFromJson,
};