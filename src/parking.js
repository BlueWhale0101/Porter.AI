import { packetInputs, projectJourney } from './projection.js';
import { hasTag } from './knowledge.js';
// Capture identity is provenance on ordinary Knowledge, not a new domain type.
export const parkingCaptureId = item => item?.sources?.find(x => x.type === 'porter-parking-capture')?.id ?? null;
export const matchesParking = (item, target) => Boolean(
  (target.knowledgeId && item.id === target.knowledgeId) ||
  (target.captureId && parkingCaptureId(item) === target.captureId)
);

// Upgrade queued captures from older clients without changing their mutation ID.
export function parkingMutation(mutation) {
  const knowledge=mutation.arguments?.knowledge;
  if(mutation.operation!=='setCurrentParking'||!knowledge||parkingCaptureId(knowledge))return mutation;
  return {...mutation,arguments:{...mutation.arguments,knowledge:{...knowledge,sources:[...(knowledge.sources??[]),{type:'porter-parking-capture',id:mutation.id}]}}};
}

export function parkingProjection(packet, mutations = []) {
  let view = packet;
  if (mutations.length) {
    const source = packetInputs(packet);
    source.knowledge = withParkingOperations(source.knowledge,mutations,packet.trip.id);
    view = projectJourney(source,packet.perspectiveParticipantId,packet.projectedAt ?? new Date().toISOString());
  }
  const items = new Map((view.knowledge ?? []).map(k => [k.id,k]));
  return (view.current.parkingKnowledge ?? []).map(id => items.get(id)).filter(Boolean);
}

// Apply captures to all scoped rows before validity and perspective evaluation.
export function withParkingOperations(knowledge, mutations, tripId) {
  let rows = knowledge;
  for (const raw of mutations) {
    const {operation, arguments:args, result, state, id} = parkingMutation(raw);
    if (args?.tripId !== tripId || !['setCurrentParking','clearCurrentParking'].includes(operation)) continue;
    const capture = result?.id ? result : args.knowledge;
    if (operation === 'setCurrentParking' && !capture) continue;
    if (operation === 'setCurrentParking' && state === 'acknowledged' &&
        rows.some(k => k.id === capture.id || matchesParking(k,{captureId:parkingCaptureId(capture)}))) continue;
    rows = rows.map(k => {
      if (k.operationalContext === false || !hasTag(k.tags,'parking') || !hasTag(k.tags,'current')) return k;
      if (operation === 'clearCurrentParking' && !matchesParking(k,args)) return k;
      return {...k,tags:k.tags.filter(t => !hasTag([t],'current'))};
    });
    if (operation === 'setCurrentParking') rows = [...rows,{...capture,id:capture.id ?? 'pending:'+id,
      pending:state !== 'acknowledged',tags:[...new Set([...(capture.tags ?? []),'parking','current'])]}];
  }
  return rows;
}
