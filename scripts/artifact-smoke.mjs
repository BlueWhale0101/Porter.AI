// Run on the configured Porter host after the real HTTP smoke. No fixture API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { productionConfig } from '../server/config.mjs';
import { createAuthenticatedPorterRuntime } from '../src/runtime.js';
const config=productionConfig(),token=process.env.PORTER_SMOKE_TOKEN,tripId=process.env.PORTER_SMOKE_TRIP_ID;
if(!token||!tripId)throw new Error('PORTER_SMOKE_TOKEN and PORTER_SMOKE_TRIP_ID are required');
const {service,storage}=await createAuthenticatedPorterRuntime(token,config.runtime);
assert.equal(service.ownerId,config.ownerId);
const trip=await service.getTrip(tripId);assert.match(trip.title,/^PORTER SMOKE — DELETE ME/);
const event=await service.createEvent(tripId,{title:'Disposable artifact — NOT VALID FOR ENTRY',booking:{expectedAdmissions:[{id:'smoke-admission'}]}});
const id=randomUUID(),bytes=Buffer.from('Porter disposable storage smoke. NOT VALID FOR ENTRY.\n');
let saved=await service.storeArtifact(event.id,{id,filename:'smoke.txt',data:bytes,contentType:'text/plain',role:'ticket',satisfiesAdmissionIds:['smoke-admission'],offlineRequired:true,version:'1'},event.revision);
const checksum=await storage.checksum(saved.artifacts[0].storageRef);
saved=await service.updateEvent(event.id,{artifacts:[{...saved.artifacts[0],checksum}]},saved.revision);
const response=await fetch(`${config.origin}/client/artifacts/${event.id}/${id}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
assert.equal(response.status,200);assert.equal(response.headers.get('x-porter-artifact-checksum'),checksum);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
console.log(JSON.stringify({artifactHttpSmoke:true,tripId,eventId:event.id,artifactId:id,storageKey:saved.artifacts[0].storageRef.key,browserOfflineReadinessVerified:false}));
