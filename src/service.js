import { newTrip, newEvent, newKnowledge, revise } from './domain.js';
import { buildTripPacket } from './projection.js';
import { exportEvent, exportKnowledge, exportTrip } from './export.js';

export class PorterService {
  constructor() { this.contexts=new Map(); this.trips = new Map(); this.events = new Map(); this.knowledge = new Map(); }
  createTrip(ownerId, input) { const trip = newTrip(input, ownerId); this.trips.set(trip.id, trip); return trip; }
  listTrips(ownerId) { return [...this.trips.values()].filter(t => t.ownerId === ownerId); }
  getTrip(ownerId, id) { return this.#owned(ownerId, this.trips, id); }
  updateTrip(ownerId,id,patch,revision) { const current=this.getTrip(ownerId,id),next=revise(current,patch,revision); this.#assertParticipantRemovals(current,next,[...this.events.values()].filter(event=>event.tripId===id)); this.trips.set(id,next); return next; }
  createEvent(ownerId,tripId,input) { this.getTrip(ownerId,tripId); if (input.parentEventId && this.getEvent(ownerId,input.parentEventId).tripId !== tripId) throw new Error('Parent Event must belong to the same Trip'); const event = newEvent(input,tripId); for(const id of event.knowledgeIds)this.getKnowledge(ownerId,id); this.events.set(event.id,event); return event; }
  listEvents(ownerId,tripId) { this.getTrip(ownerId,tripId); return [...this.events.values()].filter(e => e.tripId === tripId); }
  getEvent(ownerId,id) { const e=this.events.get(id); this.getTrip(ownerId,e?.tripId); return e; }
  updateEvent(ownerId,id,patch,revision) { const e=this.getEvent(ownerId,id); if (patch.parentEventId && this.getEvent(ownerId,patch.parentEventId).tripId !== e.tripId) throw new Error('Parent Event must belong to the same Trip'); const next=revise(e,patch,revision); for(const id of next.knowledgeIds)this.getKnowledge(ownerId,id); this.events.set(id,next); return next; }
  createKnowledge(ownerId,tripId,input) {
    if(typeof tripId==='object'){input=tripId;tripId=null;}
    if(tripId)this.getTrip(ownerId,tripId);
    if(!tripId&&(input.relatedEventIds??[]).length)throw new TypeError('Global Knowledge references are edited on Events');
    const item=newKnowledge(input,ownerId,tripId);
    for(const id of item.relatedEventIds){const event=this.getEvent(ownerId,id);if(event.tripId!==tripId)throw new TypeError('Legacy references must belong to the context Trip');}
    this.knowledge.set(item.id,item);
    if(tripId){if(!this.contexts.has(tripId))this.contexts.set(tripId,new Set());this.contexts.get(tripId).add(item.id);}
    this.#legacyLinks(item);return this.getKnowledge(ownerId,item.id);
  }
  listKnowledge(ownerId,tripId) { this.getTrip(ownerId,tripId);return this.#knowledgeForTrip(tripId); }
  getKnowledge(ownerId,id) { const k=this.#owned(ownerId,this.knowledge,id);return {...k,relatedEventIds:[...this.events.values()].filter(e=>e.knowledgeIds?.includes(id)).map(e=>e.id).sort()}; }
  updateKnowledge(ownerId,id,patch,revision) {
    const current=this.getKnowledge(ownerId,id),next=revise(current,patch,revision);
    if('relatedEventIds' in patch){if(!current.tripId)throw new TypeError('Global Knowledge references are edited on Events');for(const eid of patch.relatedEventIds){if(this.getEvent(ownerId,eid).tripId!==current.tripId)throw new TypeError('Legacy references must belong to the context Trip');}}
    this.knowledge.set(id,next);if('relatedEventIds' in patch)this.#legacyLinks(next);return this.getKnowledge(ownerId,id);
  }
  #legacyLinks(item){for(const e of this.events.values())if(e.tripId===item.tripId){const before=e.knowledgeIds?.includes(item.id)??false,after=item.relatedEventIds.includes(e.id);if(before!==after){e.knowledgeIds=after?[...(e.knowledgeIds??[]),item.id]:(e.knowledgeIds??[]).filter(id=>id!==item.id);e.revision++;}}}
  #knowledgeForTrip(tripId){const events=[...this.events.values()].filter(e=>e.tripId===tripId);return [...this.knowledge.values()].filter(k=>this.contexts.get(tripId)?.has(k.id)||events.some(e=>e.knowledgeIds?.includes(k.id))).map(k=>({...k,tripId,operationalContext:Boolean(this.contexts.get(tripId)?.has(k.id)),...(this.contexts.get(tripId)?.has(k.id)?{}:{participantIds:[],validityWindows:[]}),relatedEventIds:events.filter(e=>e.knowledgeIds?.includes(k.id)).map(e=>e.id)}));}
  attachArtifact(ownerId,eventId,artifact,revision) { const e=this.getEvent(ownerId,eventId); return this.updateEvent(ownerId,eventId,{artifacts:[...e.artifacts,artifact]},revision); }
  tripContext(ownerId,tripId,options) { const trip=this.getTrip(ownerId,tripId); return buildTripPacket({trip,events:[...this.events.values()].filter(e=>e.tripId===tripId),knowledge:this.#knowledgeForTrip(tripId)},options); }
  exportTrip(ownerId,id,format='text') { const packet=this.#source(ownerId,id); return exportTrip(packet,format); }
  exportEvent(ownerId,id,format='text') { return exportEvent(this.getEvent(ownerId,id),format); }
  exportKnowledge(ownerId,id,format='text') { return exportKnowledge(this.getKnowledge(ownerId,id),format); }
  copyTrip(ownerId,id,{title}={}) { const source=this.#source(ownerId,id); const copied=this.createTrip(ownerId,{title:title ?? `${source.trip.title} (copy)`,description:source.trip.description,lifecycle:'draft',participants:source.trip.participants,presentation:source.trip.presentation,endDate:source.trip.endDate,knowledgePreloadTag:source.trip.knowledgePreloadTag}); const ids=new Map(); for(const e of source.events) { const clone={...e,title:e.title, parentEventId:e.parentEventId ? ids.get(e.parentEventId) : null}; delete clone.id; delete clone.tripId; delete clone.createdAt; delete clone.updatedAt; delete clone.revision; ids.set(e.id,this.createEvent(ownerId,copied.id,clone).id); } for(const k of source.knowledge.filter(k=>k.operationalContext!==false)){if(!this.contexts.has(copied.id))this.contexts.set(copied.id,new Set());this.contexts.get(copied.id).add(k.id);} return copied; }
  copyEvent(ownerId,id,{tripId,title}={}) { const source=this.getEvent(ownerId,id); const clone={...source,title:title ?? `${source.title} (copy)`,parentEventId:null}; for(const key of ['id','tripId','createdAt','updatedAt','revision']) delete clone[key]; return this.createEvent(ownerId,tripId ?? source.tripId,clone); }
  copyKnowledge(ownerId,id,{tripId,title}={}) { const source=this.getKnowledge(ownerId,id); const clone={...source,title:title ?? `${source.title} (copy)`}; for(const key of ['id','tripId','createdAt','updatedAt','revision']) delete clone[key]; return this.createKnowledge(ownerId,tripId ?? source.tripId,clone); }
  #source(ownerId,id) { const trip=this.getTrip(ownerId,id); return {trip,events:[...this.events.values()].filter(e=>e.tripId===id),knowledge:this.#knowledgeForTrip(id)}; }
  #owned(ownerId,map,id) { const item=map.get(id); if(!item || item.ownerId !== ownerId) throw new Error('Travel object not found'); return item; }
  #update(ownerId,map,id,patch,revision) { const current=this.#owned(ownerId,map,id); const next=revise(current,patch,revision); map.set(id,next); return next; }
  #assertParticipantRemovals(current,next,events) { const remaining=new Set((next.participants??[]).map(participantId)); for(const participant of current.participants??[]) { const id=participantId(participant); if(!remaining.has(id)&&events.some(event=>(event.participants??[]).includes(id))) throw new Error(`Participant ${id} is referenced by Events and cannot be removed`); } }
}
const participantId=participant=>typeof participant==='string'?participant:participant?.id;
