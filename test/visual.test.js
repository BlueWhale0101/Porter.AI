import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { artwork, resolveArtwork, systemMarkup, artMarkup, safeAsset } from '../client/artwork.js';
import { createFixtures, fixtureSource, FIXTURE_NOW } from '../client/dev/fixtures.js';
import { validatePacket, readiness, startLocalFirst, PerformanceTrace } from '../client/core.js';
import { doorEntries } from '../client/journey.js';
import { newEvent, newKnowledge, newTrip } from '../src/domain.js';
test('custom art, explicit role, structural hints and no-art fallback are deterministic and pure',()=>{
  const event={title:'Flight',movement:true,visual:{hero_asset:'/custom.jpg'}},before=structuredClone(event);
  assert.equal(resolveArtwork(event).src,'/custom.jpg');assert.equal(resolveArtwork(event).fallback,artwork.event.flight);
  assert.equal(resolveArtwork({visual:{visual_role:'theatre'}}).src,artwork.event.theatre);
  assert.equal(resolveArtwork({accommodation:true}).src,artwork.event.accommodation);
  assert.equal(resolveArtwork({title:'Train to the coast',movement:true}).src,artwork.event.train);
  assert.equal(resolveArtwork({title:'Something unknown'}),null);assert.equal(resolveArtwork({title:'Trip'},{kind:'trip'}),null);
  assert.deepEqual(event,before);assert.equal(safeAsset('javascript:alert(1)'),null);assert.equal(artMarkup(null),'');
});
test('system explanation survives absent artwork',()=>{
  for(const state of ['no-active-trip','offline-ready','missing-artifact','sync-failed']){const html=systemMarkup(state).replace(/<span.*?<\/span>/s,'');assert.match(html,/<h2>.+<\/h2>/);assert.match(html,/<p>.+<\/p>/);}
});
test('fixture source uses domain shapes; every perspective is a server projection',async()=>{
  const source=fixtureSource();newTrip(source.trip,'test');source.events.forEach(e=>newEvent(e,source.trip.id));source.knowledge.forEach(k=>newKnowledge(k,source.trip.id));
  const {store}=await createFixtures();
  for(const p of [null,'wes','skye','tor']){const packet=validatePacket((await store.getPacket('demo-active',p)).packet);assert.equal(packet.generatedAt,FIXTURE_NOW);assert.equal(packet.perspectiveParticipantId,p);assert.ok(packet.events.sparse);}
  assert.equal((await store.getPacket('demo-active','wes')).packet.events.museum,undefined);
});
test('fixture admissions exercise codes, original, partial, missing and dynamic without decorative dependency',async()=>{
  for(const [state,count] of [['ready',3],['partial',2],['missing',0],['dynamic',0]]){
    const {store}=await createFixtures(state),packet=(await store.getPacket('demo-active')).packet,cache=await store.getArtifacts('demo-active');
    assert.equal(readiness(packet,cache).ready,count);
    const entries=doorEntries(packet,'opera',cache);assert.equal(entries.length,3);
    if(state==='ready'){assert.equal(entries[0].artifact.code.format,'qr');assert.equal(entries[1].artifact.code.format,'code128');assert.ok(entries[2].cache);}
    if(state==='dynamic')assert.ok(entries.every(e=>e.status==='external_dynamic'&&e.appUrl));
  }
});
test('local fixture renders with unresolved network and without loading any artwork',async()=>{
  const {store,api}=await createFixtures('syncing');let rendered=false;
  await startLocalFirst({store,api,render:async()=>{rendered=true;},trace:new PerformanceTrace()});assert.equal(rendered,true);
});
test('fixture entry is explicitly development gated and cannot call production mutations',async()=>{
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');assert.match(main,/import\.meta\.env\.DEV &&/);assert.match(main,/fixtureMode\?await/);
  const fixture=await createFixtures();await assert.rejects(fixture.api.mutate({}),/no production API/);
});
