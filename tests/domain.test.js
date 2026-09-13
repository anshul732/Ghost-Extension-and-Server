import test from 'node:test';
import assert from 'node:assert/strict';
import { patchDraft, draftRecordIds, ghostToken, validatePatch, parseCommand } from '../server/domain.js';
import { seed } from '../server/store.js';

test('draft add and swap preserve unrelated Lexical nodes and are repeatable', () => {
  const { drafts: [post], records: [a, b] } = seed();
  const original = JSON.parse(post.lexical).root.children[0];
  post.lexical = patchDraft(post, a);
  assert.deepEqual(draftRecordIds(post), [a.id]);
  assert.equal(patchDraft(post, a), null);
  post.lexical = patchDraft(post, b, a.id);
  assert.deepEqual(draftRecordIds(post), [b.id]);
  assert.deepEqual(JSON.parse(post.lexical).root.children[0], original);
  assert.equal(patchDraft(post, b, a.id), null);
});
test('published and scheduled posts cannot be changed', () => {
  const { drafts: [post], records: [a] } = seed();
  for (const status of ['published', 'scheduled']) assert.throws(() => patchDraft({ ...post, status }, a), { status: 409 });
});
test('refuse swaps if markers have been removed or merged into other content', () => {
  const { drafts: [post], records: [a, b] } = seed();
  assert.throws(() => patchDraft(post, b, a.id), { status: 409 });
  const doc = JSON.parse(patchDraft(post, a)); doc.root.children.find(n => n.html?.startsWith('<!-- opp:')).html = '<p>Manual text</p>' + doc.root.children.find(n => n.html?.startsWith('<!-- opp:')).html;
  post.lexical = JSON.stringify(doc);
  assert.throws(() => patchDraft(post, b, a.id), { status: 409 });
});
test('HTML cards escape editor text and reject unsafe links', () => {
  const { drafts: [post], records: [a] } = seed();
  const doc = JSON.parse(patchDraft(post, { ...a, title: '<script>alert(1)</script>', summary: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }));
  const html = doc.root.children.at(-1).html;
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script')); assert.ok(!html.includes('<a'));
});
test('validate dates, allowed fields, status values and URLs', () => {
  for (const patch of [{ deadline: '2026-99-99' }, { deadline: '2026-02-30' }, { url: 'javascript:alert(1)' }, { status: 'published' }, { token: 'x' }, { title: '' }]) assert.throws(() => validatePatch(patch), { status: 400 });
  assert.deepEqual(validatePatch({ deadline: '2028-02-29', title: ' A title ' }), { deadline: '2028-02-29', title: 'A title' });
});
test('commands require an unambiguous record and never execute arbitrary instructions', () => {
  const { records } = seed();
  assert.equal(parseCommand('approve Acme', records).status, 'approved');
  assert.throws(() => parseCommand('publish everything', records), { status: 400 });
  assert.throws(() => parseCommand('approve Acme', [...records, { ...records[0], id: 'duplicate' }]), { status: 400 });
});
test('Ghost JWT has expected audience, TTL and header', () => {
  const token = ghostToken('id:' + 'a'.repeat(64), 1000);
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT', kid: 'id' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iat: 1000, exp: 1300, aud: '/admin/' });
  assert.ok(signature.length); assert.throws(() => ghostToken('bad-key'), { status: 503 });
});
