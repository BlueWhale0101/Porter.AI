import { matchesParking, parkingCaptureId } from '../src/parking.js';
import { packetInputs } from '../src/projection.js';
import { hasTag } from '../src/knowledge.js';

// Read other usable selections only when there is a durable receipt to retire.
export async function cachedSelections(store, packet) {
  const selected = packet.perspectiveParticipantId ?? null;
  const perspectives = new Set([null,...(packet.trip.participants ?? []).map(p => p.id ?? p)]);
  perspectives.delete(selected);
  const others = await Promise.all([...perspectives].map(p => store.getPacket(packet.trip.id,p)));
  return [packet,...others.filter(row => row?.meta?.usable).map(row => row.packet)];
}

// A late or participant-filtered packet cannot retire another perspective's
// overlay. Keep the receipt until every usable cached selection has caught up.
export async function retireParkingReceipts(store, packet) {
  const receipts = (await store.allMutations()).filter(m => m.state === 'acknowledged' &&
    m.arguments?.tripId === packet.trip.id && ['setCurrentParking','clearCurrentParking'].includes(m.operation));
  if (!receipts.length) return;
  const selections = await cachedSelections(store,packet);
  if (selections.some(p => p.projectionInput?.version !== 1)) return;
  const inputs = selections.map(p => ({perspective:p.perspectiveParticipantId,knowledge:packetInputs(p).knowledge}));
  const ready = new Set(receipts.filter(m => inputs.every(({perspective,knowledge}) => {
    if (m.operation === 'setCurrentParking') {
      const item = m.result ?? m.arguments.knowledge;
      if (perspective && item?.participantIds?.length && !item.participantIds.includes(perspective)) return true;
      return knowledge.some(k => matchesParking(k,{knowledgeId:item?.id,captureId:parkingCaptureId(item) ?? m.id}));
    }
    return !knowledge.some(k => k.operationalContext !== false && matchesParking(k,m.arguments) && hasTag(k.tags,'current'));
  })).map(m => m.id));
  // Clear after an unreconciled capture must continue masking that capture.
  for (const receipt of receipts) {
    if (!ready.has(receipt.id)) break;
    await store.settleMutation(receipt.id);
  }
}
