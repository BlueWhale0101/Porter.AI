import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedDateTimeToIso } from '../client/planning.js';
import { inferTimezone,timezoneLabel } from '../client/event-editor.js';
import { validateTemporal } from '../src/temporal.js';
import { PersistentPorterService } from '../src/persistent-service.js';
import { MemoryRepository } from './helpers/repository.js';
import { acceptanceData } from '../scripts/acceptance-data.mjs';

test('wall time parsing rejects partial, impossible, overflow and out-of-policy years without repair',()=>{
  for(const value of ['2026-','2026-02-30T12:00','2026-13-02T12:00','2026-01-01T24:00','2026-01-01T12:99','26-01-01T12:00','2407-05-02T00:28'])assert.throws(()=>zonedDateTimeToIso(value,'Europe/London'),TypeError);
  assert.equal(zonedDateTimeToIso('2026-10-05T12:30','Europe/London'),'2026-10-05T11:30:00.000Z');
  assert.equal(zonedDateTimeToIso('2026-10-05T12:30','Europe/Rome'),'2026-10-05T10:30:00.000Z');
  assert.throws(()=>zonedDateTimeToIso('2026-10-05T12:30','not/a/zone'));
});
test('DST gaps and folds are rejected rather than silently choosing another local time',()=>{
  assert.throws(()=>zonedDateTimeToIso('2026-03-29T01:30','Europe/London'),/does not exist/);
  assert.throws(()=>zonedDateTimeToIso('2026-10-25T01:30','Europe/London'),/occurs twice/);
  assert.equal(zonedDateTimeToIso('2026-03-29T03:30','Europe/London'),'2026-03-29T02:30:00.000Z');
});
test('semantic create and update reject malformed timestamps, impossible dates, zones and reverse ranges',async()=>{
  const service=new PersistentPorterService(new MemoryRepository(),'owner'),trip=await service.createTrip({title:'Temporal'});
  for(const start of ['2026-02-30T12:00:00Z','2026-01-01','2026-01-01T12:00:00','2407-05-02T00:28:00.000Z'])await assert.rejects(service.createEvent(trip.id,{title:'Bad',temporal:{start}}),TypeError);
  assert.equal((await service.listEvents(trip.id)).length,0);
  const event=await service.createEvent(trip.id,{title:'Good',temporal:{start:'2026-10-05T12:00:00+01:00'}});
  await assert.rejects(service.updateEvent(event.id,{temporal:{start:'2026-02-30T12:00:00Z'}},event.revision),TypeError);
  assert.equal((await service.getEvent(event.id)).revision,event.revision);
  assert.throws(()=>validateTemporal({startTimezone:'London'}));assert.throws(()=>validateTemporal({start:'2026-10-05T12:00:00Z',end:'2026-10-05T11:00:00Z'}));
  assert.equal((await service.tripContext(trip.id)).events[event.id].revision,event.revision);
});
test('local acceptance context infers London, Rome, nearest dates and device fallback',()=>{
  const packet={events:Object.fromEntries(acceptanceData('2026-10-05').events.map(e=>[e.key,e]))};
  assert.equal(inferTimezone(packet,'2026-10-03'),'Europe/London');assert.equal(inferTimezone(packet,'2026-10-08'),'Europe/Rome');
  assert.equal(inferTimezone({events:{}},'2026-10-05',{deviceZone:'Australia/Darwin'}),'Australia/Darwin');
  assert.equal(timezoneLabel('Europe/London'),'London');assert.equal(timezoneLabel('Europe/Rome'),'Rome');
});
