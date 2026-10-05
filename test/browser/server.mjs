// Test process only: real production HTTP/static boundary + PersistentPorterService,
// with an isolated repository/auth/storage seam. Never imported by the app/build.
import express from 'express';
import { EVENT_VISUAL_ROLES } from '../../src/event-visual.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createProductionApp } from '../../server/app.mjs';
import { cookies } from '../../server/auth.mjs';
import { PersistentPorterService } from '../../src/persistent-service.js';
import { AuthenticationError } from '../../src/runtime.js';
import { MemoryRepository } from '../helpers/repository.js';
import { acceptanceData } from '../../scripts/acceptance-data.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const original=Buffer.from('PORTER BROWSER REGRESSION — NOT A VALID ADMISSION');
let service,trip,event,held=false,waiting=0,release,gate,generation=0,apiUnavailable=false;
async function reset(){
  release?.();generation=0;apiUnavailable=false;held=false;waiting=0;gate=Promise.resolve();
  service=new PersistentPorterService(new MemoryRepository(),owner);
  trip=await service.createTrip({title:'Browser regression Trip',lifecycle:'active'});
  event=await service.createEvent(trip.id,{
    title:'Regression performance',commitment:'confirmed',
    temporal:{start:'2030-12-10T19:00:00Z',end:'2030-12-10T21:00:00Z',startTimezone:'UTC',endTimezone:'UTC'},
    booking:{expectedAdmissions:[{id:'test-admission'}]},
    artifacts:[{id:'test-pass',role:'ticket',mediaType:'text/plain',storageRef:{provider:'browser-test'},
      satisfiesAdmissionIds:['test-admission'],offlineRequired:true,version:'1',
      checksum:createHash('sha256').update(original).digest('hex'),code:{format:'qr',value:'NOT-A-VALID-TICKET'}}],
  });
  await service.createKnowledge(trip.id,{title:'Test note',content:'Browser regression only',relatedEventIds:[event.id]});
  const project=service.tripContext.bind(service);
  service.tripContext=async(...args)=>{if(held){waiting++;await gate;}return project(...args);};
}
await reset();
const host=express();host.use(express.json());
host.post('/__test/connectivity',(req,res)=>{apiUnavailable=!req.body.apiAvailable;res.json({apiUnavailable});});
host.use('/client',(_req,res,next)=>{if(apiUnavailable)return res.status(503).json({code:'backend_error',message:'Test API unavailable'});next();});
host.get('/sw.js',(_req,res)=>{const build=JSON.parse(readFileSync('dist/build.json','utf8'));res.set('Cache-Control','no-store').type('application/javascript').send(readFileSync('dist/sw.js','utf8').replaceAll(build.buildId,generation?build.buildId+'-test-'+generation:build.buildId));});
host.post('/__test/update',(_req,res)=>{generation++;res.json({generation});});
host.post('/__test/empty',async(_req,res)=>{const empty=await service.createTrip({title:'Unscheduled Journey',lifecycle:'active'});await service.createEvent(empty.id,{title:'Choose a quiet cafe',commitment:'optional'});res.json({tripId:empty.id});});
host.post('/__test/rich',async(_req,res)=>{
  const data=acceptanceData(new Date().toISOString().slice(0,10));
  const rich=await service.createTrip({title:'Acceptance calendar',lifecycle:'active',participants:[{id:'wes',name:'Wes'},{id:'skye',name:'Skye'},{id:'tor',name:'Tor'}]});
  const ids={};
  for(const item of data.events){const {key,...input}=item;delete input.parentKey;input.parentEventId=ids[item.parentKey]??null;input.visual={color:key==='family-tickets'?'sky':null};ids[key]=(await service.createEvent(rich.id,input)).id;}
  res.json({tripId:rich.id,ids});
});
host.post('/__test/visuals',async(_req,res)=>{
  const target=await service.createTrip({title:'Event visual regression',lifecycle:'active',participants:[{id:'wes',name:'Wes'},{id:'skye',name:'Skye'}]});
  const ids={};
  for(const [i,role] of EVENT_VISUAL_ROLES.entries()){
    const input={title:role==='none'?'Flight without manual illustration':`Illustration ${role}`,participants:['wes','skye'],commitment:'confirmed',temporal:{start:`2030-12-${String(10+(role==='flight'?0:i+1)).padStart(2,'0')}T12:00:00Z`,startTimezone:'UTC'}};
    if(role!=='none')input.visual={visual_role:role,color:'sky'};
    ids[role]=(await service.createEvent(target.id,input)).id;
  }
  res.json({tripId:target.id,ids});
});
host.get('/__test/parking',async(_req,res)=>res.json({knowledge:await service.listKnowledge(trip.id),current:(await service.tripContext(trip.id)).current.parkingKnowledge}));
host.get('/__test/events',async(req,res)=>res.json(await service.listEvents(req.query.tripId??trip.id)));
host.post('/__test/editor',async(_req,res)=>{
  const target=await service.createTrip({title:'Editor regression',lifecycle:'active'});
  for(const [title,start,end,zone] of [['London stay','2026-10-01','2026-10-06','Europe/London'],['Rome stay','2026-10-06','2026-10-15','Europe/Rome']])await service.createEvent(target.id,{title,accommodation:true,temporal:{start:start+'T12:00:00Z',end:end+'T10:00:00Z',startTimezone:zone,endTimezone:zone}});
  res.json({tripId:target.id});
});
host.post('/__test/reset',async(_req,res)=>{await reset();res.json({tripId:trip.id,eventId:event.id});});
host.post('/__test/hold',async(_req,res)=>{
  trip=await service.updateTrip(trip.id,{title:'Updated regression Trip'},trip.revision);
  held=true;waiting=0;gate=new Promise(resolve=>{release=resolve;});res.json({ok:true});
});
host.get('/__test/state',(_req,res)=>res.json({held,waiting}));
host.post('/__test/release',(_req,res)=>{held=false;release?.();res.json({ok:true});});
const config={hostname:'localhost',origin:'http://localhost:4178',ownerId:owner};
// Test-only credential adapter: localhost HTTP cannot use the production Secure
// __Host- cookie in every engine. Keep real requests (including worker-controlled
// reloads) on the production client API rather than intercepting browser traffic.
host.use('/client',(req,_res,next)=>{
  const token=cookies(req)['browser-regression-access'];
  if(token)req.headers.authorization=`Bearer ${token}`;
  next();
});
host.use(createProductionApp({config,dist:resolve('dist'),build:JSON.parse(readFileSync('dist/build.json','utf8')),
  logger:()=>{},runtimeForToken:async token=>{
    if(token!=='browser-regression')throw new AuthenticationError('Test authentication required');
    return {service,storage:{get:async()=>new Blob([original])}};
  }}));
host.listen(4178,'127.0.0.1');
