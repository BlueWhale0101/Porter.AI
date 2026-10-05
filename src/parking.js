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
  let parking = (packet.current.parkingKnowledge ?? []).map(id => packet.knowledge.find(k => k.id === id)).filter(Boolean);
  for (const raw of mutations) {
    const mutation=parkingMutation(raw);
    const args = mutation.arguments ?? {};
    if (args.tripId !== packet.trip.id) continue;
    if (mutation.operation === 'setCurrentParking') parking = [{...args.knowledge, id:`pending:${mutation.id}`, pending:true}];
    if (mutation.operation === 'clearCurrentParking') parking = parking.filter(item => !matchesParking(item,args));
  }
  return parking;
}
