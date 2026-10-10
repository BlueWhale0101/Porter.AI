import test from 'node:test';
import assert from 'node:assert/strict';
import {newTrip,newKnowledge,revise,ConflictError} from '../src/domain.js';
import {hasTag,validateEndDate} from '../src/knowledge.js';
import {PersistentPorterService} from '../src/persistent-service.js';
import {MemoryRepository} from './helpers/repository.js';
import {tripDeletionPreview,deleteAppTrip,deleteAppEvent,eventDeletionPreview} from '../src/trip-deletion.js';
import {MemoryStore,replayQueue,syncPacket} from '../client/core.js';
import {dispatchClientMutation} from '../client-api/server.mjs';
import {createPorterMcpServer} from '../mcp/server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const setup=async()=>{const repo=new MemoryRepository(),service=new PersistentPorterService(repo,'owner'),trip=await service.createTrip({title:'Trip',endDate:'2026-12-10',knowledgePreloadTag:'Los Angeles'});return {repo,service,trip};};

test('owner-global Knowledge has stable identity/revision/provenance and empty notes; validation dispatch is Knowledge-specific',async()=>{
 const {repo,service}=await setup(),k=await service.createKnowledge({title:'Museum',tags:['LA','la','Museum'],sources:[{url:'https://example.com'}]});
 assert.equal(k.tripId,null);assert.equal(k.ownerId,'owner');assert.equal(k.content,'');assert.deepEqual(k.tags,['LA','Museum']);assert.ok(hasTag(k.tags,'La'));
 const next=await service.updateKnowledge(k.id,{content:'',tags:['ART'],planning:{cost:{amount:0,currency:'USD'},bookingRequired:'unknown',timedAvailability:'no',primaryUrl:'https://example.com/museum'}},1);
 assert.equal(next.id,k.id);assert.equal(next.revision,2);assert.deepEqual(next.sources,k.sources);assert.equal(next.createdAt,k.createdAt);assert.equal(next.planning.cost.amount,0);
 await assert.rejects(service.updateKnowledge(k.id,{title:' '},2),/title/);
 await assert.rejects(service.updateKnowledge(k.id,{ownerId:'other'},2),/immutable/);
 await assert.rejects(new PersistentPorterService(repo,'other').getKnowledge(k.id),/not found/);
 await assert.rejects(new PersistentPorterService(repo,'other').updateKnowledge(k.id,{content:'stolen'},2),/not found/);
 await assert.rejects(service.updateKnowledge(k.id,{content:'stale'},1),ConflictError);
});

test('planning contracts distinguish unknown and free; malformed planning/tags/media are not accepted as domain fields',()=>{
 const unknown=newKnowledge({title:'Freeform'},'owner');assert.deepEqual(unknown.planning,{});
 for(const planning of [{cost:{amount:-1,currency:'USD'}},{cost:{amount:Infinity,currency:'USD'}},{cost:{amount:10}},{bookingRequired:true},{timedAvailability:'maybe'},{primaryUrl:'javascript:alert(1)'},{primaryUrl:'https://user:secret@example.com'},{artifacts:[]}])assert.throws(()=>newKnowledge({title:'Invalid',planning},'owner'));
 assert.throws(()=>newKnowledge({title:'Tags',tags:['']},'owner'));assert.throws(()=>newKnowledge({title:'Notes',content:3},'owner'));
 assert.equal('artifacts' in newKnowledge({title:'No uploads',artifacts:[]},'owner'),false);
});

test('Trip endDate is an optional inclusive floating local date, never an Event-derived instant; preload hint is untyped text',()=>{
 for(const value of ['2026-02-30','2026-12-10T00:00:00Z','12/10/2026','0000-01-01'])assert.throws(()=>validateEndDate(value));
 for(const value of [null,'2028-02-29','2026-12-10'])validateEndDate(value);
 const t=newTrip({title:'Trip',endDate:'2026-12-10',knowledgePreloadTag:'  LA  '},'owner');assert.equal(t.endDate,'2026-12-10');assert.equal(t.knowledgePreloadTag,'LA');
 assert.equal(revise(t,{endDate:null,knowledgePreloadTag:null},1).endDate,null);assert.throws(()=>revise(t,{endDate:'2026-02-31'},1));
 assert.equal(newTrip({title:'No inferred date'},'owner').endDate,null);
});

test('Event reference contract is authoritative, derived reverse links cross Trips, owner isolation and stale edits remain safe',async()=>{
 const {repo,service,trip}=await setup(),k=await service.createKnowledge({title:'Shared museum'}),otherTrip=await service.createTrip({title:'Other'});
 const first=await service.createEvent(trip.id,{title:'Visit',knowledgeIds:[k.id,k.id]}),second=await service.createEvent(otherTrip.id,{title:'Revisit',knowledgeIds:[k.id]});
 assert.deepEqual(first.knowledgeIds,[k.id]);assert.deepEqual(new Set((await service.getKnowledge(k.id)).relatedEventIds),new Set([first.id,second.id]));
 const next=await service.updateEvent(first.id,{knowledgeIds:[]},first.revision);assert.equal(next.revision,first.revision+1);assert.deepEqual((await service.getKnowledge(k.id)).relatedEventIds,[second.id]);
 await assert.rejects(service.updateEvent(first.id,{knowledgeIds:[k.id]},first.revision),ConflictError);
 const intruder=new PersistentPorterService(repo,'intruder'),theirTrip=await intruder.createTrip({title:'Other owner'});
 await assert.rejects(intruder.createEvent(theirTrip.id,{title:'Leak',knowledgeIds:[k.id]}),/not found/);
 await assert.rejects(service.createEvent(trip.id,{title:'Dangling',knowledgeIds:['missing']}),/not found/);
 await assert.rejects(service.updateKnowledge(k.id,{relatedEventIds:[]},k.revision),/edited on Events/);
 assert.equal((await service.getKnowledge(k.id)).revision,1);
});

test('Trip copy shares Knowledge IDs while preserving contextual perspective, parking, accommodation and hire',async()=>{
 const {repo,service,trip}=await setup(),now='2026-12-05T12:00:00Z',temporal={start:'2026-12-01T00:00:00Z',end:'2026-12-10T00:00:00Z'};
 const hotel=await service.createEvent(trip.id,{title:'Stay',accommodation:true,temporal}),car=await service.createEvent(trip.id,{title:'Hire',hire:true,temporal});
 const note=await service.createKnowledge(trip.id,{title:'Room',content:'814',participantIds:['wes'],relatedEventIds:[hotel.id,car.id],sources:[{url:'https://example.com'}]});
 await service.setCurrentParking(trip.id,{title:'Parking',content:'Bay 3',tags:['Parking','Current']});
 await service.createKnowledge({title:'Unrelated global parking',tags:['parking','current']});
 const before=await service.tripContext(trip.id,{now,perspectiveParticipantId:'wes'}),count=repo.knowledge.size,copy=await service.copyTrip(trip.id);
 assert.equal(repo.knowledge.size,count);assert.equal(copy.endDate,trip.endDate);assert.equal(copy.knowledgePreloadTag,trip.knowledgePreloadTag);
 const packet=await service.tripContext(copy.id,{now,perspectiveParticipantId:'wes'});
 assert.deepEqual(packet.current.parkingKnowledge,before.current.parkingKnowledge);assert.equal(packet.current.parkingKnowledge.length,1);
 assert.equal(packet.current.accommodation[0].knowledge[0].id,note.id);assert.equal(packet.current.hire[0].knowledge[0].id,note.id);
 assert.equal((await service.tripContext(copy.id,{now,perspectiveParticipantId:'skye'})).knowledge.some(x=>x.id===note.id),false);
 assert.equal((await service.getKnowledge(note.id)).revision,note.revision);
});

test('Trip/subtree deletion removes references only, preserves global records and unrelated Trips',async()=>{
 const {service,trip}=await setup(),parent=await service.createEvent(trip.id,{title:'Parent'}),child=await service.createEvent(trip.id,{title:'Child',parentEventId:parent.id});
 const k=await service.createKnowledge(trip.id,{title:'Preserved',relatedEventIds:[child.id]}),other=await service.createTrip({title:'Keep'}),e=await service.createEvent(other.id,{title:'Keep',knowledgeIds:[k.id]});
 await deleteAppEvent(service,parent.id,(await eventDeletionPreview(service,parent.id)).expected);
 assert.deepEqual((await service.getKnowledge(k.id)).relatedEventIds,[e.id]);assert.equal((await service.getKnowledge(k.id)).revision,k.revision);
 await deleteAppTrip(service,trip.id,(await tripDeletionPreview(service,trip.id)).expected);
 const kept=await service.getKnowledge(k.id);assert.equal(kept.tripId,null);assert.equal(kept.ownerId,'owner');assert.deepEqual(kept.sources,k.sources);assert.deepEqual((await service.getEvent(e.id)).knowledgeIds,[k.id]);
});

test('legacy queued Knowledge/parking calls replay after restart; packet commits remain independent of global library',async()=>{
 const {service,trip}=await setup(),queue=new MemoryStore();await queue.enqueue({operation:'createKnowledge',arguments:{tripId:trip.id,knowledge:{title:'Legacy queued note',content:''}}});
 await queue.enqueue({operation:'setCurrentParking',arguments:{tripId:trip.id,knowledge:{title:'Parked',content:'Bay 2'}}});
 const restarted=new MemoryStore({mutations:await queue.pending()});await replayQueue(restarted,{mutate:m=>dispatchClientMutation(service,m)});assert.equal((await restarted.pending()).length,0);
 const global=await service.createKnowledge({title:'Never put entire library in packet'}),store=new MemoryStore();
 const packet=await syncPacket({store,tripId:trip.id,api:{packet:()=>service.tripContext(trip.id)},fetchArtifact:()=>{throw Error('No artifacts');}});
 assert.equal(packet.knowledge.some(k=>k.id===global.id),false);assert.equal(packet.current.parkingKnowledge.length,1);assert.equal((await store.getPacket(trip.id)).meta.usable,true);
});

test('MCP inventory is unchanged: global foundation adds no library/search/deletion tool',async()=>{
 const {service}=await setup(),server=createPorterMcpServer(service),client=new Client({name:'foundation',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{const names=(await client.listTools()).tools.map(t=>t.name).sort();assert.deepEqual(names,['attach_artifact_metadata','create_event','create_knowledge','create_trip','export_event','export_knowledge','export_trip','get_trip','get_trip_context','list_trips','store_artifact','update_event','update_knowledge','update_trip'].sort());}finally{await client.close();await server.close();}
});

test('ordinary Knowledge patches never write a stale derived relationship list back to persistence',async()=>{
 const {SupabasePorterRepository}=await import('../src/repository.js');const k=newKnowledge({title:'Keep references'},'owner');let payload;
 const query={update:row=>{payload=row;return query;},eq:()=>query,select:()=>query,maybeSingle:async()=>({data:{id:k.id,owner_id:k.ownerId,title:k.title,content:'new',tags:[],related_event_ids:['new-server-link'],revision:2},error:null})};
 const repo=new SupabasePorterRepository({from:()=>query});await repo.updateKnowledge({...k,content:'new',relatedEventIds:['stale-link'],revision:2},1);
 assert.equal('related_event_ids' in payload,false);
 await repo.updateKnowledge({...k,relatedEventIds:[],revision:2},1,{referencesChanged:true});assert.deepEqual(payload.related_event_ids,[]);
});
