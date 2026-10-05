const clone = value => structuredClone(value);
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
  const date = new Date(value);
  try {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  } catch { return value.slice(0,16); }
}

/** Converts a datetime-local value in the supplied Event zone to a source instant. */
export function zonedDateTimeToIso(value, timeZone) {
  if (!value) return null;
  if (!timeZone) throw new TypeError('A timezone is required when entering an Event time.');
  const [date,time] = value.split('T'); const [year,month,day]=date.split('-').map(Number); const [hour,minute]=time.split(':').map(Number);
  const guess=Date.UTC(year,month-1,day,hour,minute);
  const format = instant => { const x=localParts(new Date(instant).toISOString(),timeZone); return x ? x.day.replaceAll('-','') + String(Math.floor(x.minute/60)).padStart(2,'0') + String(x.minute%60).padStart(2,'0') : ''; };
  const wanted=`${String(year).padStart(4,'0')}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}${String(hour).padStart(2,'0')}${String(minute).padStart(2,'0')}`;
  let instant=guess;
  for(let i=0;i<3&&format(instant)!==wanted;i++) {
    const shown=format(instant); const shownDate=Date.UTC(Number(shown.slice(0,4)),Number(shown.slice(4,6))-1,Number(shown.slice(6,8)),Number(shown.slice(8,10)),Number(shown.slice(10,12)));
    instant += guess - shownDate;
  }
  return new Date(instant).toISOString();
}

export function eventLocalDay(event) { return localParts(event.temporal?.start, event.temporal?.startTimezone)?.day ?? null; }
export function eventLocalMinute(event) { return localParts(event.temporal?.start, event.temporal?.startTimezone)?.minute ?? null; }
const compareEvents = (a, b) => (Date.parse(a.temporal?.start ?? '') || Infinity) - (Date.parse(b.temporal?.start ?? '') || Infinity) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
const dateRange = (start, end) => { const days=[]; for(let cursor=new Date(`${start}T00:00:00Z`);cursor<=new Date(`${end}T00:00:00Z`);cursor.setUTCDate(cursor.getUTCDate()+1)) days.push(cursor.toISOString().slice(0,10)); return days; };

/** A narrow display-only overlay: source TripPacket is never mutated. */
export function withPendingEvents(packet, mutations = []) {
  const result = clone(packet), events = { ...result.events };
  const pendingIds = new Set();
  for (const mutation of mutations) {
    const args = mutation.arguments ?? {};
    if (args.tripId !== packet.trip.id) continue;
    if (mutation.operation === 'createEvent' && args.event?.title?.trim()) {
      const id = `pending:${mutation.id}`;
      events[id] = { ...clone(args.event), id, tripId: packet.trip.id, parentEventId: args.event.parentEventId ?? null, revision: 0, pending: true };
      pendingIds.add(id);
    }
    if (mutation.operation === 'updateEvent' && args.eventId && events[args.eventId]) {
      events[args.eventId] = { ...events[args.eventId], ...clone(args.patch ?? {}), pending: true, pendingConflict: mutation.state === 'conflict' };
      pendingIds.add(args.eventId);
    }
  }
  return { ...result, events, pendingEventIds: pendingIds };
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
  return { event, knowledge: (packet.knowledge ?? []).filter(item => item.relatedEventIds?.includes(eventId)), access: (packet.access ?? []).filter(item => item.eventId === eventId) };
}
