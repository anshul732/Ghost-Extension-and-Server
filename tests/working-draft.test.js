import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {patchDraft,draftOpportunityTitles,revision} from '../server/domain.js';
import {seed} from '../server/store.js';
const TOKEN='x'.repeat(32);
// Three Ghost posts: two editors' drafts and one published post.
async function setup(t,config={}){
 const dir=await mkdtemp(join(tmpdir(),'working-draft-'));
 const base=seed().drafts[0];const rows=Object.fromEntries(seed().records.map(r=>[r.id,r]));
 const posts={draftA:{...base,id:'draftA',title:'Issue A'},draftB:{...base,id:'draftB',title:'Issue B'},live:{...base,id:'live',title:'Live',status:'published'}};
 const writes=[];
 const app=await createApp({dataDir:dir,tokens:{editor:TOKEN},...config,adapters:{
  airtable:{async list(){return Object.values(rows).map(r=>({...r,revision:revision(r)}))},async get(id){return {...rows[id],revision:revision(rows[id])}},async update(id,patch){rows[id]={...rows[id],...patch};return rows[id]}},
  ghost:{async list(){return Object.values(posts).filter(p=>p.status==='draft')},async putOpportunity(id,record,remove,options){writes.push({id,resource:options?.resource});const post=posts[id];const next=patchDraft(post,record,remove,options);if(next)post.lexical=next;return post}}
 }});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true})});
 const url=path=>`http://127.0.0.1:${app.server.address().port}/api${path}`;
 const approve=(id,draftId,key=crypto.randomUUID())=>fetch(url(`/opportunities/${id}`),{method:'PATCH',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({fields:{status:'approved'},revision:revision(rows[id]),...(draftId?{draftId}:{})})});
 const session=async()=>(await fetch(url('/session'),{headers:{Authorization:`Bearer ${TOKEN}`}})).json();
 return {rows,posts,writes,approve,session};
}
test('approve adds to the working draft the panel names, with no post ID configured',async t=>{
 const s=await setup(t,{autoAddOnApprove:true});
 assert.equal((await s.session()).autoAdd,true);
 assert.equal((await s.approve('recAcme','draftB')).status,200);
 assert.equal(s.rows.recAcme.status,'approved');
 assert.deepEqual(draftOpportunityTitles(s.posts.draftB),['Creative futures fellowship']);
 assert.deepEqual(draftOpportunityTitles(s.posts.draftA),[]);
 assert.deepEqual(s.writes,[{id:'draftB',resource:'posts'}]);
});
test('approve without a chosen draft or fallback post is refused before anything changes',async t=>{
 const s=await setup(t,{autoAddOnApprove:true});
 const res=await s.approve('recAcme');assert.equal(res.status,400);assert.match((await res.json()).error,/choose it/);
 assert.equal(s.rows.recAcme.status,'pending');assert.equal(s.writes.length,0);
});
test('a panel-chosen post must be a draft; only the configured post may be published',async t=>{
 const s=await setup(t,{autoAddOnApprove:true});
 assert.equal((await s.approve('recAcme','live')).status,409);
 assert.equal(s.rows.recAcme.status,'pending');assert.deepEqual(draftOpportunityTitles(s.posts.live),[]);
 const fixed=await setup(t,{approvalPostId:'live'});
 assert.equal((await fixed.approve('recAcme')).status,200);
 assert.deepEqual(draftOpportunityTitles(fixed.posts.live),['Creative futures fellowship']);
});
test('the configured post is only the fallback when the panel names a draft',async t=>{
 const s=await setup(t,{approvalPostId:'draftA'});
 assert.equal((await s.session()).autoAdd,true);
 assert.equal((await s.approve('recAcme','draftB')).status,200);
 assert.deepEqual(draftOpportunityTitles(s.posts.draftB),['Creative futures fellowship']);
 assert.deepEqual(draftOpportunityTitles(s.posts.draftA),[]);
 assert.equal((await s.approve('recGlobex')).status,200);
 assert.deepEqual(draftOpportunityTitles(s.posts.draftA),['Stories that move us']);
});
test('retrying the same approval does not duplicate, and cannot be redirected',async t=>{
 const s=await setup(t,{autoAddOnApprove:true});
 assert.equal((await s.approve('recAcme','draftB','retry-request-key-1')).status,200);
 s.rows.recAcme.status='pending';
 assert.equal((await s.approve('recAcme','draftB','retry-request-key-1')).status,200);
 assert.deepEqual(draftOpportunityTitles(s.posts.draftB),['Creative futures fellowship']);
 assert.equal((await s.approve('recAcme','draftA','retry-request-key-1')).status,409);
});
test('without auto-add, approve only updates Airtable even if a draft is named',async t=>{
 const s=await setup(t);
 assert.equal((await s.session()).autoAdd,false);
 assert.equal((await s.approve('recAcme','draftB')).status,200);
 assert.equal(s.rows.recAcme.status,'approved');assert.equal(s.writes.length,0);
});
