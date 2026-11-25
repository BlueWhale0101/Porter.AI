import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexedDB } from 'fake-indexeddb';
import { IndexedDbStore, MemoryStore, checksum, readiness, replayQueue, startLocalFirst } from '../client/core.js';
import { diagnosticsSnapshot } from '../client/diagnostics.js';
import { sessionFetch } from '../client/session.js';
import { SyncFailure } from '../client/sync-failure.js';

const bytes=new TextEncoder().encode('synthetic offline pass');
const artifact={id:'pass',eventId:'event',version:'v1',offlineRequired:true,checksum:await checksum(bytes)};
const packet={
  packetVersion:1,revision:1,generatedAt:'2026-11-12T10:00:00Z',trip:{id:'trip'},events:{event:{id:'event'}},
  current:{},artifactManifest:[artifact],access:[{eventId:'event',artifactIds:['pass']}],
};
const success={packet:async()=>packet,artifact:async()=>({data:bytes,version:'v1'})};
const run=(store,api=success,options={})=>startLocalFirst({store,tripId:'trip',api,render:async()=>{},...options});
const snapshot=(store,activeRun,options={})=>diagnosticsSnapshot({store,packet,activeRun,attempt:activeRun.attempt,...options});

test('failed artifact, ambiguous Trip 404 and transport attempts retain verified access and replayable edits',async()=>{
  globalThis.indexedDB=indexedDB;
  const store=new IndexedDbStore('sync-failure-test');
  const initial=await run(store);
  assert.equal((await initial.sync).ok,true);
  const verified=(await snapshot(store,initial)).lastSuccessfulSync;
  assert.ok(verified);
  await store.enqueue({id:'edit',operation:'createKnowledge',arguments:{tripId:'trip'}});
  const requestId=crypto.randomUUID();
  const failures=[
    {
      api:{...success,artifact:async()=>{throw new SyncFailure('artifact_retrieval','artifact','artifact_unavailable',{status:404,requestId});}},
      phase:'artifact_retrieval',category:'artifact',code:'artifact_unavailable',
    },
    {
      api:{...success,packet:async()=>{throw new SyncFailure('trip_retrieval','trip','trip_unavailable',{status:404,requestId});}},
      phase:'trip_retrieval',category:'trip',code:'trip_unavailable',
    },
    {
      api:{...success,packet:async()=>{throw new TypeError('URL with a private storage path');}},
      phase:'trip_retrieval',category:'network',code:'network_error',
    },
    {
      api:{...success,artifact:async()=>({data:new Uint8Array([0]),version:'v1'})},
      phase:'artifact_verification',category:'artifact',code:'artifact_checksum',
    },
    {
      api:{...success,artifact:async()=>{throw new DOMException('private timeout detail','TimeoutError');}},
      phase:'artifact_retrieval',category:'network',code:'timeout',
    },
  ];
  for(const {api,phase,category,code} of failures){
    const attempt=await run(store,api);
    const outcome=await attempt.sync;
    const report=await snapshot(store,attempt);
    assert.equal(outcome.ok,false);
    assert.equal(outcome.localRetained,true);
    assert.equal(report.syncAttempt.state,'failed');
    assert.equal(report.syncAttempt.failure.phase,phase);
    assert.equal(report.syncAttempt.failure.category,category);
    assert.equal(report.syncAttempt.failure.code,code);
    assert.equal(report.lastSuccessfulSync,verified);
    assert.equal(await store.isTripDeleted('trip'),false);
    assert.equal(readiness(packet,await store.getArtifacts('trip')).state,'ready_offline');
    assert.deepEqual((await store.pending()).map(item=>item.id),['edit']);
    assert.doesNotMatch(JSON.stringify(report),/private storage|private timeout/);
  }
  const retry=await run(store);
  assert.equal((await retry.sync).ok,true);
  assert.equal((await snapshot(store,retry)).syncAttempt.state,'succeeded');
  await replayQueue(store,{mutate:async mutation=>assert.equal(mutation.id,'edit')});
  assert.deepEqual(await store.pending(),[]);
  const latest=(await snapshot(store,retry)).lastSuccessfulSync;
  await store.putPacket('trip',{packet,meta:{usable:true,lastSync:'unverified-write'}});
  assert.equal((await snapshot(store,retry)).lastSuccessfulSync,latest);
});

test('superseded, tombstoned and failed commits cannot report successful synchronization',async()=>{
  const store=new MemoryStore();
  const initial=await run(store);
  await initial.sync;
  const verified=(await snapshot(store,initial)).lastSuccessfulSync;
  let release,current=true;
  const superseded=await run(store,{...success,packet:()=>new Promise(resolve=>{release=resolve;})},{isCurrent:()=>current});
  current=false;
  release(packet);
  assert.equal((await superseded.sync).error.code,'superseded');
  assert.equal(superseded.attempt.state,'cancelled');
  assert.equal((await snapshot(store,superseded)).lastSuccessfulSync,verified);

  const commit=store.commitCandidate.bind(store);
  store.commitCandidate=async()=>{throw new Error('private IndexedDB failure');};
  const failed=await run(store);
  assert.equal((await failed.sync).error.phase,'candidate_commit');
  assert.equal(failed.attempt.failure.category,'persistence');
  assert.equal((await snapshot(store,failed)).lastSuccessfulSync,verified);
  store.commitCandidate=commit;

  const deleted=await run(store,{...success,packet:()=>new Promise(resolve=>{release=resolve;})});
  await store.removeTrip('trip');
  release(packet);
  assert.equal((await deleted.sync).ok,false);
  assert.equal(deleted.attempt.state,'cancelled');
  assert.equal(await store.getPacket('trip'),null);
});

test('scoped renewal errors retain the renewal response correlation without exposing headers or server messages',async()=>{
  const events=[],requestId=crypto.randomUUID(),attempt={id:crypto.randomUUID(),requests:{}};
  const fetcher=async(url,options)=>{
    if(url==='/auth/refresh'){
      assert.equal(options.headers['X-Porter-Sync-Attempt'],attempt.id);
      return new Response('do not log my cookies',{status:429,headers:{'X-Request-ID':requestId}});
    }
    return new Response(null,{status:401,headers:{'X-Request-ID':'arbitrary private data'}});
  };
  const request=sessionFetch({fetcher,onAuthentication:event=>events.push(event)});
  await assert.rejects(request('/test',{}, {phase:'trip_retrieval',attempt}),error=>{
    assert.deepEqual(error.summary(),{
      phase:'session_renewal',category:'authentication',code:'renewal_failed',
      message:'Session renewal failed. Try Sync again.',status:429,requestId,
    });
    return true;
  });
  assert.equal(attempt.requests.trip_retrieval.requestId,null);
  assert.deepEqual(events,[{operation:'renewal',state:'failed',status:429,requestId}]);
});

test('a caller timeout during renewal does not abort another caller’s shared renewal',async()=>{
  let release,calls=0,authenticated=false;
  const request=sessionFetch({fetcher:async url=>{
    if(url==='/auth/refresh'){
      calls++;
      await new Promise(resolve=>{release=resolve;});
      authenticated=true;
      return new Response(null,{status:200});
    }
    return new Response(null,{status:authenticated?200:401});
  }});
  const controller=new AbortController(),observe={phase:'trip_retrieval'};
  const first=request('/packet',{signal:controller.signal},observe);
  const second=request('/packet',{},observe);
  const timedOut=assert.rejects(first,error=>error.phase==='session_renewal'&&error.code==='timeout');
  while(!release)await Promise.resolve();
  controller.abort(new SyncFailure('trip_retrieval','network','timeout'));
  await timedOut;
  release();
  assert.equal((await second).ok,true);
  assert.equal(calls,1);
});
