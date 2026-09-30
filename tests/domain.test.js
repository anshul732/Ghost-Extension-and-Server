import test from 'node:test';
import assert from 'node:assert/strict';
import { patchDraft, draftOpportunityTitles, opportunityNodes, ghostToken, validatePatch, parseCommand } from '../server/domain.js';
import { seed } from '../server/store.js';

test('draft add and swap preserve unrelated Lexical nodes and are repeatable', () => {
  const { drafts: [post], records: [a, b] } = seed();
  const original = JSON.parse(post.lexical).root.children[0];
  post.lexical = patchDraft(post, a);
  assert.deepEqual(draftOpportunityTitles(post), [a.title]);
  assert.equal(patchDraft(post, a), null);
  post.lexical = patchDraft(post, b, a);
  assert.deepEqual(draftOpportunityTitles(post), [b.title]);
  assert.deepEqual(JSON.parse(post.lexical).root.children[0], original);
  assert.equal(patchDraft(post, b, a), null);
});
test('published and scheduled posts cannot be changed', () => {
  const { drafts: [post], records: [a] } = seed();
  for (const status of ['published', 'scheduled']) assert.throws(() => patchDraft({ ...post, status }, a), { status: 409 });
});
test('refuse swaps when the original title is absent or duplicated', () => {
  const { drafts: [post], records: [a, b] } = seed();
  assert.throws(() => patchDraft(post, b, a), { status: 409 });
  const doc = JSON.parse(patchDraft(post, a));
  doc.root.children.push(...opportunityNodes(a));
  post.lexical = JSON.stringify(doc);
  assert.throws(() => patchDraft(post, b, a), { status: 409 });
});
test('opportunities are plain text nodes, never HTML cards, and drop unsafe links', () => {
  const { drafts: [post], records: [a] } = seed();
  const doc = JSON.parse(patchDraft(post, { ...a, title: '<script>alert(1)</script>', summary: 'Plain summary.', url: 'javascript:alert(1)' }));
  const added = doc.root.children.slice(-3);
  assert.equal(added.filter(n => n.type === 'html').length, 0);
  assert.deepEqual(added.map(n => n.type), ['heading', 'paragraph', 'paragraph']);
  // The title is carried verbatim as text, so it is never parsed as markup.
  assert.equal(added[0].children[0].text, '<script>alert(1)</script>');
  assert.equal(JSON.stringify(added).includes('"type":"link"'), false);
});
test('editor paragraphs added inside a block survive a swap', () => {
  const { drafts: [post], records: [a, b] } = seed();
  const doc = JSON.parse(patchDraft(post, a));
  doc.root.children.push({ type: 'paragraph', version: 1, children: [{ type: 'extended-text', version: 1, text: 'Editor note' }] });
  post.lexical = JSON.stringify(doc);
  post.lexical = patchDraft(post, b, a);
  const text = JSON.stringify(JSON.parse(post.lexical).root.children);
  assert.ok(text.includes(b.title));
  assert.ok(!text.includes(a.title));
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
