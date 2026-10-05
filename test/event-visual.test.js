import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { EVENT_VISUAL_ROLES,eventVisualRole,eventIconPath } from '../src/event-visual.js';
import { eventIconMarkup,resolveArtwork } from '../client/artwork.js';
import { PersistentPorterService } from '../src/persistent-service.js';
import { MemoryRepository } from './helpers/repository.js';
import { withPendingEvents } from '../client/planning.js';
import { MemoryStore,replayQueue } from '../client/core.js';
import { createPorterMcpServer } from '../mcp/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

test('small Event illustrations are an explicit finite vocabulary, never inferred or custom URLs',()=>{
  assert.deepEqual(EVENT_VISUAL_ROLES,['none','accommodation','airport','cafe','city','destination','flight','hire','museum','outdoors','theatre','train']);
  for(const event of [{},{title:'Flight to Rome',movement:true},{accommodation:true},{visual:{visual_role:'unknown',hero_asset:'/custom.webp'}},{visual:{visual_role:null}},{visual:{visual_role:'none'}}]){
    assert.equal(eventVisualRole(event),'none');assert.equal(eventIconMarkup(event),'');
  }
  for(const role of EVENT_VISUAL_ROLES.slice(1)){
    const html=eventIconMarkup({visual:{visual_role:role}});assert.ok(html.includes(eventIconPath(role)));assert.match(html,/width="40" height="40"/);assert.match(html,/aria-hidden="true"/);
  }
  assert.equal(eventIconMarkup({visual:{visual_role:'../../evil'}}),'');
  assert.match(resolveArtwork({visual:{visual_role:'museum'}}).src,/event-illustrations/);
});

test('semantic create/update, TripPacket perspectives and queued restart/replay preserve the visual aspect',async()=>{
  const service=new PersistentPorterService(new MemoryRepository(),'owner');
  const trip=await service.createTrip({title:'Visual contract',participants:[{id:'wes',name:'Wes'},{id:'skye',name:'Skye'}]});
  let event=await service.createEvent(trip.id,{title:'Gallery',participants:['wes','skye'],visual:{visual_role:'museum',color:'sky',hero_asset:'/custom.webp'}});
  for(const role of EVENT_VISUAL_ROLES){
    event=await service.updateEvent(event.id,{visual:{...event.visual,visual_role:role}},event.revision);
    for(const perspectiveParticipantId of [undefined,'wes','skye'])assert.deepEqual((await service.tripContext(trip.id,{perspectiveParticipantId})).events[event.id].visual,event.visual);
  }
  await assert.rejects(service.createEvent(trip.id,{visual:{visual_role:'invalid'}}),/visual_role/);
  await assert.rejects(service.updateEvent(event.id,{visual:{visual_role:'invalid'}},event.revision),/visual_role/);
  const packet=await service.tripContext(trip.id),visual={...event.visual,visual_role:'cafe'};
  const mutation={id:'visual-edit',operation:'updateEvent',arguments:{eventId:event.id,tripId:trip.id,patch:{visual},expectedRevision:event.revision}};
  const store=new MemoryStore({mutations:[mutation]});const restored=new MemoryStore({mutations:await store.pending()});
  assert.deepEqual(withPendingEvents(packet,await restored.pending()).events[event.id].visual,visual);
  assert.equal(packet.events[event.id].visual.visual_role,'train');
  await replayQueue(restored,{mutate:async m=>service.updateEvent(m.arguments.eventId,m.arguments.patch,m.arguments.expectedRevision)});
  assert.equal((await restored.pending()).length,0);assert.deepEqual((await service.tripContext(trip.id)).events[event.id].visual,visual);
  const create={id:'visual-create',operation:'createEvent',arguments:{tripId:trip.id,event:{title:'Coffee',visual}}};
  assert.deepEqual(withPendingEvents(packet,[create]).events['pending:visual-create'].visual,visual);
});

test('Assistant sees the visual enum and can create/update it through MCP without losing other aspects',async()=>{
  const service=new PersistentPorterService(new MemoryRepository(),'owner'),trip=await service.createTrip({title:'MCP visuals'});
  const server=createPorterMcpServer(service),client=new Client({name:'visual-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(b);await client.connect(a);
  try{
    const listed=await client.listTools();
    for(const [name,field] of [['create_event','event'],['update_event','patch']]){
      const schema=listed.tools.find(t=>t.name===name).inputSchema.properties[field];
      assert.ok(JSON.stringify(schema).includes(JSON.stringify(EVENT_VISUAL_ROLES)));
    }
    const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
    const event=await call('create_event',{tripId:trip.id,event:{title:'Coffee',visual:{visual_role:'cafe',color:'sky'},description:'Retained'}});
    const changed=await call('update_event',{eventId:event.id,expectedRevision:event.revision,patch:{visual:{...event.visual,visual_role:'none'}}});
    assert.equal(changed.description,'Retained');assert.deepEqual(changed.visual,{visual_role:'none',color:'sky'});
    const invalid=await client.callTool({name:'create_event',arguments:{tripId:trip.id,event:{visual:{visual_role:'invalid'}}}});assert.equal(invalid.isError,true);
  }finally{await client.close();await server.close();}
});

test('every tiny derivative is shipped within its per-file and total shell budgets',()=>{
  const paths=EVENT_VISUAL_ROLES.map(eventIconPath).filter(Boolean);assert.equal(paths.length,11);
  assert.equal(readdirSync(new URL('../public/artwork/event-icons/',import.meta.url)).length,11);
  let total=0;for(const path of paths){const bytes=readFileSync(new URL('../public'+path,import.meta.url));assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.ok(bytes.length<=12000);total+=bytes.length;}
  assert.ok(total<=50000,`Event icons total ${total} bytes`);
});
