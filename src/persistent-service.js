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
  async updateTrip(id,patch,expectedRevision) { const current=await this.getTrip(id); return this.repository.updateTrip(this.ownerId,revise(current,patch,expectedRevision),expectedRevision); }
  async createEvent(tripId,input) { await this.getTrip(tripId); await this.#assertParent(tripId,input.parentEventId); return this.repository.insertEvent(newEvent(input,tripId)); }
  async listEvents(tripId) { await this.getTrip(tripId); return this.repository.listEvents(tripId); }
  async getEvent(id) { const item=await this.repository.getEvent(id); await this.getTrip(item.tripId); return item; }
  async updateEvent(id,patch,expectedRevision) { const current=await this.getEvent(id); await this.#assertParent(current.tripId,patch.parentEventId,current.id); return this.repository.updateEvent(revise(current,patch,expectedRevision),expectedRevision); }
  async createKnowledge(tripId,input) { await this.getTrip(tripId); return this.repository.insertKnowledge(newKnowledge(input,tripId)); }
  async listKnowledge(tripId) { await this.getTrip(tripId); return this.repository.listKnowledge(tripId); }
  async getKnowledge(id) { const item=await this.repository.getKnowledge(id); await this.getTrip(item.tripId); return item; }
  async updateKnowledge(id,patch,expectedRevision) { const current=await this.getKnowledge(id); return this.repository.updateKnowledge(revise(current,patch,expectedRevision),expectedRevision); }
  async attachArtifactMetadata(eventId,artifact,expectedRevision) { const event=await this.getEvent(eventId); validateArtifact(artifact); this.#assertArtifactReference(event,artifact); return this.updateEvent(eventId,{artifacts:[...event.artifacts,artifact]},expectedRevision); }
  async storeArtifact(eventId,{id,filename,data,contentType,role,participantIds=[],satisfiesAdmissionIds=[],offlineRequired,version},expectedRevision) { if(!this.artifactStorage) throw new BackendError('Artifact storage is not configured'); const event=await this.getEvent(eventId); const storageRef=await this.artifactStorage.put({tripId:event.tripId,eventId,artifactId:id,filename,data,contentType}); return this.attachArtifactMetadata(eventId,{id,role,participantIds,satisfiesAdmissionIds,mediaType:contentType,storageRef,offlineRequired,version},expectedRevision); }
  async tripContext(tripId,options) { const trip=await this.getTrip(tripId); const [events,knowledge]=await Promise.all([this.repository.listEvents(tripId),this.repository.listKnowledge(tripId)]); return buildTripPacket({trip,events,knowledge},options); }
  async exportTrip(id,format='text') { return exportTrip(await this.#source(id),format); }
  async exportEvent(id,format='text') { return exportEvent(await this.getEvent(id),format); }
  async exportKnowledge(id,format='text') { return exportKnowledge(await this.getKnowledge(id),format); }
  async copyEvent(id,{tripId,title}={}) { const item=await this.getEvent(id); const clone=strip({...item,title:title??`${item.title} (copy)`,parentEventId:null}); return this.createEvent(tripId??item.tripId,clone); }
  async copyKnowledge(id,{tripId,title}={}) { const item=await this.getKnowledge(id); return this.createKnowledge(tripId??item.tripId,strip({...item,title:title??`${item.title} (copy)`})); }
  async copyTrip(id,{title}={}) { const source=await this.#source(id); const copy=await this.createTrip({title:title??`${source.trip.title} (copy)`,description:source.trip.description,lifecycle:'draft',participants:source.trip.participants,presentation:source.trip.presentation}); const ids=new Map(); for(const event of source.events.filter(e=>!e.parentEventId)) await this.#copyEventTree(event,source.events,copy.id,ids); for(const item of source.knowledge) await this.createKnowledge(copy.id,strip({...item,relatedEventIds:item.relatedEventIds.map(old=>ids.get(old)??old)})); return copy; }
  async #copyEventTree(event,all,tripId,ids) { const copied=await this.createEvent(tripId,strip({...event,parentEventId:event.parentEventId?ids.get(event.parentEventId):null})); ids.set(event.id,copied.id); for(const child of all.filter(x=>x.parentEventId===event.id)) await this.#copyEventTree(child,all,tripId,ids); }
  async #source(id) { const trip=await this.getTrip(id); const [events,knowledge]=await Promise.all([this.repository.listEvents(id),this.repository.listKnowledge(id)]); return {trip,events,knowledge}; }
  async #assertParent(tripId,parentId,eventId=null) { if(!parentId) return; if(parentId===eventId) throw new HierarchyError('Event cannot parent itself'); const parent=await this.repository.getEvent(parentId); if(parent.tripId!==tripId) throw new HierarchyError('Parent Event must belong to the same Trip'); if(!eventId) return; const events=await this.repository.listEvents(tripId); const descendants=new Set([eventId]); let changed=true; while(changed){ changed=false; for(const event of events) if(event.parentEventId&&descendants.has(event.parentEventId)&&!descendants.has(event.id)){ descendants.add(event.id); changed=true; } } if(descendants.has(parentId)) throw new HierarchyError('Event cannot be parented beneath its descendant'); }
  #assertArtifactReference(event,artifact) { const ref=artifact.storageRef; if(ref.provider==='supabase-storage' && (ref.bucket!=='porter-artifacts' || ref.key!==`${event.tripId}/${event.id}/${artifact.id}/original`)) throw new TypeError('Supabase artifact storageRef must be Porter-owned for its Trip/Event'); }
}
export class HierarchyError extends Error { constructor(message) { super(message); this.name='HierarchyError'; } }
export class BackendError extends Error { constructor(message) { super(message); this.name='BackendError'; } }
function strip(object) { for(const key of ['id','ownerId','tripId','createdAt','updatedAt','revision']) delete object[key]; return object; }
