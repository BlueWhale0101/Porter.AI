import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PersistentPorterService} from '../src/persistent-service.js';
import {MemoryRepository} from './helpers/repository.js';
import {ConflictError} from '../src/domain.js';
import {SupabasePorterRepository} from '../src/repository.js';
import {createClientApi,dispatchClientMutation} from '../client-api/server.mjs';
const setup=async()=>{const repo=new MemoryRepository(),service=new PersistentPorterService(repo,'owner'),trip=await service.createTrip({title:'LA'}),k=await service.createKnowledge({title:'Walk',tags:['parking','current','LA']});return {repo,service,trip,k};};
const mutation=(trip,k,active,expectedRevision)=>({tripId:trip.id,knowledgeId:k.id,active,expectedRevision,mutationId:randomUUID()});

test('planning membership preserves global identity and does not activate parking or expand TripPacket',async()=>{
 const {repo,service,trip,k}=await setup(),england=await service.createTrip({title:'England'}),before=await service.getKnowledge(k.id);
 await service.setTripIdea(mutation(trip,k,true,0));await service.setTripIdea(mutation(england,k,true,0));
 for(const t of [trip,england]){const page=await service.tripIdeas(t.id);assert.equal(page.items[0].id,k.id);assert.equal(page.items[0].operationalContext,false);const packet=await service.tripContext(t.id);assert.equal(packet.knowledge.length,0);assert.equal(packet.current.parkingKnowledge.length,0);}
 assert.equal(repo.knowledge.size,1);assert.deepEqual(await service.getKnowledge(k.id),before);
});
test('Trip-local union deduplicates planning, operational and Event sources; queries never scan global records',async()=>{
 const {repo,service,trip,k}=await setup();await service.setTripIdea(mutation(trip,k,true,0));await repo.associateKnowledge(trip.id,k);const e=await service.createEvent(trip.id,{title:'Walk',knowledgeIds:[k.id]});
 const eventOnly=await service.createKnowledge({title:'Museum',tags:['Art']});await service.createEvent(trip.id,{title:'Visit',knowledgeIds:[eventOnly.id]});await service.createKnowledge({title:'Unrelated',tags:['Art']});
 repo.scanGlobalKnowledge=()=>{throw Error('Global scan forbidden');};
 let page=await service.searchKnowledge({tripId:trip.id,limit:1});const ids=page.items.map(k=>k.id);assert.ok(page.nextCursor);page=await service.tripIdeas(trip.id,{limit:1,cursor:page.nextCursor});ids.push(...page.items.map(k=>k.id));assert.deepEqual(new Set(ids),new Set([k.id,eventOnly.id]));assert.equal(ids.length,2);
 page=await service.tripIdeas(trip.id,{tag:'art',query:'museum'});assert.equal(page.items[0].id,eventOnly.id);
 page=await service.tripIdeas(trip.id,{query:'walk'});assert.deepEqual(page.items[0].tripEventIds,[e.id]);assert.equal(page.items[0].operationalContext,true);
});
test('tombstones reject stale remove/re-add; old receipts acknowledge without reapplying',async()=>{
 const {service,trip,k}=await setup(),add=mutation(trip,k,true,0),first=await service.setTripIdea(add);
 assert.deepEqual(await service.setTripIdea(add),first);await service.setTripIdea(mutation(trip,k,false,1));
 assert.deepEqual(await service.setTripIdea(add),first);assert.deepEqual(await service.ideaState(trip.id,k.id),{tripId:trip.id,knowledgeId:k.id,active:false,revision:2});
 await assert.rejects(service.setTripIdea({...add,active:false}),TypeError);
 await assert.rejects(service.setTripIdea(mutation(trip,k,true,0)),ConflictError);
 assert.equal((await service.setTripIdea(mutation(trip,k,true,2))).revision,3);
});
test('disassociation leaves source, operational context and authoritative Event references',async()=>{
 const {service,repo,trip,k}=await setup();await repo.associateKnowledge(trip.id,k);const e=await service.createEvent(trip.id,{title:'Visit',knowledgeIds:[k.id]});await service.setTripIdea(mutation(trip,k,true,0));const source=await service.getKnowledge(k.id),event=await service.getEvent(e.id);
 await service.setTripIdea(mutation(trip,k,false,1));const page=await service.tripIdeas(trip.id);assert.equal(page.items.length,1);assert.equal(page.items[0].ideaAssociation.active,false);assert.deepEqual(await service.getKnowledge(k.id),source);assert.deepEqual(await service.getEvent(e.id),event);assert.equal(page.items[0].operationalContext,true);
});
test('association input and owner isolation apply to read and write paths',async()=>{
 const {repo,service,trip,k}=await setup(),foreign=new PersistentPorterService(repo,'foreign'),theirTrip=await foreign.createTrip({title:'Foreign'});
 await assert.rejects(foreign.setTripIdea(mutation(trip,k,true,0)),/not found/);await assert.rejects(foreign.setTripIdea(mutation(theirTrip,k,true,0)),/not found/);await assert.rejects(foreign.ideaState(trip.id,k.id),/not found/);
 const valid=mutation(trip,k,true,0);for(const patch of [{active:'yes'},{expectedRevision:-1},{expectedRevision:1.5},{expectedRevision:2147483647},{mutationId:null},{mutationId:'bad'},{tripId:null},{knowledgeId:'bad'},{ownerId:'foreign'}])await assert.rejects(service.setTripIdea({...valid,...patch}),TypeError);
});
test('repository maps Ideas RPC data and errors without legacy association upserts',async()=>{
 const calls=[],repo=new SupabasePorterRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:{items:[{id:'k',owner_id:'o',title:'Walk',ideaAssociation:{revision:1},tripEventIds:['e'],operationalContext:false}],nextCursor:null}};}});
 const page=await repo.tripIdeas('o','t',{limit:10,cursor:null,query:'walk',tag:''});assert.equal(page.items[0].ownerId,'o');assert.equal(page.items[0].ideaAssociation.revision,1);assert.deepEqual(page.items[0].tripEventIds,['e']);assert.equal(calls[0].args.p_owner,'o');assert.equal(calls[0].args.p_limit,10);
 for(const [code,type] of [['P0409',ConflictError],['P0404',Error],['22023',TypeError]]){repo.client.rpc=async()=>({error:{code,message:'Invalid payload'}});await assert.rejects(repo.setTripIdea('o',{tripId:'t',knowledgeId:'k',active:true,expectedRevision:0,mutationId:'m'}),type);}
});
test('HTTP Ideas routes and semantic mutation expose versions and retain retry payload',async()=>{
 const {service,trip,k}=await setup(),app=createClientApi(async()=>({service}),{host:'127.0.0.1'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer test','Content-Type':'application/json'};
 try{const input=mutation(trip,k,true,0);assert.equal((await dispatchClientMutation(service,{operation:'setTripIdea',arguments:input})).revision,1);
  const page=await fetch(`${base}/client/trips/${trip.id}/ideas?limit=1`,{headers});assert.equal(page.status,200);assert.equal((await page.json()).items[0].ideaAssociation.revision,1);
  const state=await fetch(`${base}/client/trips/${trip.id}/ideas/${k.id}/association`,{headers});assert.equal((await state.json()).revision,1);
  const stale=await fetch(base+'/client/mutate',{method:'POST',headers,body:JSON.stringify({operation:'setTripIdea',arguments:mutation(trip,k,false,0)})});assert.equal(stale.status,409);
  assert.equal((await fetch(`${base}/client/trips/${trip.id}/ideas?limit=101`,{headers})).status,400);
 }finally{await new Promise(r=>server.close(r));}
});
