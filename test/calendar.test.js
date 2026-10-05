import test from 'node:test';
import assert from 'node:assert/strict';
import { dayHeading,weekProjection,blockClasses } from '../client/calendar.js';
import { calendarProjection,withPendingEvents } from '../client/planning.js';
import { MemoryRepository } from './helpers/repository.js';
import { PersistentPorterService } from '../src/persistent-service.js';

test('week uses seven days, bounded paging, current local day and stable waking scale',()=>{
  const calendar={days:Array.from({length:21},(_,i)=>({day:`2026-10-${String(i+1).padStart(2,'0')}`,current:i===9,blocks:[]}))};
  const week=weekProjection(calendar);assert.equal(week.start,'2026-10-05');assert.equal(week.days.length,7);
  assert.equal(week.previous,'2026-09-28');assert.equal(week.next,'2026-10-12');assert.equal(week.startHour,6);assert.equal(week.endHour,23);
  assert.equal(weekProjection(calendar,'2020-01-01').previous,null);assert.equal(weekProjection(calendar,'2040-01-01').next,null);
  assert.equal(weekProjection({days:[]}),null);assert.equal(dayHeading('2026-09-25'),'Friday · Sep 25');
});
test('early and late Events remain available while waking blocks communicate duration',()=>{
  const blocks=[{event:{id:'early'},start:120,duration:60},{event:{id:'cross'},start:330,duration:120},{event:{id:'normal'},start:600,duration:120},{event:{id:'late'},start:1410,duration:30}];
  const day=weekProjection({days:[{day:'2026-10-05',blocks}]}).days[0];
  assert.deepEqual(day.early.map(b=>b.event.id),['early','cross']);assert.deepEqual(day.late.map(b=>b.event.id),['late']);
  assert.deepEqual(day.visible.map(b=>b.event.id),['cross','normal']);assert.equal(day.visible[0].top,0);assert.equal(day.visible[1].height,120/1020*100);
});
test('manual palette is presentation only; optional is the existing tentative representation',()=>{
  for(const commitment of ['planned','confirmed','completed','cancelled'])assert.equal(blockClasses({commitment,movement:true,participants:['wes']}),'calendar-block');
  assert.equal(blockClasses({commitment:'optional',visual:{color:'sky'}}),'calendar-block color-sky tentative');
  assert.equal(blockClasses({visual:{color:'invalid style'}}),'calendar-block');
});
test('normal semantic edits persist color through TripPacket and local pending overlay, retaining other visual aspects',async()=>{
  const service=new PersistentPorterService(new MemoryRepository(),'owner');const trip=await service.createTrip({title:'Colors'});
  const event=await service.createEvent(trip.id,{title:'Gallery',visual:{visual_role:'museum'},temporal:{start:'2026-10-05T10:00:00Z',end:'2026-10-05T12:00:00Z',startTimezone:'UTC'}});
  const patch={visual:{...event.visual,color:'olive'}};
  const before=await service.tripContext(trip.id),local=withPendingEvents(before,[{operation:'updateEvent',arguments:{tripId:trip.id,eventId:event.id,patch}}]);
  assert.equal(calendarProjection(local).days[0].blocks[0].event.visual.color,'olive');
  const updated=await service.updateEvent(event.id,patch,event.revision);
  assert.deepEqual((await service.tripContext(trip.id)).events[event.id].visual,{visual_role:'museum',color:'olive'});
  await service.updateEvent(event.id,{visual:{...updated.visual,color:null}},updated.revision);
  assert.equal((await service.tripContext(trip.id)).events[event.id].visual.color,null);
});
