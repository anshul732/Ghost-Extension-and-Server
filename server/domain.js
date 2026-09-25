import { createHash, createHmac } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const assert = (condition, status, message) => { if (!condition) throw new HttpError(status, message); };
export const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const safeId = id => { assert(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id), 400, 'Invalid record or draft ID.'); return id; };
export function validatePatch(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 400, 'Fields must be an object.');
  const limits = { title: 200, organization: 200, summary: 5000, url: 2000, deadline: 10, category: 100, status: 20 };
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    assert(key in limits, 400, `Cannot edit field: ${key}`);
    assert(typeof value === 'string' && value.length <= limits[key], 400, `Invalid ${key}.`);
    out[key] = value.trim();
  }
  assert(Object.keys(out).length > 0, 400, 'Choose at least one field to update.');
  if ('title' in out) assert(out.title.length > 0, 400, 'A title is required.');
  if ('status' in out) assert(['pending', 'approved', 'rejected'].includes(out.status), 400, 'Invalid status.');
  if (out.url) { let u; try { u = new URL(out.url); } catch {} assert(u && ['https:', 'http:'].includes(u.protocol), 400, 'Use an http or https URL.'); }
  if (out.deadline) { const date = new Date(out.deadline); assert(/^\d{4}-\d{2}-\d{2}$/.test(out.deadline) && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === out.deadline, 400, 'Use a valid deadline date.'); }
  return out;
}
// Opportunities are written as ordinary Lexical text, never as HTML cards, so
// editors can retype them in Ghost. Nothing here emits markup, so record values
// need no HTML escaping: they travel as plain text node content.
export const SECTION_HEADING = 'Opportunity';
const text = value => ({ type: 'extended-text', version: 1, text: String(value ?? ''), format: 0, detail: 0, mode: 'normal', style: '' });
const paragraph = children => ({ type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr', children });
const heading = (tag, value) => ({ type: 'heading', version: 1, tag, format: '', indent: 0, direction: 'ltr', children: [text(value)] });
const link = url => ({ type: 'link', version: 1, url, rel: null, target: null, title: null, format: '', indent: 0, direction: 'ltr', children: [text(url)] });
const headingText = node => node?.type === 'heading' ? (node.children || []).map(c => c.text || '').join('') : null;
const isHeading = node => node?.type === 'heading';
export function opportunitySummary(record) {
  const clean = String(record.summary || '').replace(/\s+/g, ' ').trim();
  const first = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || clean;
  return first.length > 180 ? first.slice(0, 177).replace(/\s+\S*$/, '') + '…' : first;
}
export function opportunityNodes(record) {
  let url = ''; try { const parsed = new URL(record.url); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href; } catch {}
  const meta = [text(`Deadline: ${record.deadline || 'Not specified'}`)];
  if (url) meta.push(text(' · '), link(url));
  return [heading('h3', record.title), paragraph([text(opportunitySummary(record))]), paragraph(meta)];
}
// Draft membership is read back from the document itself: each opportunity is the
// h3 whose text is its title. Titles, not record IDs, are the link between the two.
export function draftOpportunityTitles(post) {
  let doc; try { doc = JSON.parse(post.lexical); } catch { return []; }
  const children = doc.root?.children || [];
  const start = children.findIndex(n => n.tag === 'h2' && headingText(n) === SECTION_HEADING);
  if (start < 0) return [];
  return children.slice(start + 1).filter(n => n.tag === 'h3').map(headingText).filter(Boolean);
}
// Preserve the entire Lexical document. Only our own opportunity blocks are replaced.
export function patchDraft(post, record, remove, options = {}) {
  assert(post.status === 'draft' || (post.status === 'published' && options.approvalPostId === post.id), 409, 'Only unpublished drafts can be changed.');
  let doc; try { doc = JSON.parse(post.lexical); } catch { throw new HttpError(409, 'This draft has no valid Lexical document. Open and save it in Ghost first.'); }
  assert(Array.isArray(doc.root?.children), 409, 'Unsupported draft document.');
  const children = doc.root.children;
  const existing = draftOpportunityTitles(post);
  assert(record.title, 409, 'This opportunity needs a title before it can be added to a draft.');
  if (!remove && existing.includes(record.title)) return null;
  const nodes = opportunityNodes(record);
  // The end of a block is the next heading, so editors may add paragraphs inside one.
  const blockEnd = start => { let end = start + 1; while (end < children.length && !isHeading(children[end])) end++; return end; };
  if (remove) {
    assert(remove.title, 400, 'The opportunity being replaced has no title to match.');
    assert(remove.title !== record.title, 400, 'Choose a different replacement.');
    // A retry after a successful swap is a no-op, even if the first response was lost.
    if (!existing.includes(remove.title) && existing.includes(record.title)) return null;
    assert(!existing.includes(record.title), 409, 'Replacement is already in this draft.');
    const indices = children.map((n, i) => n.tag === 'h3' && headingText(n) === remove.title ? i : -1).filter(i => i >= 0);
    assert(indices.length === 1, 409, 'Could not uniquely locate the original opportunity.');
    children.splice(indices[0], blockEnd(indices[0]) - indices[0], ...nodes);
  } else {
    const headings = children.filter(n => n.tag === 'h2' && headingText(n) === SECTION_HEADING);
    assert(headings.length <= 1, 409, 'Duplicate Opportunity headings need review.');
    let insert;
    if (!headings.length) { children.push(heading('h2', SECTION_HEADING), { type: 'horizontalrule', version: 1 }); insert = children.length; }
    else {
      const start = children.indexOf(headings[0]);
      insert = start + 1;
      for (let i = insert; i < children.length; i++) if (children[i].tag === 'h3') insert = blockEnd(i);
    }
    children.splice(insert, 0, ...nodes);
  }
  return JSON.stringify(doc);
}
export function ghostToken(key, now = Math.floor(Date.now() / 1000)) {
  const [id, secret] = key.split(':');
  assert(id && /^[0-9a-f]{64}$/i.test(secret || ''), 503, 'Ghost Admin API key is not configured correctly.');
  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT', kid: id })}.${encode({ iat: now, exp: now + 300, aud: '/admin/' })}`;
  return `${body}.${createHmac('sha256', Buffer.from(secret, 'hex')).update(body).digest('base64url')}`;
}
export function parseCommand(text, records) {
  assert(typeof text === 'string' && text.length <= 500, 400, 'Enter a command under 500 characters.');
  const match = text.trim().match(/^(approve|reject|reopen)\s+(.+?)\s*$/i);
  assert(match, 400, 'Try “approve Acme”, “reject Globex”, or “reopen Acme”. Use the cards for edits and draft swaps.');
  const term = match[2].toLowerCase();
  const exact = records.filter(r => [r.id, r.title, r.organization].some(v => v?.toLowerCase() === term));
  const found = exact.length ? exact : records.filter(r => `${r.title} ${r.organization}`.toLowerCase().includes(term));
  assert(found.length === 1, 400, found.length ? 'More than one opportunity matches. Use its full title or record ID.' : 'No matching opportunity found.');
  return { record: found[0], status: { approve: 'approved', reject: 'rejected', reopen: 'pending' }[match[1].toLowerCase()] };
}
