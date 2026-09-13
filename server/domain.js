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
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function opportunityHtml(record) {
  let url = ''; try { const parsed = new URL(record.url); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href; } catch {}
  const clean = String(record.summary || '').replace(/\s+/g, ' ').trim();
  const first = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || clean;
  const summary = first.length > 180 ? first.slice(0, 177).replace(/\s+\S*$/, '') + '…' : first;
  return `<!-- opp:${safeId(record.id)} --><h3>${escape(record.title)}</h3><p>${escape(summary)}</p><p>Deadline: ${escape(record.deadline || 'Not specified')}${url ? ` · <a href="${escape(url)}">${escape(url)}</a>` : ''}</p><!-- /opp:${record.id} -->`;

}
export function draftRecordIds(post) {
  let doc; try { doc = JSON.parse(post.lexical); } catch { return []; }
  return (doc.root?.children || []).flatMap(node => node.type === 'html' ? [...(node.html || '').matchAll(/<!-- opp:([a-zA-Z0-9_-]+) -->/g)].map(m => m[1]) : []);
}
// Preserve the entire Lexical document. Only our dedicated HTML cards are replaced.
export function patchDraft(post, record, removeId, options = {}) {
  assert(post.status === 'draft' || (post.status === 'published' && options.approvalPostId === post.id), 409, 'Only unpublished drafts can be changed.');
  let doc; try { doc = JSON.parse(post.lexical); } catch { throw new HttpError(409, 'This draft has no valid Lexical document. Open and save it in Ghost first.'); }
  assert(Array.isArray(doc.root?.children), 409, 'Unsupported draft document.');
  const children = doc.root.children;
  const existing = draftRecordIds(post);
  if (!removeId && existing.includes(record.id)) return null;
  const card = { type: 'html', version: 1, html: opportunityHtml(record) };
  if (removeId) {
    safeId(removeId);
    assert(removeId !== record.id, 400, 'Choose a different replacement.');
    // A retry after a successful swap is a no-op, even if the first response was lost.
    if (!existing.includes(removeId) && existing.includes(record.id)) return null;
    assert(!existing.includes(record.id), 409, 'Replacement is already in this draft.');
    const indices = children.map((n, i) => n.type === 'html' && n.html?.includes(`<!-- opp:${removeId} -->`) ? i : -1).filter(i => i >= 0);
    assert(indices.length === 1, 409, 'Could not uniquely locate the original opportunity card.');
    const original = children[indices[0]].html;
    assert(original.startsWith(`<!-- opp:${removeId} -->`) && original.endsWith(`<!-- /opp:${removeId} -->`) && [...original.matchAll(/<!-- opp:/g)].length === 1, 409, 'The opportunity card was restructured. Review it in Ghost before swapping.');
    children[indices[0]] = { ...children[indices[0]], html: card.html };
  } else {
    const heading = '<!-- opportunities:heading --><h2>Opportunity</h2><hr><!-- /opportunities:heading -->';
    const headers = children.filter(n => n.type === 'html' && n.html === heading);
    assert(headers.length <= 1, 409, 'Duplicate Opportunity headings need review.');
    if (!headers.length) children.push({type: 'html', version: 1, html: heading});
    const positions = children.map((n,i) => n.type === 'html' && (n.html === heading || n.html?.startsWith('<!-- opp:')) ? i : -1);
    children.splice(Math.max(...positions) + 1, 0, card);
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
