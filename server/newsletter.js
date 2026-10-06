// The design source is trusted repository content. Issue values are always escaped.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const marker = value => `<!--ijnet:${encode(value)}-->`;
export function metadata(html) {
  const match = String(html || '').match(/^<!--ijnet:([A-Za-z0-9_-]+)-->/);
  if (!match) return null;
  try { return JSON.parse(Buffer.from(match[1], 'base64url')); } catch { throw new Error('Invalid IJNet metadata.'); }
}
function url(value) {
  const parsed = new URL(value);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Newsletter links require HTTP(S) URLs.');
  return escapeHtml(parsed.href);
}
const table = cells => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-collapse:collapse"><tbody><tr>${cells.join('')}</tr></tbody></table>`;
const cell = (html, width) => `<td width="${width}%" valign="top" style="padding:10px;overflow-wrap:anywhere">${html}</td>`;
export function gridHtml(meta) {
  const columns = Array.from({ length: 4 }, () => []);
  for (const [i, item] of meta.items.entries()) {
    const title = escapeHtml(item.title);
    columns[i % 4].push(`<div data-ijnet-element="${escapeHtml(item.id)}"><p><strong>${escapeHtml(item.category)}</strong></p><h3>${item.url ? `<a href="${url(item.url)}">${title}</a>` : title}</h3><p>${escapeHtml(item.summary)}</p><p>Deadline: ${escapeHtml(item.deadline || 'Not specified')}</p></div>`);
  }
  return marker(meta) + table(columns.map(items => cell(items.join(''), 25)));
}
export function managedGrid(doc) {
  const candidates = (doc.root?.children || []).filter(n => n.type === 'html' && metadata(n.html)?.id === 'opportunities-grid');
  if (candidates.length > 1) throw new Error('Duplicate managed opportunity grids.');
  if (!candidates.length) return null;
  const node = candidates[0], meta = metadata(node.html);
  if (meta.version !== 1 || !Array.isArray(meta.items) || meta.items.some(i => !i.id || !i.title) || new Set(meta.items.map(i => i.id)).size !== meta.items.length) throw new Error('Invalid opportunity grid metadata.');
  return { node, meta };
}
export function patchGrid(grid, record, remove) {
  const { node, meta } = grid;
  if (node.html !== gridHtml(meta)) throw new Error('The opportunity HTML was edited manually. Reconcile it with the template before updating.');
  if (!record.id || !record.title) throw new Error('An opportunity needs a stable record ID and title.');
  const existing = meta.items.findIndex(i => i.id === record.id);
  if (!remove && existing >= 0) return false;
  const item = { id: record.id, title: record.title, summary: record.summary || '', category: record.category || '', deadline: record.deadline || '', url: record.url || '' };
  if (remove) {
    if (!remove.id || remove.id === record.id) throw new Error('Choose a different record ID for replacement.');
    const index = meta.items.findIndex(i => i.id === remove.id);
    if (index < 0 && existing >= 0) return false;
    if (index < 0 || existing >= 0) throw new Error('Original record is missing or replacement is already present.');
    meta.items.splice(index, 1, item);
  } else meta.items.push(item);
  node.html = gridHtml(meta);
  return true;
}

export function compileNewsletter(source, issue) {
  if (!source.root?.children || !source._meta?.editionDefaults?.[issue.edition] || !issue.locale || !issue.id) throw new Error('Source, edition, issue ID and locale are required.');
  const defaults = source._meta.editionDefaults[issue.edition];
  const global = { EDITOR_NAME: defaults.editor, SIGNOFF: defaults.signoff, SUBHEADER_INSIGHTS: 'RESEARCH', ...issue.values };
  const fill = (value, values) => String(value ?? '').replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Missing newsletter value: ${key}`);
    return String(values[key]);
  });
  const render = (n, values) => {
    const children = () => (n.children || []).map(c => render(c, values)).join('');
    switch (n.type) {
      case 'extended-text': {
        let content = escapeHtml(fill(n.text, values));
        if (n.format & 1) content = `<strong>${content}</strong>`;
        if (n.format & 2) content = `<em>${content}</em>`;
        if (n.style) content = `<span style="${escapeHtml(n.style)}">${content}</span>`;
        return n.url ? `<a href="${url(fill(n.url, values))}">${content}</a>` : content;
      }
      case 'paragraph': return `<p>${children()}</p>`;
      case 'heading': {
        if (!/^h[1-6]$/.test(n.tag)) throw new Error('Unsupported heading.');
        return `<${n.tag}>${children()}</${n.tag}>`;
      }
      case 'hr': return `<hr style="border:0;border-top:1px solid ${n.style === 'accent' ? '#00a3d4' : '#ddd'}">`;
      case 'image': return `<img src="${url(fill(n.src, values))}" alt="${escapeHtml(fill(n.altText, values))}" width="${Number(n.width)}" style="max-width:100%;height:auto">`;
      case 'callout': return `<div style="padding:20px;${n.backgroundColor === 'accent-double-border' ? 'border:4px double #00a3d4' : 'background:#f6f6f8'}">${children()}</div>`;
      case 'button': return `<p style="text-align:center"><a style="display:inline-block;padding:12px 20px;background:#007ca3;color:white" href="${url(fill(n.buttonUrl, values))}">${escapeHtml(fill(n.buttonText, values))}</a></p>`;
      case 'list': return `<ul>${children()}</ul>`;
      case 'listitem': return `<li>${children()}</li>`;
      case 'html': return n.html.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => key.endsWith('_URL') ? url(fill(`{{${key}}}`, values)) : escapeHtml(fill(`{{${key}}}`, values)));
      case 'columns': {
        const scoped = issue.columns?.[n.sectionLabel];
        const count = ['INSIGHTS_ROW', 'CASES_ROW'].includes(n.sectionLabel) ? 3 : n.columns.length;
        if (!scoped || scoped.length !== count) throw new Error(`Provide ${count} column values for ${n.sectionLabel}.`);
        return table(scoped.map((overrides, i) => {
          const col = n.columns[i] || n.columns[0];
          const width = n.sectionLabel === 'BREAKDOWNS_ROW' ? (i === 0 ? 66.67 : 33.33) : 100 / count;
          const elementId = `${n.sectionLabel.toLowerCase().replaceAll('_', '-')}-item-${i + 1}`;
          return cell(`<div data-ijnet-element="${elementId}">${col.children.map(c => render(c, { ...values, ...overrides })).join('')}</div>`, width);
        }));
      }
      default: throw new Error(`Unsupported source node: ${n.type}`);
    }
  };
  const sections = [];
  const children = source.root.children.flatMap((node, index) => {
    if (node.sectionLabel === 'SURVEY_CTA_ROW' && issue.includeSurvey === false) return [];
    const id = (node.sectionLabel || `divider-${index}`).toLowerCase().replaceAll(':', '-').replaceAll('_', '-');
    const meta = { version: 1, id, issueId: issue.id, locale: issue.locale, edition: issue.edition };
    sections.push({ ...meta, sourceIndex: index, sourceLabel: node.sectionLabel || null,
      elementIds: id === 'opportunities-grid' ? (issue.opportunities || []).map(i => i.id) : node.type === 'columns' ? (issue.columns?.[node.sectionLabel] || []).map((_, i) => `${id}-item-${i + 1}`) : [id] });
    let html;
    if (id === 'opportunities-grid') {
      meta.items = issue.opportunities || [];
      html = gridHtml(meta);
    } else html = marker(meta) + render(node, { ...global, ...issue.sections?.[node.sectionLabel] });
    return [{ type: 'html', version: 1, html }];
  });
  const lexical = { root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children } };
  managedGrid(lexical);
  return { lexical, manifest: { version: 1, issueId: issue.id, locale: issue.locale, edition: issue.edition, sourceMetadata: structuredClone(source._meta), sections } };
}
