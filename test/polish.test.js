import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore,replayQueue,startLocalFirst } from '../client/core.js';
import { recordEvent,undoEvent,retireEventReceipts } from '../client/event-mutations.js';
import { withPendingEvents } from '../client/planning.js';
import { journeyTime } from '../client/journey.js';
import { PersistentPorterService } from '../src/persistent-service.js';
import { dispatchClientMutation } from '../client-api/server.mjs';
import { MemoryRepository } from './helpers/repository.js';
import { activateCurrentWorker,createUpdateController } from '../client/updates.js';
import { InteractionController } from '../client/interaction.js';

const setup=async()=>{const service=new PersistentPorterService(new MemoryRepository(),'owner');const trip=await service.createTrip({title:'Local test'});const event=await service.createEvent(trip.id,{title:'Original',commitment:'confirmed',temporal:{start:'2030-12-10T10:00:00Z',end:'2030-12-10T11:00:00Z',startTimezone:'UTC',endTimezone:'UTC'}});return {service,trip,event,packet:await service.tripContext(trip.id),store:new MemoryStore(),api:{mutate:async m=>{try{return await dispatchClientMutation(service,m);}catch(error){if(error.name==='ConflictError')error.code='revision_conflict';throw error;}}}};};
const edit=(trip,event,patch)=>({operation:'updateEvent',arguments:{tripId:trip.id,eventId:event.id,patch,expectedRevision:event.revision}});

test('Save is durable without any API; unsent create/edit Undo collapses across restart',async()=>{
  const {store,trip,event,packet}=await setup();
  const created=await recordEvent(store,{operation:'createEvent',arguments:{tripId:trip.id,event:{title:'Local'}}});
  let restarted=new MemoryStore({mutations:await store.allMutations()});assert.ok(withPendingEvents(packet,await restarted.allMutations()).events['pending:'+created.id]);
  await undoEvent(restarted,created.id);assert.equal((await restarted.pending()).length,0);
  const edited=await recordEvent(restarted,edit(trip,event,{title:'Edited'}),event);
  restarted=new MemoryStore({mutations:await restarted.allMutations()});assert.equal(withPendingEvents(packet,await restarted.allMutations()).events[event.id].title,'Edited');
  await undoEvent(restarted,edited.id);assert.equal(withPendingEvents(packet,await restarted.allMutations()).events[event.id].title,'Original');
});
test('Save failure never claims success or leaves a draft mutation; validation precedes storage',async()=>{
  const {trip,event}=await setup();let writes=0;const store={changeQueue:()=>{writes++;throw new Error('Quota exceeded');}};
  await assert.rejects(recordEvent(store,edit(trip,event,{title:''}),event),/title/);assert.equal(writes,0);
  await assert.rejects(recordEvent(store,edit(trip,event,{title:'Valid'}),event),/Quota/);assert.equal(writes,1);
});
test('newer local edit survives in-flight acknowledgement and stale packet adoption',async()=>{
  const {store,trip,event,packet,api,service}=await setup();
  await recordEvent(store,edit(trip,event,{title:'First'}),event);
  let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const running=replayQueue(store,{mutate:async m=>{entered();await gate;return api.mutate(m);}});await ready;
  const local=withPendingEvents(packet,await store.allMutations()).events[event.id];
  await recordEvent(store,edit(trip,local,{title:'Second'}),local);release();await running;
  assert.equal(withPendingEvents(packet,await store.allMutations()).events[event.id].title,'Second');
  await replayQueue(store,api);assert.equal((await service.getEvent(event.id)).title,'Second');assert.equal((await service.getEvent(event.id)).revision,3);assert.equal((await store.pending()).length,0);
  assert.equal(withPendingEvents(packet,await store.allMutations()).events[event.id].title,'Second');
});
test('synchronized edit Undo is a durable compensation, preserves remote conflicts',async()=>{
  const {store,trip,event,packet,service,api}=await setup();const saved=await recordEvent(store,edit(trip,event,{title:'Changed'}),event);await replayQueue(store,api);
  await undoEvent(store,saved.id);const restarted=new MemoryStore({mutations:await store.allMutations()});assert.equal(withPendingEvents(packet,await restarted.allMutations()).events[event.id].title,'Original');
  await service.updateEvent(event.id,{title:'Elsewhere'},2);await replayQueue(restarted,api);
  assert.equal((await restarted.pending())[0].state,'conflict');assert.equal((await service.getEvent(event.id)).title,'Elsewhere');
  assert.equal(withPendingEvents(await service.tripContext(trip.id),await restarted.allMutations()).events[event.id].pendingConflict,true);
});
test('in-flight create Undo compensates safely and create retries do not duplicate',async()=>{
  const {store,trip,service,api}=await setup();const saved=await recordEvent(store,{operation:'createEvent',arguments:{tripId:trip.id,event:{title:'New'}}});
  let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const running=replayQueue(store,{mutate:async m=>{entered();await gate;return api.mutate(m);}});await ready;await undoEvent(store,saved.id);release();await running;await replayQueue(store,api);
  const events=await service.listEvents(trip.id);assert.equal(events.filter(x=>x.title==='New').length,1);assert.equal(events.find(x=>x.title==='New').commitment,'cancelled');
  await api.mutate(saved);assert.equal((await service.listEvents(trip.id)).filter(x=>x.title==='New').length,1);
});
test('failed replay remains durable/retryable; receipts retire only after packet acknowledgement and Undo expiry',async()=>{
  const {store,trip,event,api,service,packet}=await setup();const saved=await recordEvent(store,edit(trip,event,{title:'Retry'}),event,100);
  await replayQueue(store,{mutate:async()=>{throw new Error('offline');}});assert.equal((await store.pending())[0].state,'pending');
  await replayQueue(store,api);await retireEventReceipts(store,packet,20000);assert.equal((await store.allMutations()).length,1);
  await retireEventReceipts(store,await service.tripContext(trip.id),200);assert.equal((await store.allMutations()).length,1);
  await retireEventReceipts(store,await service.tripContext(trip.id),20000);assert.equal((await store.allMutations()).length,0);
  await assert.rejects(undoEvent(store,saved.id),/expired/);
});
test('optimistic creates use Journey projection, not only Itinerary overlay',async()=>{
  const {store,trip,packet}=await setup();const m=await recordEvent(store,{operation:'createEvent',arguments:{tripId:trip.id,event:{title:'Sooner',commitment:'confirmed',temporal:{start:'2029-01-01T10:00:00Z'}}}});
  const projected=withPendingEvents(packet,await store.allMutations());assert.equal(projected.current.next,'pending:'+m.id);
});
test('uncached hydration reports real phases, failure and timings; cached render never shows loader',async()=>{
  const {packet}=await setup(),phases=[],store=new MemoryStore();
  const run=await startLocalFirst({store,tripId:packet.trip.id,api:{packet:async()=>packet},render:async()=>{},onHydration:phase=>phases.push(phase)});await run.sync;
  assert.ok(phases.includes('Loading trip'));assert.ok(phases.includes('Preparing offline access'));assert.ok(run.trace.json().measures.first_remote_hydration>=0);
  phases.length=0;const cached=await startLocalFirst({store,tripId:packet.trip.id,api:{packet:async()=>{throw new Error('offline');}},render:async()=>{},onHydration:phase=>phases.push(phase)});await cached.sync;assert.deepEqual(phases,[]);
  const failed=await startLocalFirst({store:new MemoryStore(),tripId:packet.trip.id,api:{packet:async()=>{throw new Error('offline');}},render:async()=>{},onHydration:phase=>phases.push(phase)});await failed.sync;assert.equal(phases.at(-1),'failed');
});
test('Journey times compact same-day local ranges but preserve other dates and travel zones',()=>{
  const event={temporal:{start:'2026-10-05T13:15:00Z',end:'2026-10-05T14:30:00Z',startTimezone:'Europe/London',endTimezone:'Europe/London'}};
  assert.equal(journeyTime(event,{now:'2026-10-05T12:00:00Z'}),'2:15–3:30 PM');
  assert.match(journeyTime(event,{now:'2026-10-04T12:00:00Z'}),/Oct 5, 2026/);
  assert.match(journeyTime({...event,movement:true}),/GMT\+1|BST/);
  assert.match(journeyTime({temporal:{...event.temporal,end:'2026-10-06T14:30:00Z'}}),/Oct 6/);
  assert.match(journeyTime({temporal:{...event.temporal,endTimezone:'Europe/Rome'}}),/GMT\+2|CEST/);
});
test('update re-resolves a detected worker that is already active and reloads only after owner release',async()=>{
  const interactions=new InteractionController(),worker={state:'activated'},identity={revision:'new',buildId:'new-build'};let reloads=0;
  const activate=()=>activateCurrentWorker({getRegistration:async()=>({waiting:null,active:worker}),getController:()=>worker,runningRevision:'old',runningBuild:'old-build',intendedBuild:identity,interactions,message:async()=>identity});
  assert.deepEqual(await activate(),{accepted:true,active:true});
  const update=createUpdateController({interactions,activate,reload:()=>reloads++});update.ready();const owner=interactions.begin('door');await update.request();assert.equal(reloads,0);interactions.release(owner);await update.safe();assert.equal(reloads,1);
});
test('activation response lost during worker transition is recovered from active identity',async()=>{
  const interactions=new InteractionController(),worker={state:'installed'};let waiting=worker;
  const result=await activateCurrentWorker({getRegistration:async()=>({waiting,active:worker}),getController:()=>worker,runningRevision:'old',interactions,message:async(_w,m)=>{if(m.type==='porter-activate'){waiting=null;worker.state='activated';return null;}return {revision:'new',buildId:'new'};}});
  assert.deepEqual(result,{accepted:true,active:true});
});
test('accepted activation completes from worker state without a controllerchange event',async()=>{
  const interactions=new InteractionController(),worker=new EventTarget();worker.state='installed';let waiting=worker;
  const result=await activateCurrentWorker({getRegistration:async()=>({waiting,active:worker}),getController:()=>({state:'activated'}),runningRevision:'old',interactions,message:async(w,m)=>{
    if(m.type==='porter-activate'){setTimeout(()=>{waiting=null;worker.state='activated';worker.dispatchEvent(new Event('statechange'));},0);return {accepted:true};}
    return {revision:w===worker?'new':'old',buildId:w===worker?'new':'old'};
  }});
  assert.deepEqual(result,{accepted:true,active:true});
});
