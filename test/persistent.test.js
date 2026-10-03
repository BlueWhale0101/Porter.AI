import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentPorterService, HierarchyError } from '../src/persistent-service.js';
import { ConflictError } from '../src/domain.js';
import { NotFoundError, SupabasePorterRepository, tripFromRow, tripToRow, eventFromRow, eventToRow, knowledgeFromRow, knowledgeToRow } from '../src/repository.js';
import { SupabaseArtifactStorage } from '../src/supabase-storage.js';
import { errorCode, mcpError } from '../mcp/server.mjs';
import { createPorterMcpServer, bearerToken } from '../mcp/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

class MemoryRepository {
  constructor() { this.trips=new Map(); this.events=new Map(); this.knowledge=new Map(); }
  async insertTrip(x){this.trips.set(x.id,structuredClone(x));return structuredClone(x);} async listTrips(owner){return [...this.trips.values()].filter(x=>x.ownerId===owner).map(x=>structuredClone(x));} async getTrip(owner,id){const x=this.trips.get(id);if(!x||x.ownerId!==owner)throw new NotFoundError('Trip',id);return structuredClone(x);} async updateTrip(owner,x,expected){await this.getTrip(owner,x.id);return this.#update(this.trips,x,expected);}
  async insertEvent(x){this.events.set(x.id,structuredClone(x));return structuredClone(x);} async listEvents(trip){return [...this.events.values()].filter(x=>x.tripId===trip).map(x=>structuredClone(x));} async getEvent(id){const x=this.events.get(id);if(!x)throw new NotFoundError('Event',id);return structuredClone(x);} async updateEvent(x,expected){return this.#update(this.events,x,expected);}
  async insertKnowledge(x){this.knowledge.set(x.id,structuredClone(x));return structuredClone(x);} async listKnowledge(trip){return [...this.knowledge.values()].filter(x=>x.tripId===trip).map(x=>structuredClone(x));} async getKnowledge(id){const x=this.knowledge.get(id);if(!x)throw new NotFoundError('Knowledge',id);return structuredClone(x);} async updateKnowledge(x,expected){return this.#update(this.knowledge,x,expected);}
  #update(map,x,expected){const current=map.get(x.id);if(!current||current.revision!==expected)throw new ConflictError(x.id,expected,current?.revision??'missing');map.set(x.id,structuredClone(x));return structuredClone(x);}
}
const setup=async()=>{const repo=new MemoryRepository();const service=new PersistentPorterService(repo,'owner-a');const trip=await service.createTrip({title:'LA'});return {repo,service,trip};};

test('row translators round-trip all three Porter domain objects without snake_case leakage', async()=>{
  const {service,trip}=await setup(); const event=await service.createEvent(trip.id,{title:'Flight'}); const knowledge=await service.createKnowledge(trip.id,{title:'Room',content:'814'});
  assert.deepEqual(tripFromRow(tripToRow(trip)),trip); assert.deepEqual(eventFromRow(eventToRow(event)),event); assert.deepEqual(knowledgeFromRow(knowledgeToRow(knowledge)),knowledge);
});
test('persistent service enforces ownership and atomic revision conflicts', async()=>{
  const {service,trip}=await setup(); const other=new PersistentPorterService(service.repository,'owner-b'); await assert.rejects(other.getTrip(trip.id),NotFoundError); const changed=await service.updateTrip(trip.id,{title:'Changed'},1); assert.equal(changed.revision,2); await assert.rejects(service.updateTrip(trip.id,{title:'Lost'},1),ConflictError);
});
test('Supabase adapter applies expected revision in its atomic update predicate', async()=>{
  const calls=[]; const query={update:value=>{calls.push(['update',value]);return query;},eq:(field,value)=>{calls.push(['eq',field,value]);return query;},select:()=>query,maybeSingle:async()=>({data:null,error:null})}; const repository=new SupabasePorterRepository({from:table=>{assert.equal(table,'travel_trips');return query;}}); const {trip}=await setup();
  await assert.rejects(repository.updateTrip('owner-a',{...trip,title:'new',revision:2},1),ConflictError); assert.deepEqual(calls.find(x=>x[1]==='revision'),['eq','revision',1]);
});
test('persistent service rejects self, descendant, and cross-Trip parents', async()=>{
  const {service,trip}=await setup(); const parent=await service.createEvent(trip.id,{title:'Parent'}); const child=await service.createEvent(trip.id,{title:'Child',parentEventId:parent.id}); const second=await service.createTrip({title:'Other'});
  await assert.rejects(service.updateEvent(parent.id,{parentEventId:parent.id},parent.revision),HierarchyError); await assert.rejects(service.updateEvent(parent.id,{parentEventId:child.id},parent.revision),HierarchyError); await assert.rejects(service.createEvent(second.id,{title:'Bad',parentEventId:parent.id}),HierarchyError);
});
test('persistent get_trip_context and source export preserve projection semantics', async()=>{
  const {service,trip}=await setup(); const hotel=await service.createEvent(trip.id,{title:'Hotel',accommodation:true,temporal:{start:'2026-11-22T00:00:00Z',end:'2026-11-24T00:00:00Z'}}); await service.createKnowledge(trip.id,{title:'Room',content:'814',relatedEventIds:[hotel.id]}); const context=await service.tripContext(trip.id,{now:'2026-11-23T12:00:00Z'}); const source=JSON.parse(await service.exportTrip(trip.id,'json'));
  assert.equal(context.current.accommodation[0].knowledge[0].content,'814'); assert.equal(source.events[0].id,hotel.id);
});
test('artifact metadata rejects malformed or foreign Supabase references', async()=>{
  const {service,trip}=await setup(); const foreign={id:'ticket',role:'ticket',mediaType:'application/pdf',storageRef:{provider:'supabase-storage',bucket:'porter-artifacts',key:'foreign'},offlineRequired:true,version:'v1'}; const event=await service.createEvent(trip.id,{title:'Opera'}); await assert.rejects(service.attachArtifactMetadata(event.id,{id:'ticket'},event.revision),/role is required/); await assert.rejects(service.attachArtifactMetadata(event.id,foreign,event.revision),/Porter-owned/); await assert.rejects(service.createEvent(trip.id,{title:'Bypass',artifacts:[foreign]}),/Porter-owned/); await assert.rejects(service.updateEvent(event.id,{artifacts:[foreign]},event.revision),/Porter-owned/);
});
test('Supabase Storage provider owns Porter paths and verifies checksums through a client seam', async()=>{
  const objects=new Map(); const client={storage:{from:bucket=>({upload:async(key,data)=>{objects.set(`${bucket}/${key}`,data);return {error:null};},download:async key=>({data:new Blob([objects.get(`${bucket}/${key}`)]),error:null}),remove:async keys=>{keys.forEach(k=>objects.delete(`${bucket}/${k}`));return {error:null};},list:async()=>({data:[{name:'original'}],error:null}),createSignedUrl:async key=>({data:{signedUrl:`https://signed/${bucket}/${key}`},error:null})})}}; const store=new SupabaseArtifactStorage(client,'porter-artifacts'); const ref=await store.put({tripId:'trip',eventId:'event',artifactId:'artifact',filename:'pass.pdf',data:'hello',contentType:'text/plain'});
  assert.equal(await store.exists(ref),true); assert.equal(await store.checksum(ref),'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'); assert.match((await store.downloadReference(ref)).url,/signed/); await store.delete(ref);
});
test('MCP failures use structured semantic codes', ()=>{ const result=mcpError(new HierarchyError('cycle')); assert.equal(errorCode(new ConflictError('x',1,2)),'revision_conflict'); assert.equal(JSON.parse(result.content[0].text).error.code,'invalid_hierarchy'); });
test('MCP server invokes semantic create_trip and get_trip_context tools end-to-end', async()=>{
  const {service}=await setup(); const server=createPorterMcpServer(service); const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair(); const client=new Client({name:'porter-mcp-test',version:'1.0.0'}); await server.connect(serverTransport); await client.connect(clientTransport); const created=await client.callTool({name:'create_trip',arguments:{trip:{title:'MCP trip'}}}); const trip=JSON.parse(created.content[0].text); const context=await client.callTool({name:'get_trip_context',arguments:{tripId:trip.id,now:'2026-11-23T12:00:00Z'}}); assert.equal(JSON.parse(context.content[0].text).trip.title,'MCP trip'); await client.close(); await server.close();
});
test('MCP bearer parsing rejects missing identity', ()=>{ assert.equal(bearerToken('Bearer token-value'),'token-value'); assert.throws(()=>bearerToken(),/required/); });
