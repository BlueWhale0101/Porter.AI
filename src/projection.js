const asMs = (value) => value ? Date.parse(value) : null;
const active = (event, now) => { const { start, end } = event.temporal ?? {}; return asMs(start) != null && asMs(end) != null && asMs(start) <= now && now <= asMs(end); };
const visibleTo = (object, perspective) => !perspective || object.participants.length === 0 || object.participants.includes(perspective);
const isValid = (knowledge, now) => knowledge.validityWindows.length === 0 || knowledge.validityWindows.some(w => (!w.start || asMs(w.start) <= now) && (!w.end || now <= asMs(w.end)));

export function buildTripPacket({ trip, events, knowledge }, { perspectiveParticipantId = null, now = new Date().toISOString() } = {}) {
  const at = asMs(now);
  const visible = events.filter(e => visibleTo(e, perspectiveParticipantId));
  const leaves = events.filter(e => !events.some(child => child.parentEventId === e.id)).filter(e => visible.includes(e));
  const completed = e => e.commitment === 'completed';
  const operational = e => !completed(e) && e.commitment !== 'cancelled' && e.commitment !== 'optional';
  const past = leaves.filter(e => completed(e) || (asMs(e.temporal?.end) != null && asMs(e.temporal.end) < at));
  const nowEvents = leaves.filter(e => operational(e) && active(e, at));
  const future = leaves.filter(e => operational(e) && asMs(e.temporal?.start) != null && asMs(e.temporal.start) > at).sort((a,b) => asMs(a.temporal.start)-asMs(b.temporal.start));
  const next = future[0] ?? null;
  const later = future.slice(1);
  const currentAccommodation = leaves.filter(e => e.accommodation && operational(e) && active(e, at));
  const currentHire = leaves.filter(e => e.hire && operational(e) && active(e, at));
  const relevantKnowledge = knowledge.filter(k => (!perspectiveParticipantId || k.participantIds.length === 0 || k.participantIds.includes(perspectiveParticipantId)) && isValid(k, at));
  const parking = relevantKnowledge.filter(k => k.tags.includes('parking') && k.tags.includes('current'));
  return { packetVersion: 1, trip: { ...trip, participants: trip.participants }, perspectiveParticipantId,
    generatedAt: now, revision: packetRevision(trip, events, knowledge),
    eventTree: tree(visible), events: Object.fromEntries(visible.map(e => [e.id, eventDescriptor(e)])),
    current: { past: past.map(e=>e.id), now: nowEvents.map(e=>e.id), next: next?.id ?? null, later: later.map(e=>e.id),
      accommodation: currentAccommodation.map(e=>currentResource(e,relevantKnowledge)), hire: currentHire.map(e=>currentResource(e,relevantKnowledge)), parkingKnowledge: parking.map(k=>k.id) },
    knowledge: relevantKnowledge, access: accessManifest(visible), artifactManifest: visible.flatMap(e => e.artifacts.map(a => ({ eventId:e.id, ...a }))) };
}
function tree(events) { const ids=new Set(events.map(e=>e.id)); const children = new Map(); for(const e of events) { const key=ids.has(e.parentEventId) ? e.parentEventId : null; children.set(key,[...(children.get(key)??[]),e.id]); } return Object.fromEntries(children); }
function eventDescriptor(e) { return { id:e.id, title:e.title, description:e.description, parentEventId:e.parentEventId, temporal:e.temporal, spatial:e.spatial, movement:e.movement, accommodation:e.accommodation, hire:e.hire, visual:e.visual, booking:e.booking, participants:e.participants, commitment:e.commitment, provenance:e.provenance }; }
function accessManifest(events) { return events.flatMap(e => (e.booking?.expectedAdmissions ?? []).map(a => ({ eventId:e.id, participantId:a.participantId, requirementId:a.id, status:a.status ?? 'expected', artifactIds:e.artifacts.filter(x => x.satisfiesAdmissionIds?.includes(a.id)).map(x=>x.id) }))); }
function currentResource(event, knowledge) { return { eventId:event.id, location:event.spatial?.location ?? null, checkout:event.temporal?.end ?? null, booking:event.booking, knowledge:knowledge.filter(k=>k.relatedEventIds.includes(event.id)) }; }
function packetRevision(trip, events, knowledge) { return [trip, ...events, ...knowledge].reduce((hash, x) => ((hash * 31) + x.revision) >>> 0, 17); }
