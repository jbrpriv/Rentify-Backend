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

    default:
      return children;
  }
}

module.exports = {
  generateHtmlFromJson,
};
