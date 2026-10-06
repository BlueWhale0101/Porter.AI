import { ConflictError } from '../../src/domain.js';
import { NotFoundError } from '../../src/repository.js';
import { aggregateRevisions,assertDeletionRevision } from '../../src/trip-deletion.js';
export class MemoryRepository {
  trips=new Map();events=new Map();knowledge=new Map();
  async deleteTrip(owner,id,expected){const trip=this.trips.get(id);if(!trip||trip.ownerId!==owner)throw new NotFoundError('Trip',id);const events=[...this.events.values()].filter(x=>x.tripId===id),knowledge=[...this.knowledge.values()].filter(x=>x.tripId===id);assertDeletionRevision(expected,aggregateRevisions(trip,events,knowledge));const artifacts=events.flatMap(e=>e.artifacts.map(artifact=>({eventId:e.id,artifact})));events.forEach(x=>this.events.delete(x.id));knowledge.forEach(x=>this.knowledge.delete(x.id));this.trips.delete(id);return {artifacts};}
  async insertTrip(x){this.trips.set(x.id,structuredClone(x));return structuredClone(x);}
  async listTrips(owner){return [...this.trips.values()].filter(x=>x.ownerId===owner).map(x=>structuredClone(x));}
  async getTrip(owner,id){const x=this.trips.get(id);if(!x||x.ownerId!==owner)throw new NotFoundError('Trip',id);return structuredClone(x);}
  async updateTrip(owner,x,expected){await this.getTrip(owner,x.id);return this.update(this.trips,x,expected);}
  async insertEvent(x){this.events.set(x.id,structuredClone(x));return structuredClone(x);}
  async listEvents(trip){return [...this.events.values()].filter(x=>x.tripId===trip).map(x=>structuredClone(x));}
  async getEvent(id){const x=this.events.get(id);if(!x)throw new NotFoundError('Event',id);return structuredClone(x);}
  async updateEvent(x,expected){return this.update(this.events,x,expected);}
  async insertKnowledge(x){this.knowledge.set(x.id,structuredClone(x));return structuredClone(x);}
  async listKnowledge(trip){return [...this.knowledge.values()].filter(x=>x.tripId===trip).map(x=>structuredClone(x));}
  async getKnowledge(id){const x=this.knowledge.get(id);if(!x)throw new NotFoundError('Knowledge',id);return structuredClone(x);}
  async updateKnowledge(x,expected){return this.update(this.knowledge,x,expected);}
  update(map,x,expected){const current=map.get(x.id);if(current?.revision!==expected)throw new ConflictError(x.id,expected,current?.revision);map.set(x.id,structuredClone(x));return structuredClone(x);}
}
