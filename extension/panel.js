import { latestReview, statusLabel } from './review.js';
import { api, message } from './bridge.js';
const $ = selector => document.querySelector(selector);
const state = { records: [], drafts: [], activity: [], scores: {}, excluded: [], filter: 'pending', search: '', draftId: '', busy: false, connected: false, ghost: false, autoAdd: false, approvalPostId: null, editorPostId: null, editId: null, editRevision: null, swapId: null, confirm: null };
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const hasScores = () => Object.keys(state.scores).length > 0;
const scoreOf = r => state.scores[r.id]?.score ?? -1;
const rankByScore = list => hasScores() ? [...list].sort((a, b) => (scoreOf(b) - scoreOf(a)) || (b.createdAt || '').localeCompare(a.createdAt || '')) : list;
const selectedDraft = () => state.drafts.find(d => d.id === state.draftId);
const draftTitles = () => selectedDraft()?.opportunityTitles || [];
const isDraft = id => !!id && state.drafts.some(d => d.id === id);
const inDraft = id => draftTitles().includes(state.records.find(r => r.id === id)?.title);
const formatDate = date => { const d = new Date(date + 'T12:00:00'); return Number.isNaN(d.valueOf()) ? 'No deadline' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
function notify(text, error = false) { const n = $('#notice'); n.textContent = text; n.className = `notice${error ? ' error' : ''}`; n.hidden = !text; }
async function load(quiet = false) {
  const session = await api('/session');
  const [records, drafts, activity] = await Promise.all([api('/opportunities'), api('/drafts'), api('/activity')]);
  Object.assign(state, { records: records.records, drafts: drafts.drafts, activity: activity.activity, connected: true, ghost: session.ghost, autoAdd: !!session.autoAdd && session.ghost, approvalPostId: session.approvalPostId });
  if (!state.drafts.some(d => d.id === state.draftId)) state.draftId = isDraft(state.editorPostId) ? state.editorPostId : state.autoAdd ? '' : state.drafts[0]?.id || '';
  $('#connection').textContent = session.mode === 'demo' ? 'DEMO WORKSPACE · SAMPLE OPPORTUNITIES' : 'CONNECTED TO AIRTABLE';
  $('#live-dot').classList.add('online');
  $('#sync-time').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (!quiet) notify('');
  render();
  loadRelevance();
}
// Suggestion scoring (urgency + reach + funder) is optional and must never block or
// break the panel. It runs after the main render and re-renders when results arrive.
// Excluded opportunities (e.g. blocked-country funders) are hidden from every view.
async function loadRelevance() {
  if (!state.connected) return;
  try {
    const { scores, excluded } = await api('/relevance');
    state.scores = scores || {};
    state.excluded = excluded || [];
    render();
  } catch { /* scoring unavailable — keep the date-ordered fallback */ }
}
function markOffline(error) { state.connected = false; $('#connection').textContent = 'CONNECTION NEEDS ATTENTION'; $('#live-dot').classList.remove('online'); notify(error.message, true); }
async function run(task, errorTarget) {
  if (state.busy) return;
  state.busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await task(); }
  catch (error) { if (errorTarget) $(errorTarget).textContent = error.message; else notify(error.message, true); }
  finally { state.busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
async function refreshAfter(messageText) {
  try { await load(true); notify(messageText); }
  catch (error) { markOffline(new Error(`The action was saved, but refresh failed: ${error.message}`)); }
}
function button(text, cls, action) { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', action); return node; }
async function changeStatus(record, status) {
  const adds = status === 'approved' && state.autoAdd;
  if (adds && !state.draftId && !state.approvalPostId) throw new Error('Open your draft in Ghost or choose it under “Your working draft” before approving.');
  const target = selectedDraft()?.title;
  await api(`/opportunities/${record.id}`, 'PATCH', { fields: { status }, revision: record.revision, ...(adds && state.draftId ? { draftId: state.draftId } : {}) });
  await refreshAfter(adds ? `“${record.title}” approved and added to ${target ? `“${target}”` : 'your default Ghost post'}. Reload Ghost to see it.` : `“${record.title}” marked ${statusLabel(status)}.`);
}
function confirm(copy, action) {
  state.confirm = action; $('#confirm-copy').textContent = copy; $('#confirm-error').textContent = ''; $('#confirm-dialog').showModal();
}
function card(record) {
  const node = el('article', 'card');
  const top = el('div', 'card-top'); top.append(el('span', 'org-avatar', (record.organization || record.title).charAt(0)), el('span', 'organization', record.organization || 'Independent opportunity'), el('span', 'category', record.category || 'Opportunity'));
  node.append(top, el('h2', '', record.title || 'Untitled opportunity'), el('p', 'card-description', record.summary || 'Open the details to add a description.'));
  const rel = state.scores[record.id];
  if (rel) node.append(el('p', 'relevance-reason', `★ ${rel.score}${rel.reason ? ` · ${rel.reason}` : ''}`));
  const meta = el('div', 'card-meta'); meta.append(el('span', 'deadline', record.deadline ? `◷  Closes ${formatDate(record.deadline)}` : '◷  Open deadline'));
  meta.append(el('span', `status ${record.status}`, statusLabel(record.status))); if (inDraft(record.id)) meta.append(el('span', 'status in-draft', 'In draft'));
  if (record.url) { try { const url = new URL(record.url); if (['http:', 'https:'].includes(url.protocol)) { const link = el('a', 'source-link', '↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Open source for ${record.title}`); meta.append(link); } } catch {} }
  const actions = el('div', 'card-actions');
  if (record.status !== 'approved') actions.append(button('✓ Approve', 'primary', () => run(() => changeStatus(record, 'approved'))));
  if (record.status === 'pending') actions.append(button('Reject', 'secondary', () => confirm(`Mark “${record.title}” as Not Approved?`, () => changeStatus(record, 'rejected'))));
  if (record.status === 'approved' && !inDraft(record.id) && (!state.autoAdd || state.draftId)) actions.append(button('+ Add to draft', 'primary', () => {
    if (!state.draftId) return notify('Select a working draft first. If none appear, configure Ghost on the server.', true);
    confirm(`Add “${record.title}” to “${selectedDraft().title}”? Save any open edits in Ghost first.`, async () => { await api(`/drafts/${state.draftId}/add`, 'POST', { recordId: record.id }); await refreshAfter('Opportunity added. Reload the draft in Ghost to see the update.'); });
  }));
  if (inDraft(record.id)) actions.append(button('⇄ Swap', 'secondary', () => openSwap(record)));
  if (record.status !== 'pending') actions.append(button('Reopen', 'subtle', () => confirm(`Move “${record.title}” back to pending? Existing Ghost cards are kept.`, () => changeStatus(record, 'pending'))));
  actions.append(button('Edit ↗', 'subtle edit', () => openEdit(record)));
  node.append(meta, actions); return node;
}
function render() {
  const visible = state.excluded.length ? state.records.filter(r => !state.excluded.includes(r.id)) : state.records;
  $('#total').textContent = visible.length;
  const select = $('#draft'); select.replaceChildren();
  if (state.autoAdd) { const o = el('option', '', state.approvalPostId ? 'Default post (server setting)' : 'Choose your working draft…'); o.value = ''; select.append(o); }
  else if (!state.drafts.length) { const o = el('option', '', 'No connected drafts'); o.value = ''; select.append(o); }
  state.drafts.forEach(d => { const o = el('option', '', d.title); o.value = d.id; select.append(o); }); select.value = state.draftId;
  $('#draft-count').textContent = `${draftTitles().length} selected`;
  $('#draft-hint').textContent = !state.ghost ? 'Connect Ghost on your server to start curating a draft.'
    : !state.autoAdd ? 'Save open Ghost edits before adding or swapping. Reload the draft afterward.'
    : state.draftId ? `Approve adds to “${selectedDraft().title}” automatically. Save open Ghost edits first, then reload the post.`
    : state.approvalPostId ? 'Approve adds to the default post set on the server. Open a draft in Ghost or choose one here to use it instead.'
    : 'Open your draft in Ghost or choose it here. Approve then adds opportunities to it automatically.';
  const matches = (r, f) => f === 'all' || (f === 'in-draft' ? inDraft(r.id) : r.status === f);
  document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b.dataset.filter === state.filter); b.querySelector('span').textContent = (b.dataset.filter === 'pending' ? latestReview(visible, state.scores) : visible.filter(r => matches(r, b.dataset.filter))).length; });
  const pool = state.filter === 'pending' ? latestReview(visible, state.scores) : rankByScore(visible);
  const records = pool.filter(r => matches(r, state.filter) && `${r.title} ${r.organization} ${r.summary} ${r.category}`.toLowerCase().includes(state.search));
  $('#list-label').textContent = state.filter === 'pending' && hasScores() ? 'TOP 8 · SUGGESTED' : ({ pending: 'LATEST 8 · AWAITING REVIEW', approved: 'READY FOR YOUR READERS', all: 'THE FULL COLLECTION', 'in-draft': 'YOUR EDITORIAL SELECTION' })[state.filter];
  $('#list-count').textContent = `${records.length} ${records.length === 1 ? 'opportunity' : 'opportunities'}`;
  $('#records').replaceChildren(...(records.length ? records.map(card) : [el('div', 'empty', state.search ? 'No matching opportunities.' : state.filter === 'pending' ? 'No opportunities awaiting review.' : state.filter === 'in-draft' ? 'No opportunities in this draft. Add an approved opportunity.' : 'No opportunities in this view.')]));
  $('#activity').replaceChildren(...(state.activity.length ? state.activity.map(a => { const row = el('div', 'activity-item'); const info = el('div'); info.append(el('p', '', a.description), el('small', '', `${a.editor} · ${new Date(a.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)); row.append(el('span', 'activity-dot', '✓'), info); return row; }) : [el('div', 'empty', 'No recent activity.')]));
}
function openEdit(record) {
  state.editId = record.id; state.editRevision = record.revision;
  for (const name of ['title', 'organization', 'summary', 'deadline', 'category', 'url']) $('#edit-form').elements[name].value = record[name] || '';
  $('#edit-error').textContent = ''; $('#detail-dialog').showModal();
}
function openSwap(record) {
  const candidates = rankByScore(state.records.filter(r => r.status === 'approved' && !inDraft(r.id) && !state.excluded.includes(r.id)));
  if (!candidates.length) return notify('Approve another opportunity first, then swap it into this draft.', true);
  state.swapId = record.id; $('#swap-description').textContent = `Replace “${record.title}” in “${selectedDraft().title}”.`;
  $('#replacement').replaceChildren(...candidates.map(r => { const o = el('option', '', r.title); o.value = r.id; return o; }));
  $('#swap-error').textContent = ''; $('#swap-dialog').showModal();
}
$('#settings').addEventListener('click', () => message({ type: 'settings:open' }).catch(e => notify(e.message, true)));
$('#refresh').addEventListener('click', () => run(async () => { try { await load(); } catch (error) { markOffline(error); } }));
$('#search').addEventListener('input', event => { state.search = event.target.value.trim().toLowerCase(); render(); });
$('#draft').addEventListener('change', event => { state.draftId = event.target.value; render(); });
// The content script reports the post open in the Ghost editor; follow it when it is a draft.
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'ghost-editor') return;
  const postId = event.data.postId;
  if (postId !== null && !(typeof postId === 'string' && /^[a-f0-9]{24}$/.test(postId))) return;
  state.editorPostId = postId;
  if (isDraft(postId) && state.draftId !== postId) { state.draftId = postId; render(); }
});
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-view]').forEach(tab => tab.classList.toggle('active', tab === b)); $('#opportunities-view').hidden = b.dataset.view !== 'opportunities'; $('#activity-view').hidden = b.dataset.view !== 'activity'; }));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('#edit-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  $('#edit-error').textContent = '';
  const fields = Object.fromEntries(new FormData(event.target));
  await api(`/opportunities/${state.editId}`, 'PATCH', { fields, revision: state.editRevision });
  $('#detail-dialog').close(); await refreshAfter('Opportunity details saved.');
}, '#edit-error'); });
$('#swap-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await api(`/drafts/${state.draftId}/swap`, 'POST', { recordId: $('#replacement').value, removeId: state.swapId });
  $('#swap-dialog').close(); await refreshAfter('Opportunity swapped. Reload the Ghost draft to see the update.');
}, '#swap-error'); });
$('#command-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const result = await api('/commands/preview', 'POST', { text: $('#command').value });
  confirm(result.message, async () => { await changeStatus(result.record, result.status); $('#command').value = ''; });
}); });
$('#confirm-action').addEventListener('click', () => run(async () => { await state.confirm(); $('#confirm-dialog').close(); }, '#confirm-error'));
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); } });
// Refresh only while the editor is using the panel. Never rely on a persistent MV3 worker.
setInterval(() => { if (!document.hidden && !state.busy && state.connected && !document.querySelector('dialog[open]')) run(() => load(true).catch(markOffline)); }, 60000);
run(() => load().catch(markOffline));
