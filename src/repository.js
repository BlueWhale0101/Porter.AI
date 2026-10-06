import { ConflictError } from './domain.js';

export class NotFoundError extends Error { constructor(kind, id) { super(`${kind} not found: ${id}`); this.name='NotFoundError'; } }
export class OwnershipError extends Error { constructor() { super('Authenticated caller does not own this Trip'); this.name='OwnershipError'; } }

export const tripFromRow = row => ({ id:row.id, ownerId:row.owner_id, title:row.title, description:row.description, lifecycle:row.lifecycle, participants:row.participants, presentation:row.presentation, createdAt:row.created_at, updatedAt:row.updated_at, revision:row.revision });
export const tripToRow = trip => ({ id:trip.id, owner_id:trip.ownerId, title:trip.title, description:trip.description, lifecycle:trip.lifecycle, participants:trip.participants, presentation:trip.presentation, created_at:trip.createdAt, updated_at:trip.updatedAt, revision:trip.revision });
export const eventFromRow = row => ({ id:row.id, tripId:row.trip_id, parentEventId:row.parent_event_id, title:row.title, description:row.description, participants:row.participants, temporal:row.temporal, spatial:row.spatial, booking:row.booking, artifacts:row.artifacts, provenance:row.provenance, commitment:row.commitment, visual:row.visual, movement:row.movement, accommodation:row.accommodation, hire:row.hire, createdAt:row.created_at, updatedAt:row.updated_at, revision:row.revision });
export const eventToRow = event => ({ id:event.id, trip_id:event.tripId, parent_event_id:event.parentEventId, title:event.title, description:event.description, participants:event.participants, temporal:event.temporal, spatial:event.spatial, booking:event.booking, artifacts:event.artifacts, provenance:event.provenance, commitment:event.commitment, visual:event.visual, movement:event.movement, accommodation:event.accommodation, hire:event.hire, created_at:event.createdAt, updated_at:event.updatedAt, revision:event.revision });
export const knowledgeFromRow = row => ({ id:row.id, tripId:row.trip_id, title:row.title, content:row.content, relatedEventIds:row.related_event_ids, participantIds:row.participant_ids, validityWindows:row.validity_windows, locations:row.locations, sources:row.sources, tags:row.tags, createdAt:row.created_at, updatedAt:row.updated_at, revision:row.revision });
export const knowledgeToRow = item => ({ id:item.id, trip_id:item.tripId, title:item.title, content:item.content, related_event_ids:item.relatedEventIds, participant_ids:item.participantIds, validity_windows:item.validityWindows, locations:item.locations, sources:item.sources, tags:item.tags, created_at:item.createdAt, updated_at:item.updatedAt, revision:item.revision });

/** Supabase persistence boundary. All methods return Porter domain shapes, never rows. */
export class SupabasePorterRepository {
  constructor(client) { this.client=client; }
  async deleteTrip(ownerId,id,expected) { const {data,error}=await this.client.rpc('porter_app_delete_trip',{p_trip_id:id,p_expected:expected}); if(error?.code==='P0409')throw new ConflictError(id,expected.trip,'aggregate changed');if(error?.code==='P0404')throw new NotFoundError('Trip',id);if(error)throw error;return data; }
  async insertTrip(trip) { return tripFromRow(await one(this.client.from('travel_trips').insert(tripToRow(trip)).select().single())); }
  async listTrips(ownerId) { return (await many(this.client.from('travel_trips').select('*').eq('owner_id',ownerId).order('created_at'))).map(tripFromRow); }
  async getTrip(ownerId,id) { return tripFromRow(await one(this.client.from('travel_trips').select('*').eq('id',id).eq('owner_id',ownerId).maybeSingle(),'Trip',id)); }
  async updateTrip(ownerId,trip,expected) { return tripFromRow(await atomic(this.client.from('travel_trips').update(tripToRow(trip)).eq('id',trip.id).eq('owner_id',ownerId).eq('revision',expected).select().maybeSingle(),trip.id,expected)); }
  async insertEvent(event) { return eventFromRow(await one(this.client.from('travel_events').insert(eventToRow(event)).select().single())); }
  async listEvents(tripId) { return (await many(this.client.from('travel_events').select('*').eq('trip_id',tripId).order('created_at'))).map(eventFromRow); }
  async getEvent(id) { return eventFromRow(await one(this.client.from('travel_events').select('*').eq('id',id).maybeSingle(),'Event',id)); }
  async updateEvent(event,expected) { return eventFromRow(await atomic(this.client.from('travel_events').update(eventToRow(event)).eq('id',event.id).eq('trip_id',event.tripId).eq('revision',expected).select().maybeSingle(),event.id,expected)); }
  async insertKnowledge(item) { return knowledgeFromRow(await one(this.client.from('travel_knowledge').insert(knowledgeToRow(item)).select().single())); }
  async listKnowledge(tripId) { return (await many(this.client.from('travel_knowledge').select('*').eq('trip_id',tripId).order('created_at'))).map(knowledgeFromRow); }
  async getKnowledge(id) { return knowledgeFromRow(await one(this.client.from('travel_knowledge').select('*').eq('id',id).maybeSingle(),'Knowledge',id)); }
  async updateKnowledge(item,expected) { return knowledgeFromRow(await atomic(this.client.from('travel_knowledge').update(knowledgeToRow(item)).eq('id',item.id).eq('trip_id',item.tripId).eq('revision',expected).select().maybeSingle(),item.id,expected)); }
}
async function one(query, kind='Record', id='') { const {data,error}=await query; if(error) throw error; if(!data) throw new NotFoundError(kind,id); return data; }
async function many(query) { const {data,error}=await query; if(error) throw error; return data ?? []; }
async function atomic(query,id,expected) { const {data,error}=await query; if(error) throw error; if(!data) throw new ConflictError(id,expected,'changed or inaccessible'); return data; }
