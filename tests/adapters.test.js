import test from 'node:test';
import assert from 'node:assert/strict';
import { airtableAdapter, ghostAdapter } from '../server/adapters.js';
import { seed } from '../server/store.js';

const response = data => new Response(JSON.stringify(data), { status: 200 });
test('Airtable adapter paginates, maps fields/statuses, checks revisions and PATCHes only edited fields', async () => {
  const calls = []; let stored = { id: 'rec123', fields: { Headline: 'The title', Status: 'To review' } };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'PATCH') { assert.deepEqual(JSON.parse(init.body), { fields: { Status: 'Ready' } }); stored.fields.Status = 'Ready'; return response(stored); }
    if (url.includes('?pageSize=100&offset=')) return response({ records: [] });
    if (url.includes('?pageSize=100')) return response({ records: [stored], offset: 'next page' });
    return response(stored);
  };
  const a = airtableAdapter({ base: 'base', table: 'table', token: 'not-a-real-token', fields: { title: 'Headline' }, statuses: { pending: 'To review', approved: 'Ready' } }, fetcher);
  const [record] = await a.list();
  assert.equal(record.title, 'The title'); assert.equal(record.status, 'pending'); assert.ok(calls[1].url.includes('offset=next%20page'));
  assert.equal((await a.update(record.id, { status: 'approved' }, record.revision)).status, 'approved');
  await assert.rejects(a.update(record.id, { title: 'Stale change' }, record.revision), { status: 409 });
  assert.equal(calls.filter(c => c.init.method === 'PATCH').length, 1);
});
test('Ghost retries a conflict against a fresh document and preserves intervening edits', async () => {
  const { drafts: [post], records: [record] } = seed();
  let gets = 0; let puts = 0;
  const fetcher = async (url, init) => {
    assert.ok(init.headers.Authorization.startsWith('Ghost '));
    if (init.method !== 'PUT') {
      gets++;
      const updated = structuredClone(post); updated.updated_at = `revision-${gets}`;
      if (gets > 1) { const doc = JSON.parse(updated.lexical); doc.root.children[0].children[0].text = 'An editor changed this while we worked.'; updated.lexical = JSON.stringify(doc); }
      return response({ posts: [updated] });
    }
    puts++;
    if (puts === 1) return new Response('{}', { status: 409 });
    const payload = JSON.parse(init.body).posts[0];
    assert.equal(payload.updated_at, 'revision-2');
    assert.ok(payload.lexical.includes('An editor changed this while we worked.'));
    assert.deepEqual(Object.keys(payload).sort(), ['lexical', 'updated_at']);
    return response({ posts: [{ ...post, ...payload }] });
  };
  const ghost = ghostAdapter({ url: 'https://ghost.example', key: 'id:' + 'b'.repeat(64) }, fetcher);
  await ghost.putOpportunity(post.id, record);
  assert.equal(gets, 2); assert.equal(puts, 2);
});

test('approval destination uses the Pages API and pages payload for a Ghost page', async () => {
 const {drafts:[page],records:[record]}=seed();let writes=0;
 const api=ghostAdapter({url:'https://ghost.example',key:'id:'+'b'.repeat(64)},async(url,init)=>{
 assert.ok(url.includes('/admin/pages/'));assert.ok(!url.includes('/admin/posts/'));
 if(init.method==='PUT'){writes++;const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body),['pages']);const kids=JSON.parse(body.pages[0].lexical).root.children;assert.equal(kids.filter(n=>n.type==='html').length,0);assert.ok(kids.some(n=>n.tag==='h2'&&(n.children||[]).map(c=>c.text).join('')==='Opportunity'));assert.ok(kids.some(n=>n.type==='horizontalrule'));return response({pages:[{...page,...body.pages[0]}]});}
 return response({pages:[page]});
 });
 await api.putOpportunity(page.id,record,undefined,{approvalPostId:page.id,resource:'pages'});assert.equal(writes,1);
});
