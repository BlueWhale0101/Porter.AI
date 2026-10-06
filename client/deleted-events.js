import { buildTripPacket } from '../src/projection.js';

// Device-only removal receipts prevent an older in-flight packet restoring deleted IDs.
export function withoutDeletedEvents(packet,ids=[]){
  if(!packet||!ids.length)return packet;
  const removed=new Set(ids);
  const events=Object.values(packet.events).filter(e=>!removed.has(e.id)).map(e=>({...e,artifacts:(packet.artifactManifest??[]).filter(a=>a.eventId===e.id)}));
  const knowledge=packet.knowledge.map(k=>({...k,relatedEventIds:k.relatedEventIds.filter(id=>!removed.has(id))}));
  return {...buildTripPacket({trip:packet.trip,events,knowledge},{perspectiveParticipantId:packet.perspectiveParticipantId,now:packet.generatedAt}),revision:packet.revision};
}
