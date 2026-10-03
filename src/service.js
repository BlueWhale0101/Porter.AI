import { newTrip, newEvent, newKnowledge, revise } from './domain.js';
import { buildTripPacket } from './projection.js';
import { exportEvent, exportKnowledge, exportTrip } from './export.js';

export class PorterService {
  constructor() { this.trips = new Map(); this.events = new Map(); this.knowledge = new Map(); }
  createTrip(ownerId, input) { const trip = newTrip(input, ownerId); this.trips.set(trip.id, trip); return trip; }
  listTrips(ownerId) { return [...this.trips.values()].filter(t => t.ownerId === ownerId); }
  getTrip(ownerId, id) { return this.#owned(ownerId, this.trips, id); }
  updateTrip(ownerId,id,patch,revision) { return this.#update(ownerId,this.trips,id,patch,revision); }
  createEvent(ownerId,tripId,input) { this.getTrip(ownerId,tripId); if (input.parentEventId && this.getEvent(ownerId,input.parentEventId).tripId !== tripId) throw new Error('Parent Event must belong to the same Trip'); const event = newEvent(input,tripId); this.events.set(event.id,event); return event; }
  getEvent(ownerId,id) { const e=this.events.get(id); this.getTrip(ownerId,e?.tripId); return e; }
  updateEvent(ownerId,id,patch,revision) { const e=this.getEvent(ownerId,id); const next=revise(e,patch,revision); this.events.set(id,next); return next; }
  createKnowledge(ownerId,tripId,input) { this.getTrip(ownerId,tripId); const item=newKnowledge(input,tripId); this.knowledge.set(item.id,item); return item; }
  getKnowledge(ownerId,id) { const k=this.knowledge.get(id); this.getTrip(ownerId,k?.tripId); return k; }
  updateKnowledge(ownerId,id,patch,revision) { const k=this.getKnowledge(ownerId,id); const next=revise(k,patch,revision); this.knowledge.set(id,next); return next; }
  attachArtifact(ownerId,eventId,artifact,revision) { const e=this.getEvent(ownerId,eventId); return this.updateEvent(ownerId,eventId,{artifacts:[...e.artifacts,artifact]},revision); }
  tripContext(ownerId,tripId,options) { const trip=this.getTrip(ownerId,tripId); return buildTripPacket({trip,events:[...this.events.values()].filter(e=>e.tripId===tripId),knowledge:[...this.knowledge.values()].filter(k=>k.tripId===tripId)},options); }
  exportTrip(ownerId,id,format='text') { const packet=this.#source(ownerId,id); return exportTrip(packet,format); }
  exportEvent(ownerId,id,format='text') { return exportEvent(this.getEvent(ownerId,id),format); }
  exportKnowledge(ownerId,id,format='text') { return exportKnowledge(this.getKnowledge(ownerId,id),format); }
  copyTrip(ownerId,id,{title}={}) { const source=this.#source(ownerId,id); const copied=this.createTrip(ownerId,{title:title ?? `${source.trip.title} (copy)`,description:source.trip.description,lifecycle:'draft',participants:source.trip.participants,presentation:source.trip.presentation}); const ids=new Map(); for(const e of source.events) { const clone={...e,title:e.title, parentEventId:e.parentEventId ? ids.get(e.parentEventId) : null}; delete clone.id; delete clone.tripId; delete clone.createdAt; delete clone.updatedAt; delete clone.revision; ids.set(e.id,this.createEvent(ownerId,copied.id,clone).id); } for(const k of source.knowledge) { const clone={...k,relatedEventIds:k.relatedEventIds.map(old=>ids.get(old)??old)}; for(const key of ['id','tripId','createdAt','updatedAt','revision']) delete clone[key]; this.createKnowledge(ownerId,copied.id,clone); } return copied; }
  copyEvent(ownerId,id,{tripId,title}={}) { const source=this.getEvent(ownerId,id); const clone={...source,title:title ?? `${source.title} (copy)`,parentEventId:null}; for(const key of ['id','tripId','createdAt','updatedAt','revision']) delete clone[key]; return this.createEvent(ownerId,tripId ?? source.tripId,clone); }
  copyKnowledge(ownerId,id,{tripId,title}={}) { const source=this.getKnowledge(ownerId,id); const clone={...source,title:title ?? `${source.title} (copy)`}; for(const key of ['id','tripId','createdAt','updatedAt','revision']) delete clone[key]; return this.createKnowledge(ownerId,tripId ?? source.tripId,clone); }
  #source(ownerId,id) { const trip=this.getTrip(ownerId,id); return {trip,events:[...this.events.values()].filter(e=>e.tripId===id),knowledge:[...this.knowledge.values()].filter(k=>k.tripId===id)}; }
  #owned(ownerId,map,id) { const item=map.get(id); if(!item || item.ownerId !== ownerId) throw new Error('Travel object not found'); return item; }
  #update(ownerId,map,id,patch,revision) { const current=this.#owned(ownerId,map,id); const next=revise(current,patch,revision); map.set(id,next); return next; }
}
