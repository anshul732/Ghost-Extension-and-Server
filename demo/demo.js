import { api } from '/bridge.js';
const $ = s => document.querySelector(s);
if (location.pathname.startsWith('/mock-ghost')) { document.body.classList.add('extension-test'); $('#demo-status').textContent = 'Extension test page · Configure this address in extension settings, then reload'; }
function route() { const overview = location.hash === '#overview'; $('#overview').hidden = !overview; $('#newsletter').hidden = overview; $('#page-label').textContent = overview ? 'Overview' : 'Draft'; document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('selected', a.hash === (overview ? '#overview' : '#draft'))); }
window.addEventListener('hashchange', route); route();
// Reconstruct a small allowed subset; never render record HTML unchecked.
function safeNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
  if (node.nodeType !== Node.ELEMENT_NODE || !['P', 'H3', 'A'].includes(node.tagName)) return document.createDocumentFragment();
  const result = document.createElement(node.tagName);
  if (node.tagName === 'A') { try { const u = new URL(node.getAttribute('href')); if (['https:', 'http:'].includes(u.protocol)) { result.href = u.href; result.target = '_blank'; result.rel = 'noopener noreferrer'; } } catch {} }
  result.append(...[...node.childNodes].map(safeNode)); return result;
}
let last;
async function refresh() {
  try {
    const { post } = await api('/demo-draft');
    if (last === post.lexical) return; last = post.lexical;
    const children = JSON.parse(post.lexical).root.children;
    $('#draft-content').replaceChildren(...children.map(node => {
      if (node.type === 'html') { const fragment = document.createDocumentFragment(); const doc = new DOMParser().parseFromString(node.html, 'text/html'); fragment.append(...[...doc.body.childNodes].map(safeNode)); return fragment; }
      const p = document.createElement('p'); p.textContent = (node.children || []).map(c => c.text || '').join(''); return p;
    }));
    $('#draft-placeholder').hidden = children.some(c => c.type === 'html');
  } catch (error) { $('#demo-status').textContent = error.message; }
}
$('#copy-token').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/demo-session', { method: 'POST', headers: { 'X-Demo-Request': '1' } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    await navigator.clipboard.writeText(data.token); $('#copy-token').textContent = 'Copied — paste in extension settings ✓';
  } catch (error) { $('#demo-status').textContent = `Could not copy token: ${error.message}`; }
});
refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 2500);
