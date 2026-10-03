import test from 'node:test';
import assert from 'node:assert/strict';
import { PorterService } from '../src/service.js';
import { ConflictError } from '../src/domain.js';

const owner = 'owner-1'; const NOW = '2026-11-23T12:00:00.000Z';
function setup() { const service=new PorterService(); const trip=service.createTrip(owner,{title:'LA home leave',participants:[{id:'wes',name:'Wes'},{id:'skye',name:'Skye'},{id:'tor',name:'Tor'}]}); return {service,trip}; }
function event(service,trip,input) { return service.createEvent(owner,trip.id,{title:'thing',...input}); }

test('creates a generic sparse Event without a type', () => {
  const {service,trip}=setup(); const item=event(service,trip,{});
  service.createKnowledge(owner,trip.id,{title:'Room',content:'814'});
  assert.equal(item.movement,false); assert.deepEqual(item.temporal,{}); assert.equal(item.revision,1); assert.equal(service.listEvents(owner,trip.id).length,1); assert.equal(service.listKnowledge(owner,trip.id).length,1);
});
test('movement preserves cross-timezone local expressions and rejects ordinary location', () => {
  const {service,trip}=setup(); const item=event(service,trip,{movement:true,temporal:{start:'2026-11-19T09:00:00+09:30',startTimezone:'Australia/Darwin',end:'2026-11-19T07:30:00-08:00',endTimezone:'America/Los_Angeles'},spatial:{origin:{label:'Alice Springs'},destination:{label:'Los Angeles'}}});
  const packet=service.tripContext(owner,trip.id,{now:'2026-11-18T00:00:00Z'}); assert.equal(packet.events[item.id].spatial.destination.label,'Los Angeles');
  assert.throws(()=>event(service,trip,{movement:true,spatial:{location:{label:'bad'}}}),/ordinary location/);
});
test('perspective includes participantless global Events and excludes other participants', () => {
  const {service,trip}=setup(); const global=event(service,trip,{title:'Family dinner'}); event(service,trip,{title:'Skye flight',participants:['skye']});
  const packet=service.tripContext(owner,trip.id,{perspectiveParticipantId:'wes',now:NOW}); assert.deepEqual(Object.keys(packet.events),[global.id]);
});
test('perspective never turns a filtered composite parent into a leaf or creates dangling tree references', () => {
  const {service,trip}=setup(); const globalParent=event(service,trip,{title:'Family tour',temporal:{start:'2026-11-23T13:00:00Z'}}); event(service,trip,{title:'Skye segment',parentEventId:globalParent.id,participants:['skye'],temporal:{start:'2026-11-23T13:00:00Z'}}); const hiddenParent=event(service,trip,{title:'Wes tour',participants:['skye']}); const wesChild=event(service,trip,{title:'Wes segment',parentEventId:hiddenParent.id,participants:['wes'],temporal:{start:'2026-11-23T14:00:00Z'}});
  const packet=service.tripContext(owner,trip.id,{perspectiveParticipantId:'wes',now:NOW}); assert.equal(packet.current.next,wesChild.id); assert.deepEqual(packet.eventTree.null,[globalParent.id,wesChild.id]); assert.equal(packet.eventTree[hiddenParent.id],undefined);
});
test('composite parents group but leaves drive next', () => {
  const {service,trip}=setup(); const parent=event(service,trip,{title:'Cooking class'}); const child=event(service,trip,{title:'Market tour',parentEventId:parent.id,temporal:{start:'2026-11-23T13:00:00Z',end:'2026-11-23T14:00:00Z'}});
  const packet=service.tripContext(owner,trip.id,{now:NOW}); assert.equal(packet.current.next,child.id); assert.deepEqual(packet.eventTree[parent.id],[child.id]);
});
test('classifies Past Now Next Later conservatively', () => {
  const {service,trip}=setup(); const past=event(service,trip,{title:'Past',temporal:{end:'2026-11-22T12:00:00Z'}}); const current=event(service,trip,{title:'Now',temporal:{start:'2026-11-23T11:00:00Z',end:'2026-11-23T13:00:00Z'}}); const next=event(service,trip,{title:'Next',temporal:{start:'2026-11-23T14:00:00Z'}}); const later=event(service,trip,{title:'Later',temporal:{start:'2026-11-24T14:00:00Z'}}); event(service,trip,{title:'Unknown'});
  const state=service.tripContext(owner,trip.id,{now:NOW}).current; assert.deepEqual(state.past,[past.id]); assert.deepEqual(state.now,[current.id]); assert.equal(state.next,next.id); assert.deepEqual(state.later,[later.id]);
});
test('projects overlapping accommodation and hire without guessing type', () => {
  const {service,trip}=setup(); const hotel=event(service,trip,{title:'Hotel',accommodation:true,temporal:{start:'2026-11-22T00:00:00Z',end:'2026-11-24T00:00:00Z'},spatial:{location:{label:'Redondo'}}}); const house=event(service,trip,{title:'Parents house',accommodation:true,temporal:{start:'2026-11-23T00:00:00Z',end:'2026-11-25T00:00:00Z'}}); const stroller=event(service,trip,{title:'Stroller',hire:true,temporal:{start:'2026-11-23T00:00:00Z',end:'2026-11-24T00:00:00Z'}});
  service.createKnowledge(owner,trip.id,{title:'Hotel room',content:'814',relatedEventIds:[hotel.id]});
  const state=service.tripContext(owner,trip.id,{now:NOW}).current; assert.deepEqual(state.accommodation.map(x=>x.eventId).sort(),[hotel.id,house.id].sort()); assert.deepEqual(state.hire.map(x=>x.eventId),[stroller.id]); assert.equal(state.accommodation.find(x=>x.eventId===hotel.id).knowledge[0].content,'814'); assert.equal(state.accommodation.find(x=>x.eventId===hotel.id).checkout,'2026-11-24T00:00:00Z');
});
test('knowledge validity and parking are knowledge-derived', () => {
  const {service,trip}=setup(); const current=service.createKnowledge(owner,trip.id,{title:'Parked at 3rd',content:'Level B',tags:['parking','current'],validityWindows:[{start:'2026-11-23T10:00:00Z',end:'2026-11-23T20:00:00Z'}]}); service.createKnowledge(owner,trip.id,{title:'Old park',content:'gone',tags:['parking','current'],validityWindows:[{end:'2026-11-22T00:00:00Z'}]});
  const packet=service.tripContext(owner,trip.id,{now:NOW}); assert.deepEqual(packet.current.parkingKnowledge,[current.id]); assert.equal(packet.knowledge.length,1);
});
test('expected admissions are modeled on booking and artifact ownership remains event-owned', () => {
  const {service,trip}=setup(); const opera=event(service,trip,{title:'Opera',booking:{expectedAdmissions:[{id:'wes-ticket',participantId:'wes'},{id:'skye-ticket',participantId:'skye'}]}}); const updated=service.attachArtifact(owner,opera.id,{id:'pass-wes',role:'ticket',participantIds:['wes'],satisfiesAdmissionIds:['wes-ticket'],mediaType:'application/pdf',storageRef:{provider:'supabase',key:'opaque'},offlineRequired:true,version:'sha256:x'},opera.revision);
  const packet=service.tripContext(owner,trip.id,{now:NOW}); assert.equal(packet.access.length,2); assert.deepEqual(packet.access[0].artifactIds,['pass-wes']); assert.equal(updated.revision,2);
});
test('optional Events do not become operational Next and cancelled Events do not become Now', () => {
  const {service,trip}=setup(); event(service,trip,{title:'Maybe dinner',commitment:'optional',temporal:{start:'2026-11-23T13:00:00Z'}}); const confirmed=event(service,trip,{title:'Booked dinner',commitment:'confirmed',temporal:{start:'2026-11-23T14:00:00Z'}}); event(service,trip,{title:'Cancelled museum',commitment:'cancelled',temporal:{start:'2026-11-23T11:00:00Z',end:'2026-11-23T13:00:00Z'}});
  const state=service.tripContext(owner,trip.id,{now:NOW}).current; assert.equal(state.next,confirmed.id); assert.deepEqual(state.now,[]);
});
test('updates reject identity and ownership changes and revalidate the whole object', () => {
  const {service,trip}=setup(); const item=event(service,trip,{}); const knowledge=service.createKnowledge(owner,trip.id,{title:'Room',content:'814'});
  assert.throws(()=>service.updateEvent(owner,item.id,{tripId:'other'},1),/immutable/); assert.throws(()=>service.updateTrip(owner,trip.id,{ownerId:'other'},1),/immutable/); assert.throws(()=>service.updateEvent(owner,item.id,{commitment:'wrong'},1),/Invalid/); assert.throws(()=>service.updateEvent(owner,item.id,{title:' '},1),/required/); assert.throws(()=>service.updateKnowledge(owner,knowledge.id,{content:' '},1),/required/); assert.throws(()=>service.updateTrip(owner,trip.id,{lifecycle:'wrong'},1),/Invalid/);
});
test('optimistic revisions reject conflicts', () => {
  const {service,trip}=setup(); const changed=service.updateTrip(owner,trip.id,{title:'Changed'},1); assert.equal(changed.revision,2); assert.throws(()=>service.updateTrip(owner,trip.id,{title:'Lost'},1),ConflictError);
});
test('copy preserves source semantics while creating independent identities', () => {
  const {service,trip}=setup(); const original=event(service,trip,{title:'Train'}); const copied=service.copyEvent(owner,original.id); const copiedTrip=service.copyTrip(owner,trip.id);
  assert.notEqual(copied.id,original.id); assert.equal(copied.title,'Train (copy)'); assert.notEqual(copiedTrip.id,trip.id);
});
test('exports source truth rather than a rendered packet', () => {
  const {service,trip}=setup(); event(service,trip,{title:'Café stop'}); const raw=JSON.parse(service.exportTrip(owner,trip.id,'json')); const text=service.exportTrip(owner,trip.id);
  assert.equal(raw.trip.id,trip.id); assert.equal(raw.events[0].title,'Café stop'); assert.match(text,/"artifacts"/); assert.match(text,/"participants"/); assert.equal(raw.current,undefined);
});
