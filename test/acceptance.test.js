import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MemoryRepository } from './helpers/repository.js';
import { PersistentPorterService } from '../src/persistent-service.js';
import { acceptanceData, seedAcceptance } from '../scripts/acceptance-data.mjs';
import { calendarProjection,itineraryProjection } from '../client/planning.js';
import { MemoryStore,replayQueue } from '../client/core.js';
import { activeJourney } from '../client/journey.js';
import { dispatchClientMutation } from '../client-api/server.mjs';

const setup=()=>{
  const blobs=new Map(),storage={bucket:'porter-artifacts',
    async put({tripId,eventId,artifactId,data}){const ref={provider:'supabase-storage',bucket:this.bucket,key:`${tripId}/${eventId}/${artifactId}/original`};assert.ok(!blobs.has(ref.key));blobs.set(ref.key,data);return ref;},
    async exists(ref){return blobs.has(ref.key);},async delete(ref){blobs.delete(ref.key);},
    async checksum(ref){return createHash('sha256').update(blobs.get(ref.key)).digest('hex');}};
  return {storage,service:new PersistentPorterService(new MemoryRepository(),'owner',storage)};
};
test('rich semantic seed is repeatable, rebasable, perspective-rich and artifact-complete',async()=>{
  const {service,storage}=setup(),today='2026-10-05';
  const a=await seedAcceptance(service,storage,{today}),b=await seedAcceptance(service,storage,{today});
  assert.equal(a.tripId,b.tripId);assert.equal(a.packetRevision,b.packetRevision);assert.equal((await service.listTrips()).length,1);
  assert.deepEqual(a.dateRange,['2026-09-25','2026-10-15']);assert.ok(a.events>70);assert.equal(a.artifacts,6);
  const packet=await service.tripContext(a.tripId,{now:'2026-10-05T12:00:00Z'});
  assert.equal(packet.current.accommodation.length,1);assert.equal(packet.current.hire.length,1);
  assert.ok(packet.current.past.length>20);assert.ok(packet.current.later.length>20);
  assert.notEqual(packet.current.next,a.edgeCases.optional);assert.notEqual(packet.current.next,a.edgeCases.cancelled);
  assert.equal(calendarProjection(packet).days.length,21);assert.equal(itineraryProjection(packet).unscheduled.length,3);
  assert.ok(calendarProjection(packet).days.flatMap(x=>x.blocks).some(x=>x.lanes>1));
  assert.equal(packet.artifactManifest.length,6);assert.ok(packet.artifactManifest.every(a=>a.checksum&&a.offlineRequired));
  assert.equal(packet.access.filter(x=>x.eventId===a.edgeCases['family-tickets']&&x.artifactIds.length).length,3);
  assert.equal(packet.access.filter(x=>x.eventId===a.edgeCases['missing-ticket']&&!x.artifactIds.length).length,1);
  assert.ok(packet.access.filter(x=>x.eventId===a.edgeCases['dynamic-ticket']).every(x=>x.status==='external_dynamic'));
  const wes=await service.tripContext(a.tripId,{perspectiveParticipantId:'wes'}),skye=await service.tripContext(a.tripId,{perspectiveParticipantId:'skye'});
  assert.notDeepEqual(Object.keys(wes.events),Object.keys(skye.events));
  const c=await seedAcceptance(service,storage,{today:'2026-10-06'});assert.equal(c.tripId,a.tripId);assert.deepEqual(c.edgeCases,a.edgeCases);assert.equal((await service.listEvents(a.tripId)).length,a.events);
});
test('seed plan is deterministic and invalid dates are rejected',()=>{
  assert.deepEqual(acceptanceData('2026-10-05'),acceptanceData('2026-10-05'));
  assert.throws(()=>acceptanceData('2026-02-31'));
});
test('seed safely resumes an orphaned upload and never adopts an unmarked Trip',async()=>{
  const {service,storage}=setup(),upload=service.storeArtifact.bind(service);let interrupted=true;
  service.storeArtifact=async(eventId,input,revision)=>{
    if(interrupted){interrupted=false;const event=await service.getEvent(eventId);await storage.put({tripId:event.tripId,eventId,artifactId:input.id,data:input.data});throw new Error('Connection lost after upload');}
    return upload(eventId,input,revision);
  };
  await assert.rejects(seedAcceptance(service,storage,{today:'2026-10-05'}),/Connection lost/);
  const result=await seedAcceptance(service,storage,{today:'2026-10-05'});
  assert.equal((await service.listTrips()).length,1);assert.equal((await service.tripContext(result.tripId)).artifactManifest.length,6);
  const other=setup();await other.service.createTrip({title:'Porter V0 Acceptance Journey'});
  await assert.rejects(seedAcceptance(other.service,other.storage,{today:'2026-10-05'}),/refusing/);
  assert.equal((await other.service.listTrips()).length,1);
});
test('parking create → offline restart → clear → restart → sync is ordered and idempotent',async()=>{
  const {service}=setup(),trip=await service.createTrip({title:'Parking'}),packet=await service.tripContext(trip.id);
  const knowledge={title:'Current parking',content:'Bay C12',tags:['parking','current'],sources:[{type:'porter-parking-capture',id:'capture-a'}]};
  const store=new MemoryStore();await store.enqueue({id:'z-create',operation:'setCurrentParking',arguments:{tripId:trip.id,knowledge}});
  const restart=new MemoryStore({mutations:await store.pending()});assert.equal(activeJourney(packet,{pendingMutations:await restart.pending()}).current.parking.length,1);
  await restart.enqueue({id:'a-clear',operation:'clearCurrentParking',arguments:{tripId:trip.id,captureId:'capture-a'}});
  const restartAgain=new MemoryStore({mutations:await restart.pending()});assert.equal(activeJourney(packet,{pendingMutations:await restartAgain.pending()}).current.parking.length,0);
  const api={mutate:m=>dispatchClientMutation(service,m)};await replayQueue(restartAgain,api);
  assert.equal((await restartAgain.pending()).length,0);assert.equal((await service.tripContext(trip.id)).current.parkingKnowledge.length,0);
  await service.setCurrentParking(trip.id,knowledge);assert.equal((await service.tripContext(trip.id)).current.parkingKnowledge.length,0);
  const newer=await service.setCurrentParking(trip.id,{...knowledge,sources:[{type:'porter-parking-capture',id:'capture-b'}]});
  await service.clearCurrentParking(trip.id,{captureId:'capture-a'});await service.clearCurrentParking(trip.id,{captureId:'capture-a'});
  assert.deepEqual((await service.tripContext(trip.id)).current.parkingKnowledge,[newer.id]);
  await assert.rejects(new PersistentPorterService(service.repository,'other').clearCurrentParking(trip.id,{knowledgeId:newer.id}));
});
test('a failed parking capture blocks its dependent clear; acknowledgement preserves new queued work',async()=>{
  const store=new MemoryStore();await store.enqueue({id:'z',operation:'setCurrentParking'});await store.enqueue({id:'a',operation:'clearCurrentParking'});
  const calls=[];await replayQueue(store,{mutate:async m=>{calls.push(m.id);throw new Error('offline');}});assert.deepEqual(calls,['z']);assert.equal((await store.pending()).length,2);
  await replayQueue(store,{mutate:async m=>{if(m.id==='z')await store.enqueue({id:'new',operation:'setCurrentParking'});}});assert.deepEqual((await store.pending()).map(x=>x.id),['new']);
});
