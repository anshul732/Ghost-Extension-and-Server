import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assert, patchDraft, revision } from './domain.js';

export function seed() {
  const records = [
    ['recAcme', 'Creative futures fellowship', 'Acme Foundation', 'A six-month fellowship for independent writers and visual storytellers exploring the future of creative work. Includes mentorship and a $12,000 stipend.', 'Fellowship', 'pending', '2026-10-15'],
    ['recGlobex', 'Stories that move us', 'Globex Arts', 'An open call for original essays about community, belonging, and the places that shape us. Selected work receives a $2,500 commission.', 'Open call', 'pending', '2026-10-22'],
    ['recNorth', 'The independent voices grant', 'Northstar Fund', 'Project funding for emerging journalists working on underreported stories. Grants of up to $8,000 support research, travel, and production.', 'Grant', 'approved', '2026-11-02'],
    ['recField', 'A month in the mountains', 'Fieldwork Studio', 'A fully funded residency for writers seeking time and space to develop a new body of work. Accommodation and studio access included.', 'Residency', 'pending', '2026-11-10'],
    ['recPaper', 'Dispatches from tomorrow', 'Paper & People', 'Pitch a reported feature on the ideas changing everyday life. We welcome fresh perspectives and first-time contributors.', 'Commission', 'approved', '2026-10-30'],
    ['recArchive', 'Summer editorial internship', 'The Archive', 'A paid editorial internship supporting long-form stories, research, and the weekly newsletter. This application cycle has closed.', 'Job', 'rejected', '2026-08-01']
  ].map(([id, title, organization, summary, category, status, deadline]) => ({ id, title, organization, summary, category, status, deadline, url: 'https://example.com/opportunities' }));
  return { records, drafts: [{ id: 'demoDraft', title: 'The Sunday Edit — Opportunities', status: 'draft', updated_at: new Date().toISOString(), lexical: JSON.stringify({ root: { type: 'root', version: 1, format: '', indent: 0, direction: null, children: [{ type: 'paragraph', version: 1, format: '', indent: 0, direction: null, children: [{ type: 'extended-text', version: 1, text: 'A few good things worth making time for. Here are this week’s opportunities for curious, creative people.', format: 0, detail: 0, mode: 'normal', style: '' }] }] } }) }], activity: [], operations: {} };
}
export async function createStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; state = seed(); }
  return { get state() { return state; }, async save() { await writeFile(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 }); await rename(file + '.tmp', file); } };
}
export function demoAdapters(store) {
  const decorate = r => ({ ...r, revision: revision(r) });
  const find = (array, id) => { const item = array.find(r => r.id === id); assert(item, 404, 'Record not found.'); return item; };
  return {
    airtable: {
      async list() { return store.state.records.map(decorate); },
      async get(id) { return decorate(find(store.state.records, id)); },
      async update(id, patch, expected) { const r = find(store.state.records, id); assert(revision(r) === expected, 409, 'This opportunity changed. Refresh and try again.'); Object.assign(r, patch); await store.save(); return decorate(r); }
    },
    ghost: {
      async list() { return structuredClone(store.state.drafts.filter(d => d.status === 'draft')); },
      async get(id) { return structuredClone(find(store.state.drafts, id)); },
      async putOpportunity(id, record, removeId) { const d = find(store.state.drafts, id); const lexical = patchDraft(d, record, removeId); if (lexical) { d.lexical = lexical; d.updated_at = new Date().toISOString(); await store.save(); } return structuredClone(d); }
    }
  };
}
