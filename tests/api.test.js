import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';

const token = 'test-editor-token-with-at-least-32-characters';
async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'opportunities-test-'));
  const app = await createApp({ dataDir, tokens: { tester: token } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const request = async (path, method = 'GET', body, key = randomUUID()) => {
    const response = await fetch(origin + '/api' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  return { ...app, origin, request, dataDir };
}
test('API requires editor auth; demo bootstrap rejects unrelated origins', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/api/opportunities')).status, 401);
  assert.equal((await fetch(f.origin + '/api/demo-session', { method: 'POST', headers: { Origin: 'https://evil.example', 'X-Demo-Request': '1' } })).status, 403);
  assert.equal((await fetch(f.origin + '/api/demo-session', { method: 'POST', headers: { Origin: f.origin, 'X-Demo-Request': '1' } })).status, 200);
  assert.equal((await f.request('/session')).data.editor, 'tester');
});
test('approve, edit, add, swap, and activity round-trip through the real HTTP API', async t => {
  const f = await fixture(t);
  const records = (await f.request('/opportunities')).data.records;
  const a = records[0]; const b = records[1];
  const approved = await f.request(`/opportunities/${a.id}`, 'PATCH', { fields: { status: 'approved' }, revision: a.revision });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.record.status, 'approved');
  const added = await f.request('/drafts/demoDraft/add', 'POST', { recordId: a.id });
  assert.deepEqual(added.data.draft.recordIds, [a.id]);
  const blocked = await f.request('/drafts/demoDraft/swap', 'POST', { recordId: b.id, removeId: a.id });
  assert.equal(blocked.status, 409);
  await f.request(`/opportunities/${b.id}`, 'PATCH', { fields: { status: 'approved', title: 'A revised Globex title' }, revision: b.revision });
  const swapped = await f.request('/drafts/demoDraft/swap', 'POST', { recordId: b.id, removeId: a.id });
  assert.deepEqual(swapped.data.draft.recordIds, [b.id]);
  assert.ok((await f.request('/activity')).data.activity.length >= 4);
  assert.equal((await f.request('/opportunities')).data.records[1].title, 'A revised Globex title');
});
test('idempotency replays the result and rejects a reused key with different content', async t => {
  const f = await fixture(t); const record = (await f.request('/opportunities')).data.records[0];
  const key = randomUUID(); const input = { fields: { status: 'approved' }, revision: record.revision };
  const first = await f.request(`/opportunities/${record.id}`, 'PATCH', input, key);
  const retry = await f.request(`/opportunities/${record.id}`, 'PATCH', input, key);
  assert.equal(retry.status, 200); assert.deepEqual(retry.data, first.data);
  assert.equal((await f.request('/activity')).data.activity.length, 1);
  assert.equal((await f.request(`/opportunities/${record.id}`, 'PATCH', { ...input, fields: { status: 'rejected' } }, key)).status, 409);
});
test('concurrent edits with the same revision cannot overwrite each other', async t => {
  const f = await fixture(t); const record = (await f.request('/opportunities')).data.records[0];
  const results = await Promise.all(['approved', 'rejected'].map(status => f.request(`/opportunities/${record.id}`, 'PATCH', { fields: { status }, revision: record.revision })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});
test('published drafts, invalid fields, and unknown endpoints fail without mutation', async t => {
  const f = await fixture(t); const record = (await f.request('/opportunities')).data.records[2];
  f.store.state.drafts[0].status = 'published';
  assert.equal((await f.request('/drafts/demoDraft/add', 'POST', { recordId: record.id })).status, 409);
  assert.equal((await f.request(`/opportunities/${record.id}`, 'PATCH', { fields: { malicious: 'x' }, revision: record.revision })).status, 400);
  assert.equal((await f.request('/publish', 'POST', {})).status, 404);
});
test('commands preview a concrete action without writing', async t => {
  const f = await fixture(t);
  const preview = await f.request('/commands/preview', 'POST', { text: 'approve Acme' });
  assert.equal(preview.data.status, 'approved');
  assert.equal((await f.request('/opportunities')).data.records[0].status, 'pending');
});
test('demo writes and idempotency results are persisted to disk', async t => {
  const f = await fixture(t); const r = (await f.request('/opportunities')).data.records[0];
  const key = randomUUID(); const data = { fields: { status: 'approved' }, revision: r.revision };
  await f.request(`/opportunities/${r.id}`, 'PATCH', data, key);
  assert.equal(f.store.state.operations[Object.keys(f.store.state.operations)[0]].result.record.status, 'approved');
  // The state file is read independently to ensure this wasn't only an in-memory change.
  const { readFile } = await import('node:fs/promises');
  // Verify via a second store using the fixture's state file directory below.
  const stored = JSON.parse(await readFile(join(f.dataDir, 'state.json'), 'utf8'));
  assert.equal(stored.records[0].status, 'approved');
  assert.equal(Object.values(stored.operations)[0].result.record.status, 'approved');
});
