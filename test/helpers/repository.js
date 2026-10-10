import { ConflictError } from '../../src/domain.js';
import { NotFoundError } from '../../src/repository.js';
import { aggregateRevisions,assertDeletionRevision,eventSubtree } from '../../src/trip-deletion.js';
export class MemoryRepository {
  trips=new Map();events=new Map();knowledge=new Map();contexts=new Map();
  async deleteEvent(owner,tripId,id,expected){const trip=this.trips.get(tripId);if(!trip||trip.ownerId!==owner||this.events.get(id)?.tripId!==tripId)throw new NotFoundError('Event',id);const events=[...this.events.values()].filter(x=>x.tripId===tripId),knowledge=await this.listKnowledge(tripId);assertDeletionRevision(expected,aggregateRevisions(trip,events,knowledge));const ids=eventSubtree(events,id),artifacts=events.filter(e=>ids.includes(e.id)).flatMap(e=>e.artifacts.map(artifact=>({eventId:e.id,artifact})));ids.forEach(id=>this.events.delete(id));for(const k of this.knowledge.values())k.relatedEventIds=k.relatedEventIds.filter(id=>!ids.includes(id));return {eventIds:ids,artifacts};}
  async deleteTrip(owner,id,expected){const trip=this.trips.get(id);if(!trip||trip.ownerId!==owner)throw new NotFoundError('Trip',id);const events=[...this.events.values()].filter(x=>x.tripId===id),knowledge=await this.listKnowledge(id);assertDeletionRevision(expected,aggregateRevisions(trip,events,knowledge));const artifacts=events.flatMap(e=>e.artifacts.map(artifact=>({eventId:e.id,artifact})));events.forEach(x=>this.events.delete(x.id));for(const k of this.knowledge.values()){k.relatedEventIds=k.relatedEventIds.filter(id=>!events.some(e=>e.id===id));if(k.tripId===id)k.tripId=null;}this.contexts.delete(id);this.trips.delete(id);return {artifacts};}
  async insertTrip(x){this.trips.set(x.id,structuredClone(x));return structuredClone(x);}
  async listTrips(owner){return [...this.trips.values()].filter(x=>x.ownerId===owner).map(x=>structuredClone(x));}
  async getTrip(owner,id){const x=this.trips.get(id);if(!x||x.ownerId!==owner)throw new NotFoundError('Trip',id);return structuredClone(x);}
  async updateTrip(owner,x,expected){await this.getTrip(owner,x.id);return this.update(this.trips,x,expected);}
  async insertEvent(x){this.trips.has(x.tripId)||(()=>{throw new NotFoundError('Trip',x.tripId);})();this.references(x);this.events.set(x.id,structuredClone(x));this.mirror();return structuredClone(x);}
  async listEvents(trip){return [...this.events.values()].filter(x=>x.tripId===trip).map(x=>structuredClone(x));}
  async getEvent(id){const x=this.events.get(id);if(!x)throw new NotFoundError('Event',id);return structuredClone(x);}
  async updateEvent(x,expected){this.references(x);const result=this.update(this.events,x,expected);this.mirror();return result;}
  async insertKnowledge(x){this.knowledge.set(x.id,structuredClone(x));if(x.tripId)await this.associateKnowledge(x.tripId,x);this.legacyLinks(x);this.mirror();return structuredClone(this.knowledge.get(x.id));}
  async listKnowledge(trip){return [...this.knowledge.values()].filter(x=>this.contexts.get(trip)?.has(x.id)||[...this.events.values()].some(e=>e.tripId===trip&&e.knowledgeIds?.includes(x.id))).map(x=>({...structuredClone(x),tripId:trip,...structuredClone(this.contexts.get(trip)?.get(x.id)??{}),relatedEventIds:x.relatedEventIds.filter(id=>this.events.get(id)?.tripId===trip)}));}
  async associateKnowledge(trip,x){if(this.trips.get(trip)?.ownerId!==x.ownerId)throw new NotFoundError('Knowledge',x.id);if(!this.contexts.has(trip))this.contexts.set(trip,new Map());this.contexts.get(trip).set(x.id,{participantIds:structuredClone(x.participantIds),validityWindows:structuredClone(x.validityWindows)});}
  async getKnowledge(id){const x=this.knowledge.get(id);if(!x)throw new NotFoundError('Knowledge',id);return structuredClone(x);}
  async updateKnowledge(x,expected){const previous=this.knowledge.get(x.id),changed=JSON.stringify(previous?.relatedEventIds)!==JSON.stringify(x.relatedEventIds);this.update(this.knowledge,x,expected);if(changed)this.legacyLinks(x);this.mirror();return structuredClone(this.knowledge.get(x.id));}
  references(event){for(const id of event.knowledgeIds??[])if(this.knowledge.get(id)?.ownerId!==this.trips.get(event.tripId)?.ownerId)throw new NotFoundError('Knowledge',id);}
  legacyLinks(k){for(const e of this.events.values())if(e.tripId===k.tripId){const before=e.knowledgeIds?.includes(k.id)??false,after=k.relatedEventIds.includes(e.id);if(before!==after){e.knowledgeIds=after?[...(e.knowledgeIds??[]),k.id]:(e.knowledgeIds??[]).filter(id=>id!==k.id);e.revision++;}}}
  mirror(){for(const k of this.knowledge.values())k.relatedEventIds=[...this.events.values()].filter(e=>e.knowledgeIds?.includes(k.id)).map(e=>e.id).sort();}
  update(map,x,expected){const current=map.get(x.id);if(current?.revision!==expected)throw new ConflictError(x.id,expected,current?.revision);map.set(x.id,structuredClone(x));return structuredClone(x);}
}
