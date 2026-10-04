// Test process only: real production HTTP/static boundary + PersistentPorterService,
// with an isolated repository/auth/storage seam. Never imported by the app/build.
import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createProductionApp } from '../../server/app.mjs';
import { cookies } from '../../server/auth.mjs';
import { PersistentPorterService } from '../../src/persistent-service.js';
import { AuthenticationError } from '../../src/runtime.js';
import { NotFoundError } from '../../src/repository.js';

const owner='11111111-1111-4111-8111-111111111111';
class Repository {
  trips=new Map(); events=new Map(); knowledge=new Map();
  async insertTrip(x){this.trips.set(x.id,x);return structuredClone(x);}
  async listTrips(id){return [...this.trips.values()].filter(t=>t.ownerId===id).map(t=>structuredClone(t));}
  async getTrip(id,key){const t=this.trips.get(key);if(t?.ownerId!==id)throw new NotFoundError('Trip',key);return structuredClone(t);}
  async updateTrip(id,t){await this.getTrip(id,t.id);return this.insertTrip(t);}
  async insertEvent(x){this.events.set(x.id,x);return structuredClone(x);}
  async getEvent(id){return structuredClone(this.events.get(id));}
  async listEvents(id){return [...this.events.values()].filter(e=>e.tripId===id).map(e=>structuredClone(e));}
  async insertKnowledge(x){this.knowledge.set(x.id,x);return structuredClone(x);}
  async listKnowledge(id){return [...this.knowledge.values()].filter(k=>k.tripId===id).map(k=>structuredClone(k));}
}
const original=Buffer.from('PORTER BROWSER REGRESSION — NOT A VALID ADMISSION');
let service,trip,event,held=false,waiting=0,release,gate;
async function reset(){
  release?.();held=false;waiting=0;gate=Promise.resolve();
  service=new PersistentPorterService(new Repository(),owner);
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
