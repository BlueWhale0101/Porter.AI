import { ConflictError } from './domain.js';

export class NotFoundError extends Error { constructor(kind, id) { super(`${kind} not found: ${id}`); this.name='NotFoundError'; } }
export class OwnershipError extends Error { constructor() { super('Authenticated caller does not own this Trip'); this.name='OwnershipError'; } }

export const tripFromRow = row => ({ id:row.id, ownerId:row.owner_id, title:row.title, description:row.description, lifecycle:row.lifecycle, participants:row.participants, presentation:row.presentation, endDate:row.end_date??null, knowledgePreloadTag:row.knowledge_preload_tag??null, createdAt:row.created_at, updatedAt:row.updated_at, revision:row.revision });
export const tripToRow = trip => ({ id:trip.id, owner_id:trip.ownerId, title:trip.title, description:trip.description, lifecycle:trip.lifecycle, participants:trip.participants, presentation:trip.presentation, end_date:trip.endDate??null, knowledge_preload_tag:trip.knowledgePreloadTag??null, created_at:trip.createdAt, updated_at:trip.updatedAt, revision:trip.revision });
export const eventFromRow = row => ({ id:row.id, tripId:row.trip_id, parentEventId:row.parent_event_id, title:row.title, description:row.description, participants:row.participants, temporal:row.temporal, spatial:row.spatial, booking:row.booking, artifacts:row.artifacts, knowledgeIds:row.knowledgeIds??row.knowledge_ids??(row.travel_event_knowledge??[]).map(x=>x.knowledge_id), provenance:row.provenance, commitment:row.commitment, visual:row.visual, movement:row.movement, accommodation:row.accommodation, hire:row.hire, createdAt:row.created_at, updatedAt:row.updated_at, revision:row.revision });
export const eventToRow = event => ({ id:event.id, trip_id:event.tripId, parent_event_id:event.parentEventId, title:event.title, description:event.description, participants:event.participants, temporal:event.temporal, spatial:event.spatial, booking:event.booking, artifacts:event.artifacts, knowledge_ids:event.knowledgeIds??[], provenance:event.provenance, commitment:event.commitment, visual:event.visual, movement:event.movement, accommodation:event.accommodation, hire:event.hire, created_at:event.createdAt, updated_at:event.updatedAt, revision:event.revision });
export const knowledgeFromRow = row => ({ id:row.id, ownerId:row.owner_id, tripId:row.trip_id??null, title:row.title, content:row.content, planning:row.planning??{}, relatedEventIds:row.related_event_ids, participantIds:row.participant_ids, validityWindows:row.validity_windows, locations:row.locations, sources:row.sources, tags:row.tags, createdAt:row.created_at, updatedAt:row.updated_at, revision:row.revision });
export const knowledgeToRow = item => ({ id:item.id, owner_id:item.ownerId, trip_id:item.tripId??null, title:item.title, content:item.content, planning:item.planning??{}, related_event_ids:item.relatedEventIds, participant_ids:item.participantIds, validity_windows:item.validityWindows, locations:item.locations, sources:item.sources, tags:item.tags, created_at:item.createdAt, updated_at:item.updatedAt, revision:item.revision });

/** Supabase persistence boundary. All methods return Porter domain shapes, never rows. */
export class SupabasePorterRepository {
  constructor(client) { this.client=client; }
  async deleteEvent(ownerId,tripId,id,expected) { const {data,error}=await this.client.rpc('porter_app_delete_event',{p_trip_id:tripId,p_event_id:id,p_expected:expected});if(error?.code==='P0409')throw new ConflictError(id,expected.trip,'aggregate changed');if(error?.code==='P0404')throw new NotFoundError('Event',id);if(error)throw error;return data; }
  async deleteTrip(ownerId,id,expected) { const {data,error}=await this.client.rpc('porter_app_delete_trip',{p_trip_id:id,p_expected:expected}); if(error?.code==='P0409')throw new ConflictError(id,expected.trip,'aggregate changed');if(error?.code==='P0404')throw new NotFoundError('Trip',id);if(error)throw error;return data; }
  async insertTrip(trip) { return tripFromRow(await one(this.client.from('travel_trips').insert(tripToRow(trip)).select().single())); }
  async listTrips(ownerId) { return (await many(this.client.from('travel_trips').select('*').eq('owner_id',ownerId).order('created_at'))).map(tripFromRow); }
  async getTrip(ownerId,id) { return tripFromRow(await one(this.client.from('travel_trips').select('*').eq('id',id).eq('owner_id',ownerId).maybeSingle(),'Trip',id)); }
  async updateTrip(ownerId,trip,expected) { return tripFromRow(await atomic(this.client.from('travel_trips').update(tripToRow(trip)).eq('id',trip.id).eq('owner_id',ownerId).eq('revision',expected).select().maybeSingle(),trip.id,expected)); }
  async insertEvent(event) { return this.writeEvent(event,null); }
  async listEvents(tripId) { return (await many(this.client.from('travel_events').select('*,travel_event_knowledge(knowledge_id)').eq('trip_id',tripId).order('created_at'))).map(eventFromRow); }
  async getEvent(id) { return eventFromRow(await one(this.client.from('travel_events').select('*,travel_event_knowledge(knowledge_id)').eq('id',id).maybeSingle(),'Event',id)); }
  async updateEvent(event,expected) { return this.writeEvent(event,expected); }
  async insertKnowledge(item) { return knowledgeFromRow(await one(this.client.from('travel_knowledge').insert(knowledgeToRow(item)).select().single())); }
  async listKnowledge(tripId,events=null) {
    const contexts=await many(this.client.from('travel_trip_knowledge').select('*,travel_knowledge(*)').eq('trip_id',tripId));
    events??=await this.listEvents(tripId);const eventIds=new Set(events.map(e=>e.id));
    const linkedIds=[...new Set(events.flatMap(e=>e.knowledgeIds))];
    const rows=linkedIds.length?await many(this.client.from('travel_knowledge').select('*').in('id',linkedIds)):[];
    const byId=new Map(rows.map(row=>[row.id,{...knowledgeFromRow(row),participantIds:[],validityWindows:[],operationalContext:false}]));
    for(const context of contexts){const item=knowledgeFromRow(context.travel_knowledge);byId.set(item.id,{...item,participantIds:context.participant_ids,validityWindows:context.validity_windows,operationalContext:true});}
    return [...byId.values()].map(k=>({...k,tripId,relatedEventIds:k.relatedEventIds.filter(id=>eventIds.has(id))})).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  }
  async associateKnowledge(tripId,item){await one(this.client.from('travel_trip_knowledge').upsert({trip_id:tripId,knowledge_id:item.id,participant_ids:item.participantIds,validity_windows:item.validityWindows}).select().single());}
  async writeEvent(event,expected){
    const {data,error}=await this.client.rpc('porter_write_event',{p_event:eventToRow(event),p_knowledge_ids:event.knowledgeIds??[],p_expected:expected});
    if(error?.code==='P0409')throw new ConflictError(event.id,expected,'changed');if(error?.code==='P0404')throw new NotFoundError('Event or Knowledge',event.id);if(error)throw error;
    return eventFromRow({...data,knowledgeIds:event.knowledgeIds??[]});
  }
  async getKnowledge(id) { return knowledgeFromRow(await one(this.client.from('travel_knowledge').select('*').eq('id',id).maybeSingle(),'Knowledge',id)); }
  async updateKnowledge(item,expected,{referencesChanged=false}={}) { const row=knowledgeToRow(item);if(!referencesChanged)delete row.related_event_ids;return knowledgeFromRow(await atomic(this.client.from('travel_knowledge').update(row).eq('id',item.id).eq('owner_id',item.ownerId).eq('revision',expected).select().maybeSingle(),item.id,expected)); }
}
async function one(query, kind='Record', id='') { const {data,error}=await query; if(error) throw error; if(!data) throw new NotFoundError(kind,id); return data; }
async function many(query) { const {data,error}=await query; if(error) throw error; return data ?? []; }
async function atomic(query,id,expected) { const {data,error}=await query; if(error) throw error; if(!data) throw new ConflictError(id,expected,'changed or inaccessible'); return data; }
