import test from 'node:test';
import assert from 'node:assert/strict';
import {latestReview,statusLabel} from '../extension/review.js';
import {airtableAdapter} from '../server/adapters.js';
test('review shows only newest eight, excluding approved and blank statuses, and replenishes after rejection',()=>{
 const records=Array.from({length:12},(_,i)=>({id:`rec${i}`,status:'pending',createdAt:`2026-09-${String(i+1).padStart(2,'0')}T00:00:00Z`}));
 records.push({id:'approved',status:'approved',createdAt:'2027'},{id:'blank',status:'unknown',createdAt:'2027'});
 assert.deepEqual(latestReview(records).map(r=>r.id),['rec11','rec10','rec9','rec8','rec7','rec6','rec5','rec4']);
 records[11].status='rejected';assert.equal(latestReview(records)[7].id,'rec3');assert.equal(latestReview(records).length,8);
 assert.equal(statusLabel('rejected'),'Not Approved');
});
test('live rejection writes the exact Airtable select value without unrelated fields',async()=>{
 let row={id:'recLive',createdTime:'2026-09-13T00:00:00Z',fields:{Name:'Real title',Status:'Awaiting Review'}};
 const api=airtableAdapter({base:'base',table:'table',token:'fake',fields:{title:'Name',organization:null},statuses:{pending:'Awaiting Review',approved:'Approved',rejected:'Not Approved'}},async(url,init)=>{
 if(init.method==='PATCH'){assert.deepEqual(JSON.parse(init.body),{fields:{Status:'Not Approved'}});row.fields.Status='Not Approved';}
 return new Response(JSON.stringify(row));
 });
 const before=await api.get('recLive');assert.equal(before.status,'pending');assert.equal(before.title,'Real title');
 assert.equal((await api.update('recLive',{status:'rejected'},before.revision)).status,'rejected');
 row.fields.Status='';assert.equal((await api.get('recLive')).status,'unknown');
});
