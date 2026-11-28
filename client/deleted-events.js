import { packetInputs, projectJourney } from '../src/projection.js';

// Receipts also apply to late candidates and to Knowledge outside today's window.
export function withoutDeletedEvents(packet, ids = []) {
  if (!packet || !ids.length) return packet;
  const removed = new Set(ids);
  const keep = row => !removed.has(row.eventId);
  const input = packetInputs(packet);
  input.events = input.events.filter(e => !removed.has(e.id));
  input.hiddenChildParents = input.hiddenChildParents.filter(id => !removed.has(id));
  const links = new Set(input.events.flatMap(e => e.knowledgeIds ?? []));
  input.knowledge = input.knowledge.filter(k => k.operationalContext !== false || links.has(k.id)).map(k => ({...k, relatedEventIds:(k.relatedEventIds ?? []).filter(id => !removed.has(id))}));
  const view = projectJourney(input, packet.perspectiveParticipantId, packet.projectedAt ?? packet.generatedAt);
  const active = new Set(view.knowledge.map(k => k.id));
  return {...packet, ...view, ...(packet.projectionInput?.version === 1 && {projectionInput:{
    version:1, hiddenChildParents:input.hiddenChildParents, otherKnowledge:input.knowledge.filter(k => !active.has(k.id))
  }}), access:(packet.access ?? []).filter(keep), artifactManifest:(packet.artifactManifest ?? []).filter(keep)};
}
