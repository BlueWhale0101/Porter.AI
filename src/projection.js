import { hasTag } from './knowledge.js';
const instant = value => value ? Date.parse(value) : null;
const visibleTo = (ids, perspective) => !perspective || !ids?.length || ids.includes(perspective);
const compareId = (a,b) => a.id < b.id ? -1 : Number(a.id > b.id);
const chronological = (a,b) => (instant(a.temporal?.start) ?? Infinity) - (instant(b.temporal?.start) ?? Infinity) || compareId(a,b);

// Pure: callers own the clock, source scope, persistence and scheduling.
export function projectJourney({events, knowledge, hiddenChildParents = []}, perspective, now) {
  const at = instant(now);
  if (!Number.isFinite(at)) throw new TypeError('Projection requires an explicit instant');
  let nextBoundary = null;
  function boundary(time) {
    if (time > at && (nextBoundary === null || time < nextBoundary)) nextBoundary = time;
  }
  const parents = new Set([...hiddenChildParents, ...events.map(e => e.parentEventId)]);
  const visible = events.filter(e => visibleTo(e.participants, perspective));
  const leaves = visible.filter(e => !parents.has(e.id)).sort(chronological);
  const links = new Set(visible.flatMap(e => e.knowledgeIds ?? []));
  const relevant = knowledge.filter(k => {
    if (!visibleTo(k.participantIds, perspective) || (k.operationalContext === false && !links.has(k.id))) return false;
    const windows = k.validityWindows ?? [];
    let valid = !windows.length;
    for (const window of windows) {
      const start = instant(window.start), end = instant(window.end);
      boundary(start);
      if (end !== null) boundary(end + 1);
      if ((start === null || start <= at) && (end === null || at <= end)) valid = true;
    }
    return valid;
  }).sort(compareId);
  const current = {past:[], now:[], next:null, later:[], accommodation:[], hire:[],
    parkingKnowledge:relevant.filter(k => k.operationalContext !== false && hasTag(k.tags,'parking') && hasTag(k.tags,'current')).sort(compareId).map(k => k.id)};
  for (const event of leaves) {
    const start = instant(event.temporal?.start), end = instant(event.temporal?.end);
    if (event.commitment === 'completed' || (end !== null && end < at)) {
      current.past.push(event.id);
      continue;
    }
    if (end !== null) boundary(end + 1);
    if (['cancelled','optional'].includes(event.commitment)) continue;
    boundary(start);
    if (start !== null && start > at) {
      if (current.next === null) current.next = event.id;
      else current.later.push(event.id);
    } else if (start !== null && end !== null && at <= end) {
      current.now.push(event.id);
      if (event.accommodation) current.accommodation.push(currentResource(event,relevant));
      if (event.hire) current.hire.push(currentResource(event,relevant));
    }
  }
  return {events:Object.fromEntries(visible.map(e => [e.id,e])), eventTree:tree(visible),
    current, knowledge:relevant, projectedAt:now, nextBoundary};
}

export function packetInputs(packet) {
  const extension = packet.projectionInput?.version === 1 ? packet.projectionInput : null;
  const source = {events:Object.values(packet.events), knowledge:[...(packet.knowledge ?? []), ...(extension?.otherKnowledge ?? [])],
    hiddenChildParents:extension?.hiddenChildParents ?? []};
  // A legacy participant packet can prove some parents from its original
  // classification. Sparse Events supply no such evidence.
  if (!extension && packet.perspectiveParticipantId && Number.isFinite(instant(packet.generatedAt)) && packet.current) {
    const listed = c => [...(c.past ?? []), ...(c.now ?? []), c.next, ...(c.later ?? [])].filter(Boolean);
    const known = new Set(listed(packet.current));
    const reconstructed = projectJourney(source,packet.perspectiveParticipantId,packet.projectedAt ?? packet.generatedAt);
    source.hiddenChildParents = listed(reconstructed.current).filter(id => !known.has(id));
  }
  return source;
}

export function buildTripPacket({trip, events, knowledge}, {perspectiveParticipantId = null, generatedAt = new Date().toISOString(), now = generatedAt} = {}) {
  const visible = events.filter(e => visibleTo(e.participants,perspectiveParticipantId));
  const ids = new Set(visible.map(e => e.id));
  const links = new Set(visible.flatMap(e => e.knowledgeIds ?? []));
  const scoped = knowledge.filter(k => visibleTo(k.participantIds,perspectiveParticipantId) && (k.operationalContext !== false || links.has(k.id)));
  const permitted = scoped.map(k => k.relatedEventIds ? {...k,relatedEventIds:k.relatedEventIds.filter(id => ids.has(id))} : k);
  const hiddenChildParents = [...new Set(events.filter(e => !ids.has(e.id) && ids.has(e.parentEventId)).map(e => e.parentEventId))].sort();
  const view = projectJourney({events:visible.map(eventDescriptor), knowledge:permitted, hiddenChildParents}, perspectiveParticipantId, now);
  const active = new Set(view.knowledge.map(k => k.id));
  return {packetVersion:1, trip, perspectiveParticipantId, generatedAt, revision:packetRevision(trip,events,knowledge),
    ...view, projectionInput:{version:1, hiddenChildParents, otherKnowledge:permitted.filter(k => !active.has(k.id))},
    access:accessManifest(visible), artifactManifest:visible.flatMap(e => e.artifacts.map(a => ({eventId:e.id,...a})))};
}
function tree(events) { const ids=new Set(events.map(e=>e.id)); const children = new Map(); for(const e of events) { const key=ids.has(e.parentEventId) ? e.parentEventId : null; if(!children.has(key))children.set(key,[]); children.get(key).push(e.id); } return Object.fromEntries(children); }
function eventDescriptor(e) { return { id:e.id, revision:e.revision, title:e.title, description:e.description, parentEventId:e.parentEventId, temporal:e.temporal, spatial:e.spatial, movement:e.movement, accommodation:e.accommodation, hire:e.hire, visual:e.visual, booking:e.booking, participants:e.participants, commitment:e.commitment, provenance:e.provenance, ...(e.knowledgeIds?{knowledgeIds:e.knowledgeIds}:{}) }; }
function accessManifest(events) { return events.flatMap(e => (e.booking?.expectedAdmissions ?? []).map(a => ({ eventId:e.id, participantId:a.participantId, requirementId:a.id, status:a.status ?? 'expected', artifactIds:e.artifacts.filter(x => x.satisfiesAdmissionIds?.includes(a.id)).map(x=>x.id) }))); }
function currentResource(event, knowledge) { return { eventId:event.id, location:event.spatial?.location ?? null, checkout:event.temporal?.end ?? null, booking:event.booking, knowledge:knowledge.filter(k=>event.knowledgeIds?event.knowledgeIds.includes(k.id):k.relatedEventIds?.includes(event.id)) }; }
function packetRevision(trip, events, knowledge) { return [trip, ...events, ...knowledge].reduce((hash, x) => ((hash * 31) + x.revision) >>> 0, 17); }
