import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore,IndexedDbStore,replayQueue} from '../client/core.js';
import {captureKnowledge,editKnowledge,associateKnowledge,localKnowledge,cacheKnowledge,cacheAssociation,KnowledgeSession,beginKnowledgeQuery,cacheKnowledgePage,localKnowledgeQuery,evictKnowledge,openKnowledge,resolveKnowledgeConflict,resolveAssociationConflict} from '../client/knowledge-sync.js';
import {PersistentPorterService} from '../src/persistent-service.js';
import {MemoryRepository} from './helpers/repository.js';
import {dispatchClientMutation,createClientApi} from '../client-api/server.mjs';
import {ConflictError} from '../src/domain.js';
const owner='55555555-5555-4555-8555-555555555555';
async function setup(store){const repo=new MemoryRepository(),service=new PersistentPorterService(repo,owner),session=new KnowledgeSession(owner),api={identity:async()=>({ownerId:owner}),mutate:async m=>{try{return await dispatchClientMutation(service,m);}catch(e){e.code=e instanceof ConflictError?'revision_conflict':e instanceof TypeError?'invalid_semantic_input':'not_found';throw e;}},get:id=>service.getKnowledge(id),association:(trip,id)=>service.ideaState(trip,id)};return {store,repo,service,session,api};}
const queued=(store)=>store.allMutations();

for(const kind of ['memory','indexedDB'])test(`${kind}: offline capture/edit, atomic restart and ordered association replay`,async()=>{
 const name='porter-knowledge-'+randomUUID(),store=kind==='memory'?new MemoryStore():new IndexedDbStore(name),x=await setup(store),trip=await x.service.createTrip({title:'LA'});
 const created=await captureKnowledge(store,owner,{title:'Museum',planning:{primaryUrl:'https://example.com'},content:''});
 const first=await localKnowledge(store,owner,created.knowledgeId);await editKnowledge(store,owner,created.knowledgeId,{content:'Offline draft'},first.generation);
 let draft=await localKnowledge(store,owner,created.knowledgeId);await associateKnowledge(store,owner,created.knowledgeId,trip.id,true,draft.generation);
 const before=await queued(store),restarted=kind==='memory'?new MemoryStore({knowledge:[...store.knowledge],knowledgeQueries:[...store.knowledgeQueries],mutations:before}):new IndexedDbStore(name);
 assert.equal((await localKnowledge(restarted,owner,created.knowledgeId)).content,'Offline draft');
 assert.equal(x.repo.knowledge.size,0);const sent=[],api={...x.api,mutate:async m=>{sent.push(m.operation);return x.api.mutate(m);}};
 await replayQueue(restarted,api,x.session);assert.deepEqual(sent,['captureGlobalKnowledge','editGlobalKnowledge','setTripIdea']);assert.equal(x.repo.knowledge.size,1);
 assert.equal((await x.service.getKnowledge(created.knowledgeId)).content,'Offline draft');assert.equal((await x.service.ideaState(trip.id,created.knowledgeId)).active,true);
 const after=await queued(restarted);assert.deepEqual(after.map(m=>m.id),before.map(m=>m.id));assert.ok(after.every(m=>m.state==='acknowledged'&&m.reconciled));
 await replayQueue(restarted,api,x.session);assert.equal(sent.length,3);
});
test('ambiguous create/edit successes retry exact identities without duplicate sources or revisions',async()=>{
 const x=await setup(new MemoryStore()),created=await captureKnowledge(x.store,owner,{title:'Walk'});let lose=true;
 const api={...x.api,mutate:async m=>{const result=await x.api.mutate(m);if(lose){lose=false;throw Error('Response lost');}return result;}};
 await replayQueue(x.store,api,x.session);assert.equal(x.repo.knowledge.size,1);assert.equal((await queued(x.store))[0].state,'pending');
 await replayQueue(x.store,api,x.session);let current=await localKnowledge(x.store,owner,created.knowledgeId);await editKnowledge(x.store,owner,current.id,{title:'Long walk'},current.generation);lose=true;
 await replayQueue(x.store,api,x.session);await replayQueue(x.store,api,x.session);assert.equal((await x.service.getKnowledge(current.id)).revision,2);assert.equal(x.repo.knowledge.size,1);
});
test('acknowledgement survives failed reconciliation and refresh is retried without another write',async()=>{
 const x=await setup(new MemoryStore()),c=await captureKnowledge(x.store,owner,{title:'Walk'});let writes=0,fail=true;
 const api={...x.api,mutate:async m=>{writes++;return x.api.mutate(m);},get:async id=>{if(fail)throw Error('Offline');return x.api.get(id);}};
 await replayQueue(x.store,api,x.session);assert.equal((await queued(x.store))[0].state,'acknowledged');assert.equal((await localKnowledge(x.store,owner,c.knowledgeId)).title,'Walk');
 fail=false;await replayQueue(x.store,api,x.session);assert.equal(writes,1);assert.equal((await queued(x.store))[0].reconciled,true);
});
test('concurrent revision conflict retains drafts and explicit rebase uses a new receipt identity',async()=>{
 const x=await setup(new MemoryStore()),source=await x.service.createKnowledge({title:'Original',sources:[{url:'https://original'}]});await cacheKnowledge(x.store,owner,source);
 let local=await localKnowledge(x.store,owner,source.id);const edit=await editKnowledge(x.store,owner,source.id,{title:'My draft'},local.generation);
 await x.service.updateKnowledge(source.id,{title:'Remote edit'},1);await replayQueue(x.store,x.api,x.session);
 local=await localKnowledge(x.store,owner,source.id);assert.equal(local.title,'My draft');assert.equal(local.conflicts[0].id,edit.id);
 await cacheKnowledge(x.store,owner,await x.api.get(source.id));local=await localKnowledge(x.store,owner,source.id);const rebased=await resolveKnowledgeConflict(x.store,owner,edit.id,{generation:local.generation,choice:'rebase',patch:{title:local.title}});
 assert.notEqual(rebased.id,edit.id);await replayQueue(x.store,x.api,x.session);assert.equal((await x.api.get(source.id)).title,'My draft');assert.deepEqual((await x.api.get(source.id)).sources,source.sources);
});
test('authentication changes pause and owner partitions never replay into another account',async()=>{
 const x=await setup(new IndexedDbStore('porter-owner-'+randomUUID())),c=await captureKnowledge(x.store,owner,{title:'Private'});let writes=0;
 const api={...x.api,identity:async()=>({ownerId:'foreign'}),mutate:async m=>{writes++;return x.api.mutate(m);}};
 await replayQueue(x.store,api,x.session);assert.equal(writes,0);x.session.setOwner('foreign');await replayQueue(x.store,x.api,x.session);assert.equal(writes,0);
 assert.equal(await localKnowledge(x.store,'foreign',c.knowledgeId),null);assert.equal((await localKnowledge(x.store,owner,c.knowledgeId)).title,'Private');
 x.session.setOwner(null);await replayQueue(x.store,x.api,x.session);assert.equal(x.repo.knowledge.size,0);
 x.session.setOwner(owner);await replayQueue(x.store,x.api,x.session);assert.equal(x.repo.knowledge.size,1);
});
test('logout during an in-flight success stores ack in original partition without fetching/adopting another owner',async()=>{
 const x=await setup(new MemoryStore()),c=await captureKnowledge(x.store,owner,{title:'Draft'});let reads=0;
 const api={...x.api,mutate:async m=>{const result=await x.api.mutate(m);x.session.setOwner(null);return result;},get:async id=>{reads++;return x.api.get(id);}};
 await replayQueue(x.store,api,x.session);assert.equal(reads,0);assert.equal((await queued(x.store))[0].state,'acknowledged');assert.equal(await localKnowledge(x.store,'foreign',c.knowledgeId),null);
 x.session.setOwner(owner);await replayQueue(x.store,x.api,x.session);assert.equal((await queued(x.store))[0].reconciled,true);
});
test('newer local edits overlay late source responses; older revisions and stale query responses are ignored',async()=>{
 const x=await setup(new MemoryStore()),source=await x.service.createKnowledge({title:'Base'});await cacheKnowledge(x.store,owner,source);const old=await beginKnowledgeQuery(x.store,owner),newer=await beginKnowledgeQuery(x.store,owner);
 assert.equal(await cacheKnowledgePage(x.store,owner,old,{items:[source],nextCursor:null}),false);
 await cacheKnowledgePage(x.store,owner,newer,{items:[source],nextCursor:null});assert.equal((await localKnowledgeQuery(x.store,owner)).complete,true);
 const current=await localKnowledge(x.store,owner,source.id);await editKnowledge(x.store,owner,source.id,{title:'New local'},current.generation);
 await cacheKnowledge(x.store,owner,{...source,title:'Late remote'});assert.equal((await localKnowledge(x.store,owner,source.id)).title,'New local');assert.equal((await localKnowledgeQuery(x.store,owner)).complete,false);
 await cacheKnowledge(x.store,owner,{...source,title:'v3',revision:3});await cacheKnowledge(x.store,owner,{...source,title:'old',revision:2});const row=await x.store.knowledgeTransaction(owner,s=>s.knowledge[0]);assert.equal(row.source.title,'v3');
});
test('pending/conflicted records resist eviction and page absence never deletes selected sources',async()=>{
 const x=await setup(new MemoryStore()),source=await x.service.createKnowledge({title:'Selected'});await cacheKnowledge(x.store,owner,source,{pin:true});const c=await captureKnowledge(x.store,owner,{title:'Pending'}),ticket=await beginKnowledgeQuery(x.store,owner);
 await cacheKnowledgePage(x.store,owner,ticket,{items:[],nextCursor:null});await evictKnowledge(x.store,owner,0);assert.ok(await localKnowledge(x.store,owner,source.id));assert.ok(await localKnowledge(x.store,owner,c.knowledgeId));
});
test('Trip deletion cannot silently discard global drafts or queued planning mutations',async()=>{
 const x=await setup(new MemoryStore()),trip=await x.service.createTrip({title:'LA'}),c=await captureKnowledge(x.store,owner,{title:'Keep'});let row=await localKnowledge(x.store,owner,c.knowledgeId);await associateKnowledge(x.store,owner,c.knowledgeId,trip.id,true,row.generation);await x.store.removeTrip(trip.id);
 assert.equal((await queued(x.store)).length,2);assert.ok(await localKnowledge(x.store,owner,c.knowledgeId));
});
test('opened Knowledge returns immediate local data even when refresh cannot complete',async()=>{
 const x=await setup(new MemoryStore()),source=await x.service.createKnowledge({title:'Local'});await cacheKnowledge(x.store,owner,source);let release;const api={...x.api,identity:()=>new Promise(r=>release=r)};
 const opened=await openKnowledge(x.store,api,x.session,source.id);assert.equal(opened.local.title,'Local');x.session.setOwner(null);release({ownerId:owner});assert.equal(await opened.refresh,null);
});
test('editable allowlist rejects provenance, reverse references and operational/identity fields',async()=>{
 const x=await setup(new MemoryStore()),source=await x.service.createKnowledge({title:'Protected'});await cacheKnowledge(x.store,owner,source);const row=await localKnowledge(x.store,owner,source.id);
 for(const field of ['ownerId','id','tripId','sources','locations','relatedEventIds','participantIds','validityWindows','revision'])await assert.rejects(editKnowledge(x.store,owner,source.id,{[field]:[]},row.generation),TypeError);
});
test('HTTP owner guards block cross-account queued capture and reads',async()=>{
 const x=await setup(new MemoryStore()),app=createClientApi(async()=>({service:x.service}),{host:'127.0.0.1'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer test','Content-Type':'application/json'};
 try{const response=await fetch(base+'/client/mutate',{method:'POST',headers,body:JSON.stringify({operation:'captureGlobalKnowledge',ownerId:'foreign',arguments:{knowledgeId:randomUUID(),mutationId:randomUUID(),knowledge:{title:'Blocked'}}})});assert.equal(response.status,401);assert.equal(x.repo.knowledge.size,0);assert.equal((await fetch(base+'/client/identity',{headers:{...headers,'X-Porter-Owner':'foreign'}})).status,401);assert.equal((await (await fetch(base+'/client/identity',{headers})).json()).ownerId,owner);}finally{await new Promise(r=>server.close(r));}
});
test('IndexedDB upgrade preserves legacy packets/tickets and atomic transaction failure leaves drafts/queue untouched',async()=>{
 const name='porter-upgrade-'+randomUUID();await new Promise((resolve,reject)=>{const request=indexedDB.open(name,3);request.onupgradeneeded=()=>['packets','artifacts','mutations','settings','tripIndex'].forEach(n=>request.result.createObjectStore(n,{keyPath:'id'}));request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['packets','artifacts'],'readwrite');tx.objectStore('packets').put({id:'legacy',packet:{trip:{id:'legacy'},events:{}},meta:{usable:true}});tx.objectStore('artifacts').put({id:'ticket',tripId:'legacy',data:new Uint8Array([1,2]).buffer});tx.oncomplete=()=>{db.close();resolve();};};});
 const store=new IndexedDbStore(name),c=await captureKnowledge(store,owner,{title:'Keep'});assert.equal((await store.getArtifacts('legacy')).length,1);assert.equal((await store.getPacket('legacy')).meta.usable,true);
 await assert.rejects(store.knowledgeTransaction(owner,state=>{state.knowledge=[];state.mutations=[];throw Error('Abort save');}),/Abort save/);assert.equal((await localKnowledge(store,owner,c.knowledgeId)).title,'Keep');assert.equal((await queued(store)).length,1);
 const row=await localKnowledge(store,owner,c.knowledgeId);await associateKnowledge(store,owner,c.knowledgeId,randomUUID(),true,row.generation);const trip=(await queued(store))[1].arguments.tripId;await store.removeTrip(trip);await store.changeQueue(()=>null);assert.equal((await queued(store)).length,2);
});
test('association retries and conflict resolution retain tombstones and dependent choices',async()=>{
 const x=await setup(new MemoryStore()),trip=await x.service.createTrip({title:'LA'}),source=await x.service.createKnowledge({title:'Walk'});await cacheKnowledge(x.store,owner,source);await cacheAssociation(x.store,owner,source.id,await x.api.association(trip.id,source.id));let row=await localKnowledge(x.store,owner,source.id);
 const add=await associateKnowledge(x.store,owner,source.id,trip.id,true,row.generation);await x.service.setTripIdea({tripId:trip.id,knowledgeId:source.id,active:true,expectedRevision:0,mutationId:randomUUID()});await replayQueue(x.store,x.api,x.session);
 row=await localKnowledge(x.store,owner,source.id);assert.equal(row.conflicts[0].id,add.id);await cacheAssociation(x.store,owner,source.id,await x.api.association(trip.id,source.id));row=await localKnowledge(x.store,owner,source.id);
 await resolveAssociationConflict(x.store,owner,add.id,{generation:row.generation,choice:'rebase',active:false});let lose=true;const api={...x.api,mutate:async m=>{const result=await x.api.mutate(m);if(lose){lose=false;throw Error('Lost response');}return result;}};
 await replayQueue(x.store,api,x.session);await replayQueue(x.store,api,x.session);assert.deepEqual(await x.api.association(trip.id,source.id),{tripId:trip.id,knowledgeId:source.id,active:false,revision:2});
});
test('capture is searchable offline and stale editor generations cannot replace newer local drafts',async()=>{
 const x=await setup(new MemoryStore()),c=await captureKnowledge(x.store,owner,{title:'Pub',tags:['England']});const row=await localKnowledge(x.store,owner,c.knowledgeId);await editKnowledge(x.store,owner,c.knowledgeId,{content:'London'},row.generation);
 await assert.rejects(editKnowledge(x.store,owner,c.knowledgeId,{content:'Stale'},row.generation),/changed locally/);assert.equal((await localKnowledgeQuery(x.store,owner,{tag:'england',query:'London'})).items[0].id,c.knowledgeId);assert.equal((await localKnowledgeQuery(x.store,owner)).complete,false);
});
