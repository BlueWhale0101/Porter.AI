import { createHash } from 'node:crypto';
import { hasTag } from './knowledge.js';
import { parkingCaptureId, matchesParking } from './parking.js';
import { newTrip, newEvent, newKnowledge, revise, validateArtifact } from './domain.js';
import { buildTripPacket } from './projection.js';
import { exportTrip, exportEvent, exportKnowledge } from './export.js';
import { NotFoundError, OwnershipError } from './repository.js';

/** Async semantic service used by production/MCP; repository owns persistence details. */
export class PersistentPorterService {
  constructor(repository, ownerId, artifactStorage=null) { this.repository=repository; this.ownerId=ownerId; this.artifactStorage=artifactStorage; }
  async createTrip(input) { return this.repository.insertTrip(newTrip(input,this.ownerId)); }
  async listTrips() { return this.repository.listTrips(this.ownerId); }
  async getTrip(id) { return this.repository.getTrip(this.ownerId,id); }
  async updateTrip(id,patch,expectedRevision) { const current=await this.getTrip(id),next=revise(current,patch,expectedRevision); await this.#assertParticipantRemovals(current,next); return this.repository.updateTrip(this.ownerId,next,expectedRevision); }
  async createEvent(tripId,input,mutationId=null) {
    await this.getTrip(tripId);await this.#assertParent(tripId,input.parentEventId);
    const event=newEvent(input,tripId);
    if(mutationId){
      if(typeof mutationId!=='string'||mutationId.length>128)throw new TypeError('Invalid mutation ID');
      const h=createHash('sha256').update(JSON.stringify([this.ownerId,tripId,mutationId])).digest('hex');
      event.id=`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
      try{return await this.getEvent(event.id);}catch(error){if(!(error instanceof NotFoundError))throw error;}
    }
    await this.#assertKnowledgeReferences(event);
    this.#assertArtifactReferences(event);
    try{return await this.repository.insertEvent(event);}catch(error){if(mutationId){try{return await this.getEvent(event.id);}catch{}}throw error;}
  }
  async listEvents(tripId) { await this.getTrip(tripId); return this.repository.listEvents(tripId); }
  async getEvent(id) { const item=await this.repository.getEvent(id); await this.getTrip(item.tripId); return item; }
  async updateEvent(id,patch,expectedRevision) { const current=await this.getEvent(id); await this.#assertParent(current.tripId,patch.parentEventId,current.id); const event=revise(current,patch,expectedRevision); await this.#assertKnowledgeReferences(event); this.#assertArtifactReferences(event); return this.repository.updateEvent(event,expectedRevision); }
  // Existing client/MCP calls retain their Trip context. New domain callers need no Trip.
  async createKnowledge(tripId,input) {
    if(typeof tripId==='object'){input=tripId;tripId=null;}
    if(tripId)await this.getTrip(tripId);
    if((input.relatedEventIds??[]).length&&!tripId)throw new TypeError('Global Knowledge references are edited on Events');
    for(const id of input.relatedEventIds??[]){const e=await this.getEvent(id);if(e.tripId!==tripId)throw new TypeError('Legacy references must belong to the context Trip');}
    return this.repository.insertKnowledge(newKnowledge(input,this.ownerId,tripId));
  }
  async setCurrentParking(tripId,input) { await this.getTrip(tripId); const existing=await this.repository.listKnowledge(tripId); const captureId=parkingCaptureId(input); const replay=captureId&&existing.find(x=>x.operationalContext!==false&&parkingCaptureId(x)===captureId); if(replay)return replay; for(const item of existing.filter(x=>x.operationalContext!==false&&hasTag(x.tags,'parking')&&hasTag(x.tags,'current'))) await this.updateKnowledge(item.id,{tags:item.tags.filter(tag=>!hasTag([tag],'current'))},item.revision); return this.createKnowledge(tripId,{...input,tags:[...new Set([...(input.tags??[]),'parking','current'])]}); }
  async clearCurrentParking(tripId,target) {
    await this.getTrip(tripId);
    if(!target?.knowledgeId&&!target?.captureId)throw new TypeError('A parking Knowledge or capture ID is required');
    const items=await this.repository.listKnowledge(tripId);
    for(const item of items.filter(x=>x.operationalContext!==false&&hasTag(x.tags,'parking')&&matchesParking(x,target))){
      if(hasTag(item.tags,'current'))await this.updateKnowledge(item.id,{tags:item.tags.filter(tag=>!hasTag([tag],'current'))},item.revision);
    }
    return {cleared:true};
  }
  async listKnowledge(tripId) { await this.getTrip(tripId); return this.repository.listKnowledge(tripId); }
  async getKnowledge(id) { const item=await this.repository.getKnowledge(id); if(item.ownerId!==this.ownerId)throw new NotFoundError('Knowledge',id); return item; }
  async updateKnowledge(id,patch,expectedRevision) { const current=await this.getKnowledge(id); if('relatedEventIds' in patch){if(!current.tripId)throw new TypeError('Global Knowledge references are edited on Events');for(const id of patch.relatedEventIds){const event=await this.getEvent(id);if(event.tripId!==current.tripId&&!current.relatedEventIds.includes(id))throw new TypeError('Legacy references must belong to the context Trip');}} return this.repository.updateKnowledge(revise(current,patch,expectedRevision),expectedRevision,{referencesChanged:Object.hasOwn(patch,'relatedEventIds')}); }
  async attachArtifactMetadata(eventId,artifact,expectedRevision) { const event=await this.getEvent(eventId); validateArtifact(artifact); return this.updateEvent(eventId,{artifacts:[...event.artifacts,artifact]},expectedRevision); }
  async storeArtifact(eventId,{id,filename,data,contentType,role,participantIds=[],satisfiesAdmissionIds=[],offlineRequired,version,sourceUrl,materializeExisting=false},expectedRevision) {
    if(!this.artifactStorage)throw new BackendError('Artifact storage is not configured');
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id??''))throw new TypeError('Artifact ID must be a safe path segment');
    const event=await this.getEvent(eventId),existing=event.artifacts.find(a=>a.id===id);
    if(existing&&(!materializeExisting||existing.storageRef.provider==='supabase-storage'))throw new TypeError('Artifact ID already stored; only external metadata may be materialized');
    const checksum=createHash('sha256').update(data).digest('hex');
    const metadata={id,role,participantIds,satisfiesAdmissionIds,mediaType:contentType,offlineRequired,version:version??checksum,checksum,...(sourceUrl?{sourceUrl}:{})};
    validateArtifact({...metadata,storageRef:{provider:'pending-upload'}});
    const storageRef=await this.artifactStorage.put({tripId:event.tripId,eventId,artifactId:id,filename,data,contentType});
    try{return await this.updateEvent(eventId,{artifacts:existing?event.artifacts.map(a=>a.id===id?{...a,...metadata,storageRef}:a):[...event.artifacts,{...metadata,storageRef}]},expectedRevision);}
    catch(error){try{await this.artifactStorage.delete(storageRef);}catch(cleanupError){error.cleanupError=cleanupError;}throw error;}
  }
  async tripContext(tripId,options) { const trip=await this.getTrip(tripId); const events=await this.repository.listEvents(tripId),knowledge=await this.repository.listKnowledge(tripId,events); return buildTripPacket({trip,events,knowledge},options); }
  async exportTrip(id,format='text') { return exportTrip(await this.#source(id),format); }
  async exportEvent(id,format='text') { return exportEvent(await this.getEvent(id),format); }
  async exportKnowledge(id,format='text') { return exportKnowledge(await this.getKnowledge(id),format); }
  async copyEvent(id,{tripId,title}={}) { const item=await this.getEvent(id); const clone=strip({...item,title:title??`${item.title} (copy)`,parentEventId:null,artifacts:[],provenance:[...item.provenance,{type:'copy',note:'Stored artifacts omitted from copy'}]}); return this.createEvent(tripId??item.tripId,clone); }
  async copyKnowledge(id,{tripId,title}={}) { const item=await this.getKnowledge(id); const input=strip({...item,title:title??`${item.title} (copy)`,relatedEventIds:[]});return tripId?this.createKnowledge(tripId,input):this.createKnowledge(input); }
  async copyTrip(id,{title}={}) { const source=await this.#source(id); const copy=await this.createTrip({title:title??`${source.trip.title} (copy)`,description:source.trip.description,lifecycle:'draft',participants:source.trip.participants,presentation:source.trip.presentation,endDate:source.trip.endDate,knowledgePreloadTag:source.trip.knowledgePreloadTag}); const ids=new Map(); for(const event of source.events.filter(e=>!e.parentEventId)) await this.#copyEventTree(event,source.events,copy.id,ids); for(const item of source.knowledge.filter(k=>k.operationalContext!==false)) await this.repository.associateKnowledge(copy.id,item); return copy; }
  async #copyEventTree(event,all,tripId,ids) { const copied=await this.createEvent(tripId,strip({...event,parentEventId:event.parentEventId?ids.get(event.parentEventId):null,artifacts:[],provenance:[...event.provenance,{type:'copy',note:'Stored artifacts omitted from copy'}]})); ids.set(event.id,copied.id); for(const child of all.filter(x=>x.parentEventId===event.id)) await this.#copyEventTree(child,all,tripId,ids); }
  async #assertKnowledgeReferences(event) { for(const id of event.knowledgeIds??[])await this.getKnowledge(id); }
  async #source(id) { const trip=await this.getTrip(id); const events=await this.repository.listEvents(id),knowledge=await this.repository.listKnowledge(id,events); return {trip,events,knowledge}; }
  async #assertParticipantRemovals(current,next) { const remaining=new Set((next.participants??[]).map(participantId)); const removed=(current.participants??[]).map(participantId).filter(id=>!remaining.has(id)); if(!removed.length)return; const events=await this.repository.listEvents(current.id); const referenced=removed.find(id=>events.some(event=>(event.participants??[]).includes(id))); if(referenced) throw new TypeError(`Participant ${referenced} is referenced by Events and cannot be removed`); }
  async #assertParent(tripId,parentId,eventId=null) { if(!parentId) return; if(parentId===eventId) throw new HierarchyError('Event cannot parent itself'); const parent=await this.repository.getEvent(parentId); if(parent.tripId!==tripId) throw new HierarchyError('Parent Event must belong to the same Trip'); if(!eventId) return; const events=await this.repository.listEvents(tripId); const descendants=new Set([eventId]); let changed=true; while(changed){ changed=false; for(const event of events) if(event.parentEventId&&descendants.has(event.parentEventId)&&!descendants.has(event.id)){ descendants.add(event.id); changed=true; } } if(descendants.has(parentId)) throw new HierarchyError('Event cannot be parented beneath its descendant'); }
  #assertArtifactReferences(event) { for(const artifact of event.artifacts) { const ref=artifact.storageRef; if(ref.provider==='supabase-storage') { const bucket=this.artifactStorage?.bucket; if(!bucket) throw new TypeError('Configured ArtifactStorage is required for Supabase artifact references'); if(ref.bucket!==bucket || ref.key!==`${event.tripId}/${event.id}/${artifact.id}/original`) throw new TypeError('Supabase artifact storageRef must be Porter-owned for its Trip/Event'); } } }
}
export class HierarchyError extends Error { constructor(message) { super(message); this.name='HierarchyError'; } }
export class BackendError extends Error { constructor(message) { super(message); this.name='BackendError'; } }
function strip(object) { for(const key of ['id','ownerId','tripId','createdAt','updatedAt','revision']) delete object[key]; return object; }
const participantId=participant=>typeof participant==='string'?participant:participant?.id;
