import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore,replayQueue } from '../client/core.js';
import { recordEvent } from '../client/event-mutations.js';
import { withPendingEvents } from '../client/planning.js';
import { diagnosticsSnapshot,installDiagnostics } from '../client/diagnostics.js';
import { conflictGroup,conflictFingerprint,discardConflict,retryConflict } from '../client/conflicts.js';
import { PersistentPorterService } from '../src/persistent-service.js';
import { dispatchClientMutation } from '../client-api/server.mjs';
import { MemoryRepository } from './helpers/repository.js';

async function setup(){
 const service=new PersistentPorterService(new MemoryRepository(),'owner'),trip=await service.createTrip({title:'Disposable conflict'}),event=await service.createEvent(trip.id,{title:'Original'}),store=new MemoryStore();
 const packet=await service.tripContext(trip.id);await store.putPacket(trip.id,{packet,meta:{usable:true}});await store.setActiveTrip(trip.id);
 const api={mutate:async m=>{try{return await dispatchClientMutation(service,m);}catch(e){if(e.name==='ConflictError')e.code='revision_conflict';throw e;}}};
 const record=await recordEvent(store,{operation:'updateEvent',arguments:{tripId:trip.id,eventId:event.id,expectedRevision:event.revision,patch:{title:'Private local title'}}},event);
 await service.updateEvent(event.id,{title:'Current server title'},event.revision);await replayQueue(store,api);
 return {service,trip,event,store,api,record,packet:await service.tripContext(trip.id)};
}
const snapshot=(store,packet)=>diagnosticsSnapshot({store,packet,revision:'test',online:true});
test('revision conflict survives restart, remains projected and diagnostics identify it without payload/error secrets',async()=>{
 const x=await setup();const rows=await x.store.allMutations();rows[0].error='Bearer SECRET ticket-bytes auth_token';rows[0].arguments.patch.artifacts=[{data:'SECRET-ARTIFACT'}];
 const store=new MemoryStore({mutations:rows});await store.putPacket(x.trip.id,{packet:x.packet,meta:{usable:true}});await store.setActiveTrip(x.trip.id);
 let calls=0;await replayQueue(store,{mutate:()=>{calls++;}});assert.equal(calls,0);
 const data=await snapshot(store,x.packet),m=data.mutations[0];assert.equal(data.conflicts,1);assert.equal(m.id,x.record.id);assert.equal(m.operation,'updateEvent');assert.equal(m.eventId,x.event.id);assert.equal(m.tripId,x.trip.id);assert.equal(m.expectedRevision,1);assert.equal(m.currentRevision,2);assert.equal(m.projected,true);assert.equal(m.errorCode,'revision_conflict');assert.ok(m.createdAt);assert.ok(m.updatedAt);
 for(const privateValue of ['SECRET','Private local title','Current server title','artifacts','auth_token'])assert.ok(!JSON.stringify(data.mutations).includes(privateValue));
 assert.equal(withPendingEvents(x.packet,rows).events[x.event.id].title,'Private local title');
});
test('deliberate discard atomically removes conflict and dependent projections; server wins across restart',async()=>{
 const x=await setup(),local=withPendingEvents(x.packet,await x.store.allMutations()).events[x.event.id];
 const child=await recordEvent(x.store,{operation:'updateEvent',arguments:{tripId:x.trip.id,eventId:local.id,expectedRevision:local.revision,patch:{title:'Second local edit'}}},local);
 const group=conflictGroup(await x.store.allMutations(),x.record.id);assert.equal(group.length,2);
 assert.equal(conflictFingerprint(conflictGroup((await x.store.allMutations()).reverse(),x.record.id)),conflictFingerprint(group));
 await discardConflict(x.store,x.record.id,conflictFingerprint(group));const restored=new MemoryStore({mutations:await x.store.allMutations()});
 assert.equal((await restored.pending()).length,0);assert.equal(withPendingEvents(x.packet,await restored.allMutations()).events[x.event.id].title,'Current server title');assert.equal((await snapshot(restored,x.packet)).conflicts,0);assert.ok(!(await restored.allMutations()).some(m=>m.id===child.id));
 await replayQueue(restored,x.api);assert.equal((await x.service.getEvent(x.event.id)).revision,2);
});
test('discard refuses edits that changed since confirmation and storage failure never claims success',async()=>{
 const x=await setup(),before=conflictFingerprint(conflictGroup(await x.store.allMutations(),x.record.id));
 await x.store.changeQueue(rows=>{rows[0].updatedAt='2030-01-01T00:00:00.000Z';});await assert.rejects(discardConflict(x.store,x.record.id,before),/changed/);assert.equal((await x.store.pending()).length,1);
 await assert.rejects(discardConflict({changeQueue:async()=>{throw new Error('disk full');}},x.record.id,before),/disk full/);
});
test('retry preserves ID and stale revision; deliberate re-edit from fresh state still conflicts with a newer server edit',async()=>{
 const x=await setup(),group=conflictGroup(await x.store.allMutations(),x.record.id),retry=await retryConflict(x.store,x.record.id,conflictFingerprint(group));
 assert.deepEqual(retry.arguments,x.record.arguments);assert.equal(retry.id,x.record.id);await replayQueue(x.store,x.api);assert.equal((await x.store.pending())[0].state,'conflict');assert.equal((await x.service.getEvent(x.event.id)).title,'Current server title');
 await discardConflict(x.store,x.record.id,conflictFingerprint(conflictGroup(await x.store.allMutations(),x.record.id)));
 const fresh=await x.service.getEvent(x.event.id);await recordEvent(x.store,{operation:'updateEvent',arguments:{tripId:x.trip.id,eventId:fresh.id,expectedRevision:fresh.revision,patch:{title:'Reviewed local edit'}}},fresh);
 await x.service.updateEvent(fresh.id,{title:'Newer again'},fresh.revision);await replayQueue(x.store,x.api);assert.equal((await x.store.pending())[0].state,'conflict');assert.equal((await x.service.getEvent(fresh.id)).title,'Newer again');
});
test('conflicts block same target/dependencies but unrelated durable offline work synchronizes',async()=>{
 const x=await setup();await x.store.enqueue({operation:'updateEvent',arguments:{tripId:x.trip.id,eventId:x.event.id,expectedRevision:1,patch:{title:'Unsafe sibling'}}});
 await recordEvent(x.store,{operation:'createEvent',arguments:{tripId:x.trip.id,event:{title:'Unrelated offline Event'}}});await x.store.enqueue({operation:'createKnowledge',arguments:{tripId:x.trip.id,knowledge:{title:'Independent',content:'Unrelated offline knowledge'}}});
 const restored=new MemoryStore({mutations:await x.store.allMutations()});await replayQueue(restored,x.api);assert.equal((await restored.pending()).length,2);
 assert.ok((await x.service.listEvents(x.trip.id)).some(e=>e.title==='Unrelated offline Event'));assert.ok((await x.service.listKnowledge(x.trip.id)).some(k=>k.content==='Unrelated offline knowledge'));assert.equal((await x.service.getEvent(x.event.id)).title,'Current server title');
});
test('legacy conflicts have safe unknown timestamps and cross-Trip diagnostics without leaking raw arguments',async()=>{
 const x=await setup();await x.store.enqueue({id:'legacy',operation:'updateKnowledge',state:'conflict',error:'SECRET',arguments:{tripId:'another-trip',knowledgeId:'knowledge',expectedRevision:3,patch:{content:'PRIVATE'}}});
 await x.store.changeQueue(rows=>{const m=rows.find(x=>x.id==='legacy');delete m.createdAt;delete m.updatedAt;});const data=await snapshot(x.store,x.packet),legacy=data.mutations.find(m=>m.id==='legacy');
 assert.equal(legacy.createdAt,null);assert.equal(legacy.knowledgeId,'knowledge');assert.equal(legacy.projected,false);assert.equal(data.conflicts,1);assert.equal(data.mutations.length,2);assert.ok(!JSON.stringify(data).includes('SECRET'));assert.ok(!JSON.stringify(data).includes('PRIVATE'));
});
test('diagnostics refresh signals completion, ignores older results and Copy awaits its own safe snapshot',async t=>{
 const descriptors={document:Object.getOwnPropertyDescriptor(globalThis,'document'),navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
 t.after(()=>{for(const [key,value] of Object.entries(descriptors))if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
 const pre={textContent:''},refresh={},copy={},panel={dataset:{},querySelector:s=>s==='pre'?pre:s==='[data-refresh]'?refresh:copy,addEventListener:()=>{}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>panel,body:{append:()=>{}}}});let copied;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>copied=value}}});
 const replies=[];installDiagnostics(()=>new Promise((resolve,reject)=>replies.push({resolve,reject})));
 const older=refresh.onclick(),newer=refresh.onclick();assert.equal(panel.dataset.state,'loading');replies[1].resolve({conflicts:0});await newer;assert.equal(panel.dataset.state,'ready');replies[0].resolve({conflicts:1});await older;assert.equal(JSON.parse(pre.textContent).conflicts,0);
 const copying=copy.onclick();assert.equal(copied,undefined);replies[2].resolve({conflicts:2});await copying;assert.equal(JSON.parse(copied).conflicts,2);
 const failed=refresh.onclick();replies[3].reject(new Error('SECRET'));await failed;assert.equal(panel.dataset.state,'error');assert.ok(!pre.textContent.includes('SECRET'));
});
