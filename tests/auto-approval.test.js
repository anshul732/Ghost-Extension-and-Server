import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {patchDraft,draftOpportunityTitles,revision,HttpError} from '../server/domain.js';
import {seed} from '../server/store.js';
test('approval adds to configured published post before approving Airtable; retries do not duplicate',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'auto-approval-'));
 const initial=seed(); let row=initial.records[0];let post={...initial.drafts[0],status:'published'};let fail=true;let failAir=false;
 const original=JSON.parse(post.lexical).root.children[0];
 const app=await createApp({dataDir:dir,tokens:{editor:'x'.repeat(32)},approvalPostId:post.id,adapters:{
 airtable:{async get(){return {...row,revision:revision(row)}},async update(id,patch){if(failAir){failAir=false;throw new Error('outage')}row={...row,...patch};return row}},
 ghost:{async putOpportunity(id,record,remove,options){if(fail)throw new HttpError(502,'Unavailable');const next=patchDraft(post,record,remove,options);if(next)post.lexical=next;return post}}
 }});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true})});
 const request=key=>fetch(`http://127.0.0.1:${app.server.address().port}/api/opportunities/${row.id}`,{method:'PATCH',headers:{Authorization:'Bearer '+'x'.repeat(32),'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({fields:{status:'approved'},revision:revision(row)})});
 assert.equal((await request('approval-request-one')).status,502);assert.equal(row.status,'pending');
 fail=false;failAir=true;assert.equal((await request('approval-request-one')).status,409);assert.equal(row.status,'pending');
 assert.equal((await request('approval-request-one')).status,200);assert.equal(row.status,'approved');
 assert.deepEqual(draftOpportunityTitles(post),[row.title]);const nodes=JSON.parse(post.lexical).root.children;assert.deepEqual(nodes[0],original);
 assert.equal(nodes.filter(n=>n.tag==='h2'&&(n.children||[]).map(c=>c.text).join('')==='Opportunity').length,1);
 assert.equal(nodes.filter(n=>n.type==='html').length,0);
 const tail=JSON.stringify(nodes.slice(-3));assert.ok(tail.includes('Deadline: 2026-10-15'));assert.ok(tail.includes('https://example.com/opportunities'));
 assert.throws(()=>patchDraft({...post,id:'different'},initial.records[1],undefined,{approvalPostId:post.id}),{status:409});
});
