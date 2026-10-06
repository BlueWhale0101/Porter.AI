import { ConflictError } from './domain.js';
import { buildTripPacket } from './projection.js';

// Existing source revisions, including records omitted by perspective/validity.
export const aggregateRevisions=(trip,events,knowledge)=>({trip:trip.revision,events:Object.fromEntries(events.map(x=>[x.id,x.revision])),knowledge:Object.fromEntries(knowledge.map(x=>[x.id,x.revision]))});
export function validateDeletionRevision(expected){
  if(!expected||!Number.isSafeInteger(expected.trip)||expected.trip<1||!expected.events||!expected.knowledge)throw new TypeError('Trip deletion requires reviewed source revisions');
  for(const values of [expected.events,expected.knowledge])if(Array.isArray(values)||typeof values!=='object'||Object.values(values).some(x=>!Number.isSafeInteger(x)||x<1))throw new TypeError('Invalid Trip deletion revisions');
}
export function assertDeletionRevision(expected,actual){
  validateDeletionRevision(expected);
  const same=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(id=>a[id]===b[id]);
  if(expected.trip!==actual.trip||!same(expected.events,actual.events)||!same(expected.knowledge,actual.knowledge))throw new ConflictError('Trip',expected.trip,'aggregate changed');
}
// Kept outside the semantic/MCP service: only the authenticated app routes use it.
export async function tripDeletionPreview(service,id){
  const trip=await service.getTrip(id),events=await service.listEvents(id),knowledge=await service.listKnowledge(id);
  return {trip,expected:aggregateRevisions(trip,events,knowledge),packetRevision:buildTripPacket({trip,events,knowledge}).revision,eventCount:events.length,knowledgeCount:knowledge.length};
}
export async function deleteAppTrip(service,id,expected,{logger=entry=>console.warn(JSON.stringify(entry))}={}){
  validateDeletionRevision(expected);await service.getTrip(id);
  const result=await service.repository.deleteTrip(service.ownerId,id,expected);
  return {deleted:true,tripId:id,cleanupPending:await cleanDeletedArtifacts(service,id,result,logger)};
}
export const eventSubtree=(events,id)=>{const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const e of events)if(ids.has(e.parentEventId)&&!ids.has(e.id)){ids.add(e.id);changed=true;}}return [...ids];};
export async function eventDeletionPreview(service,id){const event=await service.getEvent(id),preview=await tripDeletionPreview(service,event.tripId),events=await service.listEvents(event.tripId);return {...preview,event,eventIds:eventSubtree(events,id)};}
export async function deleteAppEvent(service,id,expected,{logger=entry=>console.warn(JSON.stringify(entry))}={}){validateDeletionRevision(expected);const event=await service.getEvent(id),result=await service.repository.deleteEvent(service.ownerId,event.tripId,id,expected);return {deleted:true,tripId:event.tripId,eventIds:result.eventIds,cleanupPending:await cleanDeletedArtifacts(service,event.tripId,result,logger)};}
async function cleanDeletedArtifacts(service,id,result,logger){
  let cleanupPending=0;
  for(const item of result.artifacts??[]){
    const ref=item.artifact?.storageRef;
    if(ref?.provider!=='supabase-storage')continue; // external/shared references stay untouched
    if(!service.artifactStorage||ref.bucket!==service.artifactStorage.bucket||typeof ref.key!=='string'||ref.key.split('/').length!==4||ref.key.split('/').some(x=>x==='.'||x==='..')||ref.key!==`${id}/${item.eventId}/${item.artifact.id}/original`){cleanupPending++;continue;}
    try{await service.artifactStorage.delete(ref);}catch{cleanupPending++;logger({operation:'trip_artifact_cleanup_failed',tripId:id,eventId:item.eventId,artifactId:item.artifact.id});}
  }
  return cleanupPending;
}
