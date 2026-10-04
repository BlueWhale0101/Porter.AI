import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productionConfig } from '../server/config.mjs';
import { createProductionApp } from '../server/app.mjs';
import { AuthenticationError } from '../src/runtime.js';
import { sessionFetch } from '../client/session.js';
import { diagnosticsSnapshot } from '../client/diagnostics.js';
import { MemoryStore,startLocalFirst } from '../client/core.js';
import { newTrip } from '../src/domain.js';
import { buildTripPacket } from '../src/projection.js';
const owner='11111111-1111-4111-8111-111111111111',origin='https://porter.test';
const env={PORTER_SUPABASE_URL:'https://example.supabase.co',PORTER_SUPABASE_KEY:'sb_publishable_test',PORTER_PUBLIC_ORIGIN:origin,PORTER_OWNER_ID:owner};
const build={revision:'a'.repeat(40),buildId:'test-build'};
async function host(t,overrides={}){
 const dist=await mkdtemp(join(tmpdir(),'porter-http-'));await writeFile(join(dist,'index.html'),'<main>Porter</main>');await writeFile(join(dist,'sw.js'),'// worker');await writeFile(join(dist,'build.json'),JSON.stringify(build));
 const logs=[];let mutations=0;
 const app=createProductionApp({config:productionConfig(env),dist,build,logger:x=>logs.push(x),runtimeForToken:async token=>{if(token!=='valid')throw new AuthenticationError('private error');return {service:{ownerId:owner,listTrips:async()=>[{id:'trip'}],createTrip:async input=>{mutations++;return {title:input.title};}}};},...overrides});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dist,{recursive:true,force:true});});
 const request=(path,options={})=>fetch(`http://127.0.0.1:${server.address().port}${path}`,options);
 const hostStatus=host=>new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/',headers:{Host:host}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 return {request,hostStatus,logs,mutations:()=>mutations};
}
test('production config rejects missing values, privileged keys, invalid origin and owner',()=>{
 for(const key of Object.keys(env))assert.throws(()=>productionConfig({...env,[key]:''}),new RegExp(key));
 assert.throws(()=>productionConfig({...env,PORTER_SUPABASE_KEY:'sb_secret_hidden'}),/never a secret/);
 const jwt=`x.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.x`;
 assert.throws(()=>productionConfig({...env,PORTER_SUPABASE_KEY:jwt}),/never a secret/);
 assert.throws(()=>productionConfig({...env,PORTER_PUBLIC_ORIGIN:'http://porter.test'}),/HTTPS/);
 assert.throws(()=>productionConfig({...env,PORTER_OWNER_ID:'participant-wes'}),/UUID/);
 assert.equal(productionConfig(env).port,8790);
});
test('production shell and build identity load without auth; API requires validated identity',async t=>{
 const {request,logs}=await host(t);
 assert.equal((await request('/')).status,200);assert.equal((await request('/sw.js')).headers.get('cache-control'),'no-cache');
 assert.deepEqual(await (await request('/health')).json(),{ok:true,service:'Porter.AI',...build});
 const anonymous=await request('/client/trips');assert.equal(anonymous.status,401);assert.equal(anonymous.headers.get('cache-control'),'no-store');assert.ok(anonymous.headers.get('x-request-id'));
 const signed=await request('/client/trips',{headers:{Cookie:'__Host-porter-access=valid'}});assert.equal(signed.status,200);
 assert.equal((await request('/.env')).status,404);assert.equal((await request('/mcp',{method:'POST',headers:{Origin:origin}})).status,404);
 assert.ok(!JSON.stringify(logs).includes('valid'));assert.ok(!JSON.stringify(logs).includes('private error'));
});
test('public Host is accepted, foreign Host and cross-origin cookie writes are denied',async t=>{
 const {request,hostStatus,mutations}=await host(t);
 assert.equal(await hostStatus('porter.test'),200);
 assert.equal(await hostStatus('attacker.test'),403);
 const options={method:'POST',headers:{Cookie:'__Host-porter-access=valid','Content-Type':'application/json'},body:JSON.stringify({operation:'createTrip',arguments:{trip:{title:'Test'}}})};
 assert.equal((await request('/client/mutate',options)).status,403);
 assert.equal((await request('/client/mutate',{...options,headers:{...options.headers,Origin:'https://attacker.test'}})).status,403);
 assert.equal(mutations(),0);
 assert.equal((await request('/client/mutate',{...options,headers:{...options.headers,Origin:origin}})).status,200);assert.equal(mutations(),1);
});
test('a validated JWT from another owner cannot access this single-owner deployment',async t=>{
 const {request}=await host(t,{runtimeForToken:async()=>({service:{ownerId:'other',listTrips:()=>{throw new Error('Must not execute');}}})});
 assert.equal((await request('/client/trips',{headers:{Authorization:'Bearer other'}})).status,401);
});
test('sign-in and refresh set secure HttpOnly cookies without returning tokens',async t=>{
 const calls=[];const result={data:{user:{id:owner},session:{access_token:'access-secret',refresh_token:'refresh-secret',expires_in:3600}}};
 const {request}=await host(t,{authOptions:{newClient:()=>({auth:{signInWithPassword:async x=>{calls.push(x);return result;},refreshSession:async x=>{calls.push(x);return result;}}})}});
 const login=await request('/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.com',password:'password'})});
 assert.deepEqual(await login.json(),{ok:true});for(const cookie of login.headers.getSetCookie()){assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.match(cookie,/Path=\//);}
 const refresh=await request('/auth/refresh',{method:'POST',headers:{Origin:origin,Cookie:'__Host-porter-refresh=refresh-secret'}});assert.equal(refresh.status,200);assert.deepEqual(calls.at(-1),{refresh_token:'refresh-secret'});
 const logout=await request('/auth/logout',{method:'POST',headers:{Origin:origin}});assert.ok(logout.headers.getSetCookie().every(x=>x.includes('Max-Age=0')));
});
test('unauthorized sign-in cannot set a session; failures omit backend details',async t=>{
 const {request}=await host(t,{authOptions:{newClient:()=>({auth:{signInWithPassword:async()=>({data:{user:{id:'other'},session:{access_token:'secret'}}})}})}});
 const result=await request('/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'x',password:'y'})});
 assert.equal(result.status,401);assert.equal(result.headers.get('set-cookie'),null);assert.ok(!(await result.text()).includes('secret'));
});
test('session refresh is network-only, coalesces parallel 401s and does not retry ambiguous writes',async()=>{
 let calls=0,refreshes=0,refreshed=false;
 const request=sessionFetch({fetcher:async url=>{calls++;if(url==='/auth/refresh'){refreshes++;await new Promise(r=>setTimeout(r,5));refreshed=true;return new Response('{}');}return new Response('{}',{status:refreshed?200:401});}});
 assert.equal(calls,0);assert.ok((await Promise.all([request('/client/trips'),request('/client/trips')])).every(x=>x.ok));assert.equal(refreshes,1);
 let writes=0;const failed=sessionFetch({fetcher:async()=>{writes++;throw new Error('connection lost');}});await assert.rejects(failed('/client/mutate',{method:'POST'}));assert.equal(writes,1);
});
test('expired authentication never blocks usable local rendering or clears local state',async()=>{
 const store=new MemoryStore(),trip=newTrip({title:'Saved'},owner),packet=buildTripPacket({trip,events:[],knowledge:[]});await store.putPacket(trip.id,{packet,meta:{usable:true}});await store.setActiveTrip(trip.id);
 const order=[];const api={packet:async()=>{order.push('authentication');throw new AuthenticationError('expired');}};
 const run=await startLocalFirst({store,api,render:async()=>order.push('render')});const outcome=await run.sync;
 assert.deepEqual(order,['render','authentication']);assert.equal(outcome.localRetained,true);assert.equal(await store.getActiveTrip(),trip.id);
});
test('diagnostics contain revision, cache, artifact and scoped conflict state without private content',async()=>{
 const store=new MemoryStore(),trip=newTrip({title:'Private title'},owner),packet=buildTripPacket({trip,events:[],knowledge:[]});
 await store.putPacket(trip.id,{packet,meta:{usable:true,lastSync:'real-sync'}});await store.setActiveTrip(trip.id);await store.enqueue({state:'conflict',arguments:{tripId:'other',secret:'not included'}});
 const result=await diagnosticsSnapshot({store,packet,activeRun:{local:{meta:{usable:true}}},revision:build.revision,online:false,sw:{controlled:false}});
 assert.equal(result.conflicts,0);assert.equal(result.lastSuccessfulSync,'real-sync');assert.equal(result.usefulLocalDataAtLaunch,true);assert.equal(result.localPacketUsable,true);
 assert.ok(!JSON.stringify(result).includes('Private title'));assert.ok(!JSON.stringify(result).includes('not included'));
});

test('backend exceptions become actionable 503s without exposing backend details',async t=>{
 const {request}=await host(t,{runtimeForToken:async()=>{throw new Error('database password or SQL must not be public');}});
 const response=await request('/client/trips',{headers:{Authorization:'Bearer valid'}});
 assert.equal(response.status,503);const body=await response.json();assert.equal(body.code,'backend_error');assert.ok(!body.message.includes('password'));
});
