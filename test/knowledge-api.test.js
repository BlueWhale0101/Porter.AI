import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentPorterService } from '../src/persistent-service.js';
import { SupabasePorterRepository } from '../src/repository.js';
import { MemoryRepository } from './helpers/repository.js';
import { createClientApi } from '../client-api/server.mjs';
import { AuthenticationError } from '../src/runtime.js';
import { knowledgeApi } from '../client/knowledge-api.js';
const setup=()=>{const repo=new MemoryRepository();return {repo,service:new PersistentPorterService(repo,'owner')};};

test('bounded search traverses empty pages; titles, notes, normalized tags and owner isolation',async()=>{
 const {repo,service}=setup();
 for(let i=1;i<=5;i++)repo.knowledge.set(`00000000-0000-0000-0000-00000000000${i}`,{id:`00000000-0000-0000-0000-00000000000${i}`,ownerId:i===5?'foreign':'owner',title:i===3?'ＭＵＳＥＵＭ':'Pub',content:i===4?'Walk by river':'',tags:i===2?[' ＬＡ ']:[],relatedEventIds:[]});
 const first=await service.searchKnowledge({query:'museum',limit:2});assert.equal(first.items.length,0);assert.equal(first.scanned,2);assert.ok(first.nextCursor);
 const second=await service.searchKnowledge({query:'museum',limit:2,cursor:first.nextCursor});assert.equal(second.items.length,1);assert.equal(second.items[0].title,'ＭＵＳＥＵＭ');assert.equal(second.nextCursor,null);
 assert.equal((await service.searchKnowledge({tag:'la'})).items.length,1);
 assert.equal((await service.searchKnowledge({query:'river'})).items.length,1);
 assert.equal((await service.searchKnowledge({query:'la'})).items.length,1);
 assert.equal((await service.searchKnowledge()).items.length,4);
 for(const input of [{limit:0},{limit:101},{limit:'2'},{cursor:'invalid'},{tripId:'invalid'},{query:[]},{tag:['la']},{query:'a'.repeat(501)},{unknown:1}])await assert.rejects(service.searchKnowledge(input),TypeError);
});
test('Trip scope is an explicit association, global records and derived Event links stay separate',async()=>{
 const {service,repo}=setup(),la=await service.createTrip({title:'LA'}),england=await service.createTrip({title:'England'}),k=await service.createKnowledge({title:'Idea'});
 await repo.associateKnowledge(la.id,k);await repo.associateKnowledge(england.id,k);
 const e=await service.createEvent(la.id,{title:'Visit',knowledgeIds:[k.id]}),before=await service.getKnowledge(k.id);
 const result=await service.searchKnowledge({tripId:england.id});assert.equal(result.items.length,1);assert.deepEqual(new Set(result.items[0].associatedTripIds),new Set([la.id,england.id]));assert.deepEqual(result.items[0].relatedEventIds,[e.id]);
 assert.deepEqual(await service.getKnowledge(k.id),before);assert.equal(repo.knowledge.size,1);
 await assert.rejects(new PersistentPorterService(repo,'foreign').searchKnowledge({tripId:la.id}),/not found/);
});
test('Supabase scan sends an owner predicate, stable keyset order and a hard limit',async()=>{
 const calls=[],q={};for(const method of ['select','eq','order','limit','gt'])q[method]=(...args)=>{calls.push([method,...args]);return q;};q.then=resolve=>resolve({data:[{id:'k',owner_id:'owner',title:'Idea',travel_trip_knowledge:[{trip_id:'la'}]}]});
 const repo=new SupabasePorterRepository({from:name=>{calls.push(['from',name]);return q;}}),items=await repo.scanGlobalKnowledge('owner',{cursor:'cursor',limit:20});
 assert.ok(calls.some(x=>JSON.stringify(x)===JSON.stringify(['eq','owner_id','owner'])));assert.ok(calls.some(x=>x[0]==='limit'&&x[1]===21));assert.ok(calls.some(x=>x[0]==='order'&&x[1]==='id'));assert.ok(calls.some(x=>x[0]==='gt'&&x[2]==='cursor'));assert.deepEqual(items[0].associatedTripIds,['la']);
});
test('HTTP Knowledge reads use authentication, validate query shape and hide foreign records',async()=>{
 const {service}=setup(),k=await service.createKnowledge({title:'Museum'});
 const app=createClientApi(async token=>{if(token!=='valid')throw new AuthenticationError();return {service};},{host:'127.0.0.1'}),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,get=(path,authorized=true)=>fetch(base+path,{headers:authorized?{Authorization:'Bearer valid'}:{}});
 try {
  const response=await get('/client/knowledge?query=museum&limit=1');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).items[0].id,k.id);
  assert.equal((await get('/client/knowledge',false)).status,401);
  for(const query of ['limit=1.5','limit=101','query=a&query=b','unexpected=1','cursor=bad'])assert.equal((await get('/client/knowledge?'+query)).status,400);
  assert.equal((await get('/client/knowledge/'+k.id)).status,200);
  const foreign=await new PersistentPorterService(service.repository,'foreign').createKnowledge({title:'Secret'});assert.equal((await get('/client/knowledge/'+foreign.id)).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('client adapter encodes searches, propagates cancellation and has no automatic fetch',async()=>{
 const calls=[],controller=new AbortController(),api=knowledgeApi(async(path,options)=>{calls.push({path,options});return {json:async()=>({items:[]})};},async r=>r);
 assert.equal(calls.length,0);await api.search({query:'pub & walk',tag:'LA'},{signal:controller.signal});assert.equal(new URL(calls[0].path,'http://local').searchParams.get('query'),'pub & walk');assert.equal(calls[0].options.signal,controller.signal);
 await api.get('a/b');assert.equal(calls[1].path,'/client/knowledge/a%2Fb');
});
