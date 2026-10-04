// Real production HTTP smoke. Supply a short-lived user JWT in the environment,
// never on the command line. No fixture or direct table writes are used.
import assert from 'node:assert/strict';
const origin=process.env.PORTER_SMOKE_ORIGIN,token=process.env.PORTER_SMOKE_TOKEN;
if(!origin?.startsWith('https://')||!token)throw new Error('PORTER_SMOKE_ORIGIN (HTTPS) and PORTER_SMOKE_TOKEN (user JWT) are required');
async function get(path,authenticated=true,body){const res=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(authenticated?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});assert.ok(res.ok,`${path}: HTTP ${res.status}`);return res.json();}
const health=await get('/health',false),manifest=await get('/manifest.webmanifest',false);
if(process.env.PORTER_EXPECTED_REVISION)assert.equal(health.revision,process.env.PORTER_EXPECTED_REVISION);
for(const icon of manifest.icons){const r=await fetch(origin+icon.src);assert.ok(r.ok);assert.ok((await r.arrayBuffer()).byteLength>0);}
const unauthorized=await fetch(origin+'/client/trips');assert.equal(unauthorized.status,401);
const mutate=(operation,args)=>get('/client/mutate',true,{operation,arguments:args});
const trip=await mutate('createTrip',{trip:{title:`PORTER SMOKE — DELETE ME — ${new Date().toISOString()}`,lifecycle:'draft'}});
console.log(JSON.stringify({createdDisposableTripId:trip.id}));
const event=await mutate('createEvent',{tripId:trip.id,event:{title:'Disposable acceptance checkpoint',commitment:'planned'}});
const knowledge=await mutate('createKnowledge',{tripId:trip.id,knowledge:{title:'Disposable smoke note',content:'Created through the production semantic client API.',relatedEventIds:[event.id]}});
const packet=await get(`/client/trips/${trip.id}/packet`);
assert.equal(packet.trip.id,trip.id);assert.equal(packet.events[event.id].title,event.title);assert.ok(packet.knowledge.some(k=>k.id===knowledge.id));
const again=await get(`/client/trips/${trip.id}/packet`);assert.equal(again.revision,packet.revision);
assert.ok((await get('/client/trips')).some(t=>t.id===trip.id));
console.log(JSON.stringify({httpSmoke:true,revision:health.revision,tripId:trip.id,eventId:event.id,knowledgeId:knowledge.id,packetRevision:packet.revision,browserIndexedDbVerified:false,iphoneAcceptance:false}));
