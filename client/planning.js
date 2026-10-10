import { buildTripPacket } from '../src/projection.js';
const clone = value => structuredClone(value);
import { calendarParts,validTimezone } from '../src/temporal.js';
const localFormatters=new Map();

const localParts = (value, timeZone) => {
  if (!value) return null;
  try {
    const key=timeZone??'';
    if(!localFormatters.has(key))localFormatters.set(key,new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }));
    const values = Object.fromEntries(localFormatters.get(key).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { day: `${values.year}-${values.month}-${values.day}`, minute: Number(values.hour) * 60 + Number(values.minute) };
  } catch { return null; }
};

export function localDateTimeValue(value, timeZone) {
  if (value && !timeZone) return '';
  const parts = localParts(value, timeZone);
  if (!parts) return '';
  return `${parts.day}T${String(Math.floor(parts.minute/60)).padStart(2,'0')}:${String(parts.minute%60).padStart(2,'0')}`;
}

/** Converts a datetime-local value in the supplied Event zone to a source instant. */
export function zonedDateTimeToIso(value, timeZone) {
  if (!value) return null;
  const [year,month,day,hour,minute,second,ms]=calendarParts(value);
  if (!validTimezone(timeZone)) throw new TypeError('Choose a timezone for this Event.');
  const wall=Date.UTC(year,month-1,day,hour,minute);
  // Probe both sides of any nearby offset transition. Exact round trips reject
  // nonexistent DST times and ambiguous repeated hours rather than guessing.
  const offsets=new Set();
  for(const delta of [-36,0,36]){const probe=wall+delta*3600000,p=localParts(new Date(probe).toISOString(),timeZone);offsets.add(Date.parse(p.day+'T00:00:00Z')+p.minute*60000-probe);}
  const matches=[...offsets].map(offset=>wall-offset).filter(instant=>{const p=localParts(new Date(instant).toISOString(),timeZone);return p.day===value.slice(0,10)&&p.minute===hour*60+minute;});
  if(matches.length!==1)throw new TypeError(matches.length?'This local time occurs twice because clocks change. Choose an unambiguous time.':'This local time does not exist because clocks change. Choose another time.');
  return new Date(matches[0]+second*1000+ms).toISOString();
}

export function eventLocalDay(event) { return localParts(event.temporal?.start, event.temporal?.startTimezone)?.day ?? null; }
export function eventLocalMinute(event) { return localParts(event.temporal?.start, event.temporal?.startTimezone)?.minute ?? null; }
const compareEvents = (a, b) => (Date.parse(a.temporal?.start ?? '') || Infinity) - (Date.parse(b.temporal?.start ?? '') || Infinity) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
const dateRange = (start, end) => { const days=[]; for(let cursor=new Date(`${start}T00:00:00Z`);cursor<=new Date(`${end}T00:00:00Z`);cursor.setUTCDate(cursor.getUTCDate()+1)) days.push(cursor.toISOString().slice(0,10)); return days; };

/** A narrow display-only overlay: source TripPacket is never mutated. */
export function withPendingEvents(packet, mutations = []) {
  const result=clone(packet),events={...result.events},aliases=new Map(),pendingIds=new Set();
  let changed=false;
  for(const mutation of mutations){
    const args=mutation.arguments??{};if(args.tripId!==packet.trip.id)continue;
    const acknowledged=mutation.state==='acknowledged',pending=!acknowledged;
    if(mutation.operation==='createEvent'&&args.event?.title?.trim()){
      const localId=`pending:${mutation.id}`,id=mutation.result?.id??localId;aliases.set(localId,id);
      if(!acknowledged||!events[id]||events[id].revision<mutation.result.revision){events[id]={...clone(args.event),...clone(mutation.result??{}),id,tripId:packet.trip.id,parentEventId:args.event.parentEventId??null,revision:mutation.result?.revision??0,pending,pendingMutationId:mutation.id,pendingConflict:mutation.state==='conflict'};changed=true;}
      if(pending)pendingIds.add(id);
    }
    if(mutation.operation==='updateEvent'){
      const id=mutation.result?.id??aliases.get(args.eventId)??args.eventId;
      if(acknowledged&&events[id]?.revision>=mutation.result.revision)continue;
      if(events[id]){events[id]={...events[id],...clone(mutation.result??args.patch??{}),pending,pendingMutationId:mutation.id,pendingConflict:mutation.state==='conflict'};changed=true;if(pending)pendingIds.add(id);}
    }
  }
  if(!changed)return {...result,events,pendingEventIds:pendingIds};
  // Reuse the authoritative projection rules for optimistic Journey placement.
  const sourceEvents=Object.values(events).map(e=>({participants:[],artifacts:[],...e}));
  const knowledge=(packet.knowledge??[]).map(k=>({participantIds:[],validityWindows:[],tags:[],relatedEventIds:[],...k}));
  const projected=buildTripPacket({trip:packet.trip,events:sourceEvents,knowledge},{perspectiveParticipantId:packet.perspectiveParticipantId??null});
  return {...result,events:Object.fromEntries(Object.keys(projected.events).map(id=>[id,events[id]])),current:projected.current,eventTree:projected.eventTree,pendingEventIds:pendingIds};
}

export function itineraryProjection(packet) {
  const events = Object.values(packet.events ?? {}), childIds = new Set(events.map(event => event.parentEventId).filter(Boolean));
  const leaf = events.filter(event => !childIds.has(event.id));
  const byId = Object.fromEntries(events.map(event => [event.id, event]));
  const groups = new Map(), unscheduled=[];
  for (const event of leaf) {
    const day = eventLocalDay(event);
    if (!day) { unscheduled.push(event); continue; }
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  const days = [...groups.keys()].sort().map(day => ({ day, events: groups.get(day).sort(compareEvents).map(event => ({ event, parent: event.parentEventId ? byId[event.parentEventId] ?? null : null })) }));
  return { days, unscheduled: unscheduled.sort(compareEvents), parentById: byId };
}

const durationMinutes = event => {
  const start = Date.parse(event.temporal?.start ?? ''), end = Date.parse(event.temporal?.end ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30;
  return Math.max(30, Math.min(12 * 60, Math.round((end - start) / 60000)));
};

export function calendarProjection(packet, { now = new Date().toISOString() } = {}) {
  const itinerary = itineraryProjection(packet), dated = itinerary.days;
  if (!dated.length) return { days: [], startHour: 6, endHour: 22 };
  const allDays = dateRange(dated[0].day, dated[dated.length - 1].day);
  const events = Object.values(packet.events ?? {}), childIds = new Set(events.map(event => event.parentEventId).filter(Boolean));
  const leaves = events.filter(event => !childIds.has(event.id) && eventLocalDay(event) && eventLocalMinute(event) != null);
  const currentDays = new Set(leaves.map(event => localParts(now, event.temporal?.startTimezone)?.day).filter(Boolean));
  const byDay=new Map();
  for(const event of leaves){const day=eventLocalDay(event);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(event);}
  const days = allDays.map(day => {
    const blocks = (byDay.get(day)??[]).sort(compareEvents).map(event => ({ event, start: eventLocalMinute(event), duration: durationMinutes(event), lane: 0, lanes: 1 }));
    const active=[];
    for (const block of blocks) {
      for(let i=active.length-1;i>=0;i--) if(active[i].start + active[i].duration <= block.start) active.splice(i,1);
      const used = new Set(active.map(item => item.lane)); while(used.has(block.lane)) block.lane++;
      active.push(block); const lanes = Math.max(...active.map(item => item.lane + 1)); active.forEach(item => item.lanes = Math.max(item.lanes, lanes));
    }
    return { day, blocks, current: currentDays.has(day) };
  });
  const minutes = leaves.flatMap(event => [eventLocalMinute(event), eventLocalMinute(event) + durationMinutes(event)]);
  return { days, startHour: Math.max(0, Math.floor(Math.min(...minutes, 360) / 60)), endHour: Math.min(24, Math.ceil(Math.max(...minutes, 1320) / 60)) };
}

export function tripPlanningSummary(packet) {
  const days = itineraryProjection(packet).days;
  return { title: packet.trip.title, lifecycle: packet.trip.lifecycle, participants: packet.trip.participants ?? [], startDay: days[0]?.day ?? null, endDay: days.at(-1)?.day ?? null };
}

export function planningDetails(packet, eventId) {
  const event = packet.events?.[eventId];
  if (!event) return null;
  return { event, knowledge: (packet.knowledge ?? []).filter(item => event.knowledgeIds?event.knowledgeIds.includes(item.id):item.relatedEventIds?.includes(eventId)), access: (packet.access ?? []).filter(item => item.eventId === eventId) };
}
