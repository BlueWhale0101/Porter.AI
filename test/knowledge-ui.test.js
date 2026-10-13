import test from 'node:test';
import assert from 'node:assert/strict';
import {knowledgeForm,readKnowledgeForm,knowledgeState,tripRelationship} from '../client/knowledge-ui.js';
import {MemoryStore} from '../client/core.js';
import {captureKnowledge,editKnowledge,localKnowledge,knowledgeMutationGroup,discardKnowledgeGroup} from '../client/knowledge-sync.js';
const form=fields=>({elements:{namedItem:name=>({value:fields[name]??''})}});
test('compact form preserves required capture and planning contracts without exposing references',()=>{
 const html=knowledgeForm({title:'<script>',planning:{cost:{amount:0,currency:'GBP'}}});assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('<details'));assert.ok(!html.includes('relatedEventIds'));
 const fields=readKnowledgeForm(form({title:' Pub ',content:'Notes',tags:'London, london',primaryUrl:'https://example.com',amount:'0',currency:'gbp',bookingRequired:'yes',timedAvailability:'unknown'}));assert.equal(fields.title,'Pub');assert.deepEqual(fields.tags,['London']);assert.equal(fields.planning.cost.amount,0);
 assert.throws(()=>readKnowledgeForm(form({title:'Place',amount:'',currency:'GBP',bookingRequired:'unknown',timedAvailability:'unknown'})));
});
test('states and Trip relationship explain planning, operational and scheduled independently',()=>{
 assert.equal(knowledgeState({pending:true,mutations:[]}), 'Saved on this device · pending sync');assert.equal(knowledgeState({mutations:[{state:'blocked'}]}),'Needs attention');assert.equal(knowledgeState({conflicts:[{}]}),'Conflict — review changes');
 assert.equal(tripRelationship({associations:{t:{active:false}},tripReasons:{t:{operationalContext:true,tripEventIds:['e']}}},'t'),'Operational note · Linked to an Event');
});
test('review/discard preserves dependency fingerprint and refuses ambiguous writes',async()=>{
 const store=new MemoryStore(),c=await captureKnowledge(store,'owner',{title:'Local'});let k=await localKnowledge(store,'owner',c.knowledgeId);await editKnowledge(store,'owner',k.id,{content:'Child'},k.generation);let group=await knowledgeMutationGroup(store,'owner',c.mutationId);assert.equal(group.length,2);
 await assert.rejects(discardKnowledgeGroup(store,'owner',c.mutationId,'stale'),/changed/);await discardKnowledgeGroup(store,'owner',c.mutationId,JSON.stringify(group));assert.equal(await localKnowledge(store,'owner',k.id),null);
 const another=await captureKnowledge(store,'owner',{title:'Maybe saved'});await store.knowledgeTransaction('owner',s=>{s.mutations.find(m=>m.id===another.mutationId).attempted=true;});group=await knowledgeMutationGroup(store,'owner',another.mutationId);await assert.rejects(discardKnowledgeGroup(store,'owner',another.mutationId,JSON.stringify(group)),/already be saved/);
});
test('review selects the creation parent even when persistence returns child IDs first',async()=>{
 const store=new MemoryStore(),c=await captureKnowledge(store,'owner',{title:'Parent'}),k=await localKnowledge(store,'owner',c.knowledgeId);await editKnowledge(store,'owner',k.id,{content:'Child'},k.generation);store.mutations.reverse();
 const visible=await localKnowledge(store,'owner',k.id);assert.equal(visible.mutations[0].id,c.mutationId);const group=await knowledgeMutationGroup(store,'owner',visible.mutations[0].id);assert.equal(group.length,2);assert.equal(group[0].operation,'captureGlobalKnowledge');await discardKnowledgeGroup(store,'owner',c.mutationId,JSON.stringify(group));assert.equal(await localKnowledge(store,'owner',k.id),null);
});
