import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPorterMcpServer } from '../mcp/server.mjs';
import { PersistentPorterService } from '../src/persistent-service.js';
import { MemoryRepository } from './helpers/repository.js';
import { buildTripPacket } from '../src/projection.js';
import { withPendingEvents, prepareJourney, localJourney } from '../client/planning.js';
import { withoutDeletedEvents } from '../client/deleted-events.js';
import { MemoryStore, replayQueue } from '../client/core.js';
import { retireParkingReceipts } from '../client/journey-receipts.js';

const trip = {id:'trip',revision:1,participants:[]};
const event = (id,start,end,extra={}) => ({id,title:id,revision:1,participants:[],artifacts:[],temporal:{start,end},...extra});
const generatedAt = '2026-11-12T10:00:00Z', incident = '2026-11-14T22:52:00Z';
const opens = '2026-11-14T22:00:00Z', closes = '2026-11-15T02:00:00Z';
const offset = (date,ms) => new Date(Date.parse(date)+ms).toISOString();
const parking = {id:'bay',revision:1,participantIds:[],relatedEventIds:[],tags:['parking','current'],validityWindows:[{start:opens,end:closes}]};
const source = {trip,events:[
  event('flight','2026-11-12T11:00:00+11:00','2026-11-12T06:00:00-08:00',{movement:true}),
  event('stay','2026-11-12T15:00:00-08:00','2026-11-16T11:00:00-08:00',{accommodation:true}),
  event('wedding',opens,closes),event('hire',opens,closes,{hire:true}),
  event('return','2026-11-17T21:00:00-08:00','2026-11-19T08:00:00+11:00',{movement:true})
],knowledge:[parking]};
for (const zone of ['UTC','Australia/Darwin','Australia/Sydney','America/Los_Angeles']) {
  test('one cached Sydney–LA packet at the incident instant and on return in '+zone,()=>{
    const originalZone = process.env.TZ;
    try {
      process.env.TZ = zone;
      const packet = buildTripPacket(source,{generatedAt}), serialized = JSON.stringify(packet);
      assert.deepEqual(packet.current.now,['flight']);
      assert.deepEqual(packet.knowledge,[]);
      for (const [clock,now] of [[incident,['stay','hire','wedding']],['2026-11-18T10:00:00Z',['return']],[generatedAt,['flight']]]) {
        const view = withPendingEvents(packet,[],clock);
        const server = buildTripPacket(source,{generatedAt,now:clock});
        assert.deepEqual(view.current,server.current);
        assert.deepEqual(view.current.now,now);
        assert.equal(view.generatedAt,generatedAt);
        assert.equal(view.revision,packet.revision);
        assert.equal(view.projectedAt,clock);
        if (clock===incident) {
          assert.deepEqual(view.current.past,['flight']);
          assert.deepEqual(view.current.parkingKnowledge,['bay']);
          assert.equal(view.current.hire[0].eventId,'hire');
          assert.equal(view.current.accommodation[0].eventId,'stay');
        }
      }
      assert.equal(JSON.stringify(packet),serialized);
    } finally { if (originalZone===undefined) delete process.env.TZ; else process.env.TZ=originalZone; }
  });
}

test('inclusive intervals, stable ties, incomplete endpoints, point and commitment boundaries',()=>{
  const events = [event('z',opens,closes),event('a',opens,closes),event('start',opens),event('end',null,closes),
    event('point',opens,opens),event('sparse'),event('done',null,null,{commitment:'completed'}),
    event('maybe',opens,closes,{commitment:'optional'}),event('cancel',opens,closes,{commitment:'cancelled'})];
  for (const ordered of [events,events.toReversed()]) {
    const packet = buildTripPacket({trip,events:ordered,knowledge:[parking]},{generatedAt});
    const at = clock => withPendingEvents(packet,[],clock);
    const before = at(offset(opens,-1));
    assert.equal(before.nextBoundary,Date.parse(opens));
    assert.equal(before.current.next,'a');
    assert.deepEqual(before.current.later,['point','start','z']);
    assert.deepEqual(at(opens).current.now,['a','point','z']);
    assert.equal(at(opens).nextBoundary,Date.parse(opens)+1);
    assert.deepEqual(at(offset(opens,1)).current.now,['a','z']);
    assert.deepEqual(at(closes).current.parkingKnowledge,['bay']);
    assert.deepEqual(at(offset(closes,1)).current.parkingKnowledge,[]);
    assert.deepEqual(at(offset(closes,1)).current.past,['a','cancel','maybe','point','z','done','end']);
  }
});

test('fall-back repeated hour and spring-forward gap use endpoint instants in either clock direction',()=>{
  for (const [start,end] of [
    ['2026-11-01T01:30:00-07:00','2026-11-01T01:30:00-08:00'],
    ['2026-10-04T01:55:00+10:00','2026-10-04T03:05:00+11:00']]) {
    const packet = buildTripPacket({trip,events:[event('hire',start,end,{hire:true})],knowledge:[]});
    for (const clock of [start,end,offset(end,1),offset(start,-1),start]) {
      const active = Date.parse(start)<=Date.parse(clock) && Date.parse(clock)<=Date.parse(end);
      assert.equal(withPendingEvents(packet,[],clock).current.hire.length,Number(active));
    }
  }
});

test('scoped future Knowledge and hidden children survive mutation overlays and legacy upgrades',()=>{
  const events = [event('group',opens,closes),event('private',opens,closes,{participants:['other'],parentEventId:'group',knowledgeIds:['private-note']})];
  const knowledge = [parking,{...parking,id:'private-note',operationalContext:false},{...parking,id:'scoped',participantIds:['other']}];
  const packet = buildTripPacket({trip,events,knowledge},{generatedAt,perspectiveParticipantId:'me'});
  assert.ok(!JSON.stringify(packet).includes('private'));
  const update = {id:'edit',operation:'updateEvent',arguments:{tripId:trip.id,eventId:'group',patch:{title:'Changed'}}};
  const view = withPendingEvents(packet,[update],incident);
  assert.deepEqual(view.current.now,[]);
  assert.deepEqual(view.current.parkingKnowledge,['bay']);
  const legacy = structuredClone(packet);
  for(const key of ['projectionInput','projectedAt','nextBoundary']) delete legacy[key];
  const partial = withPendingEvents(legacy,[update],incident);
  assert.equal(partial.projectionCoverage,'legacy-partial');
  assert.deepEqual(partial.current.now,[]);
  assert.deepEqual(partial.knowledge,[]);
  const create = {id:'add',state:'acknowledged',operation:'createEvent',arguments:{tripId:trip.id,event:events[0]},result:event('accepted',opens,closes)};
  const cleaned = withoutDeletedEvents(packet,['accepted']);
  const prepared = prepareJourney(cleaned,[update,create],['accepted']);
  assert.equal(localJourney(cleaned,prepared,incident).events.accepted,undefined);
});

test('parking receipts bridge failed reconciliation, observe windows and retain capture-clear order',async()=>{
  const store = new MemoryStore();
  const packet = buildTripPacket({trip,events:[],knowledge:[]},{generatedAt});
  const result = {...parking,sources:[{type:'porter-parking-capture',id:'set'}]};
  await store.putPacket(trip.id,{packet,meta:{usable:true}});
  await store.enqueue({id:'set',operation:'setCurrentParking',arguments:{tripId:trip.id,knowledge:parking}});
  await replayQueue(store,{mutate:async()=>result});
  const view = async now => withPendingEvents(packet,await store.allMutations(),now);
  assert.deepEqual((await view(generatedAt)).current.parkingKnowledge,[]);
  assert.deepEqual((await view(incident)).current.parkingKnowledge,['bay']);
  await store.enqueue({id:'clear',operation:'clearCurrentParking',arguments:{tripId:trip.id,captureId:'set'}});
  await replayQueue(store,{mutate:async()=>({cleared:true})});
  await retireParkingReceipts(store,packet);
  assert.equal((await store.allMutations()).length,2);
  assert.deepEqual((await view(incident)).current.parkingKnowledge,[]);
  const fresh = buildTripPacket({trip,events:[],knowledge:[{...result,tags:['parking']}]},{generatedAt});
  await store.putPacket(trip.id,{packet:fresh,meta:{usable:true}});
  await retireParkingReceipts(store,fresh);
  assert.deepEqual(await store.allMutations(),[]);
});

test('persistent server, MCP tool and offline client project equivalent Journey at one explicit instant',async()=>{
  const service = new PersistentPorterService(new MemoryRepository(),'owner');
  const trip = await service.createTrip({title:'Sydney to Los Angeles'});
  await service.createEvent(trip.id,{title:'Wedding',temporal:{start:opens,end:closes}});
  await service.createKnowledge(trip.id,{title:'Arrival instructions',validityWindows:[{start:opens}]});
  const cached = await service.tripContext(trip.id,{now:generatedAt});
  const server = createPorterMcpServer(service),client = new Client({name:'journey-clock',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const response = await client.callTool({name:'get_trip_context',arguments:{tripId:trip.id,now:incident}});
    const remote = JSON.parse(response.content[0].text), local = withPendingEvents(cached,[],incident);
    const direct = await service.tripContext(trip.id,{now:incident});
    for (const field of ['current','knowledge','nextBoundary','revision','projectedAt']) {
      assert.deepEqual(local[field],remote[field]);
      assert.deepEqual(remote[field],direct[field]);
    }
  } finally {await client.close(); await server.close();}
});

test('participant-changing edits use their durable base in another cached selection, then honor deletion',async()=>{
  const {recordEvent,undoEvent} = await import('../client/event-mutations.js');
  const store = new MemoryStore(), child = event('child',opens,closes,{participants:['a']});
  const packet = buildTripPacket({trip,events:[child],knowledge:[]},{generatedAt,perspectiveParticipantId:'b'});
  const edit = await recordEvent(store,{operation:'updateEvent',arguments:{tripId:trip.id,eventId:'child',patch:{participants:['b']}}},child);
  assert.deepEqual(withPendingEvents(packet,await store.allMutations(),incident).current.now,['child']);
  await undoEvent(store,edit.id);
  assert.deepEqual(withPendingEvents(packet,await store.allMutations(),incident).current.now,[]);
});

test('acknowledged Event overlay remains available until the other cached perspective reconciles',async()=>{
  const {retireEventReceipts} = await import('../client/event-mutations.js');
  const old = event('wedding',opens,closes), updated = {...old,revision:2,commitment:'cancelled'};
  const tripWithPeople = {...trip,participants:[{id:'me'}]};
  const packet = (e,perspectiveParticipantId) => buildTripPacket({trip:tripWithPeople,events:[e],knowledge:[]},{generatedAt,perspectiveParticipantId});
  const fresh = packet(updated,null), stale = packet(old,'me'), store = new MemoryStore();
  await store.putPacket(trip.id,{packet:stale,meta:{usable:true}},'me');
  await store.enqueue({id:'edit',localEvent:true,state:'acknowledged',operation:'updateEvent',undoUntil:0,
    arguments:{tripId:trip.id,eventId:old.id},result:updated});
  await retireEventReceipts(store,fresh);
  assert.equal((await store.allMutations()).length,1);
  assert.deepEqual(withPendingEvents(stale,await store.allMutations(),incident).current.now,[]);
  await store.putPacket(trip.id,{packet:packet(updated,'me'),meta:{usable:true}},'me');
  await retireEventReceipts(store,fresh);
  assert.deepEqual(await store.allMutations(),[]);
});

test('retiring successive acknowledged edits cannot restore an older visible participant assignment',async()=>{
  const {retireEventReceipts} = await import('../client/event-mutations.js');
  const before=event('activity',opens,closes,{participants:['a'],revision:2});
  const after={...before,participants:['b'],revision:3};
  const family={...trip,participants:[{id:'a'},{id:'b'}]}, store=new MemoryStore();
  const packet=p=>buildTripPacket({trip:family,events:[after],knowledge:[]},{generatedAt,perspectiveParticipantId:p});
  await store.putPacket(trip.id,{packet:packet('a'),meta:{usable:true}},'a');
  for(const result of [before,after])await store.enqueue({id:'edit-'+result.revision,localEvent:true,undoUntil:0,
    operation:'updateEvent',state:'acknowledged',arguments:{tripId:trip.id,eventId:result.id},result});
  await retireEventReceipts(store,packet(null));
  assert.deepEqual(await store.allMutations(),[]);
  assert.deepEqual(withPendingEvents(packet('a'),await store.allMutations(),incident).current.now,[]);
});
