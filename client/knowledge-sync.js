import {knowledgeFields,ideaMutation,knowledgeQuery,hasTag,tagKey} from '../src/knowledge.js';
import {knowledgeKey,validateOwner} from './knowledge-store.js';
const copy=x=>structuredClone(x);
const live=m=>m.state==='acknowledged'?!m.reconciled:m.state!=='resolved';
const target=m=>m.arguments.knowledgeId;
const sequence=rows=>Math.max(0,...rows.map(x=>x.sequence??0))+1;
const record=(state,owner,id)=>state.knowledge.find(x=>x.id===knowledgeKey(owner,id));
const ordered=state=>[...state.mutations].sort((a,b)=>a.sequence-b.sequence);
export class KnowledgeSession {
  constructor(ownerId=null){this.ownerId=ownerId;this.epoch=0;}
  setOwner(ownerId){this.ownerId=ownerId;this.epoch++;}
  stamp(){return {ownerId:this.ownerId,epoch:this.epoch};}
  matches(stamp){return this.ownerId===stamp.ownerId&&this.epoch===stamp.epoch;}
}
function visible(row,state){
  if(!row)return null;let value=copy(row.source??row.seed),associations=copy(row.associations??{});
  for(const m of ordered(state).filter(m=>target(m)===row.knowledgeId&&live(m))){
    if(m.operation==='captureGlobalKnowledge')value={...value,...m.arguments.knowledge};
    if(m.operation==='editGlobalKnowledge')value={...value,...m.arguments.patch};
    if(m.operation==='setTripIdea')associations[m.arguments.tripId]={...(associations[m.arguments.tripId]??{}),active:m.arguments.active,pending:true};
  }
  const mutations=state.mutations.filter(m=>target(m)===row.knowledgeId&&live(m));
  return {...value,associations,associatedTripIds:[...new Set([...(row.associatedTripIds??[]),...Object.keys(associations).filter(id=>associations[id].active)])],tripReasons:copy(row.tripReasons??{}),generation:row.generation,pending:mutations.length>0,mutations:copy(mutations),conflicts:mutations.filter(m=>m.state==='conflict').map(copy)};
}
export async function localKnowledge(store,ownerId,id){return store.knowledgeTransaction(ownerId,state=>visible(record(state,ownerId,id),state));}
function queue(state,ownerId,operation,args,dependencies=[]){
  const id=args.mutationId??crypto.randomUUID();args.mutationId=id;
  const item={id,ownerId,localKnowledge:true,operation,arguments:args,dependencies,sequence:sequence(state.mutations),state:'pending',attempted:false,createdAt:new Date().toISOString()};state.mutations.push(item);for(const query of state.queries)query.complete=false;return item;
}
export async function captureKnowledge(store,ownerId,input){
  validateOwner(ownerId);const knowledge=knowledgeFields(input,{create:true}),knowledgeId=crypto.randomUUID();
  return store.knowledgeTransaction(ownerId,state=>{
    state.knowledge.push({id:knowledgeKey(ownerId,knowledgeId),ownerId,knowledgeId,generation:1,pinned:true,source:null,seed:{id:knowledgeId,ownerId,tripId:null,content:'',tags:[],planning:{},sources:[],locations:[],participantIds:[],validityWindows:[],relatedEventIds:[],revision:0,...knowledge},associations:{}});
    const item=queue(state,ownerId,'captureGlobalKnowledge',{knowledgeId,knowledge});return {knowledgeId,mutationId:item.id,generation:1};
  });
}
export async function editKnowledge(store,ownerId,id,patch,expectedGeneration){
  patch=knowledgeFields(patch);
  return store.knowledgeTransaction(ownerId,state=>{
    const row=record(state,ownerId,id);if(!row||row.generation!==expectedGeneration)throw new Error('Knowledge changed locally. Reopen before saving.');
    const prior=ordered(state).findLast(m=>target(m)===id&&m.operation!=='setTripIdea'&&live(m));
    const item=queue(state,ownerId,'editGlobalKnowledge',{knowledgeId:id,patch,expectedRevision:row.source?.revision??1},prior?[prior.id]:[]);item.base=copy(row.source??row.seed);row.generation++;return copy(item);
  });
}
export async function associateKnowledge(store,ownerId,id,tripId,active,expectedGeneration){
  return store.knowledgeTransaction(ownerId,state=>{
    const row=record(state,ownerId,id);if(!row||row.generation!==expectedGeneration)throw new Error('Knowledge changed locally. Reopen before associating.');
    const previous=ordered(state).findLast(m=>target(m)===id&&m.operation==='setTripIdea'&&m.arguments.tripId===tripId&&live(m)),creation=state.mutations.find(m=>target(m)===id&&m.operation==='captureGlobalKnowledge'&&live(m));
    const existing=row.associations?.[tripId];if(!previous&&!creation&&!existing)throw new Error('Read current association state before saving');
    const args={tripId,knowledgeId:id,active,expectedRevision:existing?.revision??0,mutationId:crypto.randomUUID()};ideaMutation(args);
    const item=queue(state,ownerId,'setTripIdea',args,[...new Set([previous?.id,creation?.id].filter(Boolean))]);item.baseAssociation=copy(existing??{tripId,knowledgeId:id,active:false,revision:0});row.generation++;return copy(item);
  });
}
function adoptSource(row,source,ownerId){
  if(source.ownerId!==ownerId||source.id!==row.knowledgeId||!Number.isInteger(source.revision)||source.revision<1)throw new Error('Invalid owner-scoped Knowledge response');
  if(row.source&&JSON.stringify(row.source)===JSON.stringify(source))return;
  if(!row.source||source.revision>=row.source.revision){row.source=copy(source);row.generation++;}
}
export async function cacheKnowledge(store,ownerId,source,{pin=false}={}){
  if(source.ownerId!==ownerId||source.operationalContext!==undefined)throw new Error('Cache canonical Knowledge only; packet/Ideas projections are not source snapshots');
  return store.knowledgeTransaction(ownerId,state=>{
    let row=record(state,ownerId,source.id);if(!row){row={id:knowledgeKey(ownerId,source.id),ownerId,knowledgeId:source.id,generation:0,associations:{}};state.knowledge.push(row);}
    adoptSource(row,source,ownerId);row.pinned||=pin;return visible(row,state);
  });
}
export async function cacheAssociation(store,ownerId,id,value){
  return store.knowledgeTransaction(ownerId,state=>{
    const row=record(state,ownerId,id);if(!row||value.knowledgeId!==id||!Number.isInteger(value.revision)||value.revision<0)throw new Error('Invalid association response');
    const old=row.associations[value.tripId];if(!old||value.revision>=old.revision){row.associations[value.tripId]=copy(value);row.generation++;}return visible(row,state);
  });
}
// Save exact page scope, not a deletion/change feed. Request IDs prevent late search replacement.
export async function beginKnowledgeQuery(store,ownerId,input={}){
  const scope=knowledgeQuery(input),id=knowledgeKey(ownerId,JSON.stringify(scope)),requestId=crypto.randomUUID();
  await store.knowledgeTransaction(ownerId,state=>{const old=state.queries.find(x=>x.id===id);const value={...old,id,ownerId,scope,requestId,complete:false};if(old)Object.assign(old,value);else state.queries.push(value);});return {id,requestId};
}
export async function cacheKnowledgePage(store,ownerId,ticket,page){
  return store.knowledgeTransaction(ownerId,state=>{
    const query=state.queries.find(x=>x.id===ticket.id);if(!query||query.requestId!==ticket.requestId)return false;
    for(const value of page.items){if(value.ownerId!==ownerId)throw new Error('Knowledge page owner changed');
      // Ideas flags are annotations. Never persist a contextual projection as canonical.
      const {ideaAssociation,operationalContext,tripEventIds,associatedTripIds,...source}=value;
      let row=record(state,ownerId,source.id);if(!row){row={id:knowledgeKey(ownerId,source.id),ownerId,knowledgeId:source.id,generation:0,associations:{}};state.knowledge.push(row);}adoptSource(row,source,ownerId);
      if(ideaAssociation&&(!row.associations[ideaAssociation.tripId]||row.associations[ideaAssociation.tripId].revision<=ideaAssociation.revision))row.associations[ideaAssociation.tripId]=copy(ideaAssociation);
      if(query.scope.tripId){row.tripReasons??={};row.tripReasons[query.scope.tripId]={operationalContext:Boolean(operationalContext),tripEventIds:tripEventIds??[]};}
      if(associatedTripIds)row.associatedTripIds=copy(associatedTripIds);
    }
    Object.assign(query,{ids:page.items.map(x=>x.id),nextCursor:page.nextCursor,complete:query.scope.cursor===null&&page.nextCursor===null&&!state.mutations.some(live),fetchedAt:new Date().toISOString()});return true;
  });
}
export async function localKnowledgeQuery(store,ownerId,input={}){
  const scope=knowledgeQuery(input);return store.knowledgeTransaction(ownerId,state=>{
    const query=state.queries.find(x=>x.id===knowledgeKey(ownerId,JSON.stringify(scope)));
    const items=state.knowledge.map(row=>({row,value:visible(row,state)})).filter(({row,value:k})=>(!scope.cursor||k.id>scope.cursor)&&(!scope.tag||hasTag(k.tags,scope.tag))&&(!scope.query||[k.title,k.content,...(k.tags??[])].some(v=>tagKey(v??'').includes(scope.query)))&&(!scope.tripId||k.associations[scope.tripId]?.active||row.tripReasons?.[scope.tripId]?.operationalContext||row.tripReasons?.[scope.tripId]?.tripEventIds.length)).map(x=>x.value).sort((a,b)=>a.id.localeCompare(b.id));
    const complete=Boolean(query?.complete)&&items.length<=scope.limit&&items.every(k=>query.ids.includes(k.id));
    return {scope,complete,nextCursor:query?.nextCursor??null,items:items.slice(0,scope.limit)};
  });
}
export async function evictKnowledge(store,ownerId,keep=200){
  if(!Number.isInteger(keep)||keep<0)throw new TypeError('Invalid cache bound');
  return store.knowledgeTransaction(ownerId,state=>{const eligible=state.knowledge.filter(row=>!row.pinned&&!state.mutations.some(m=>target(m)===row.knowledgeId&&live(m)));const remove=new Set(eligible.slice(0,Math.max(0,state.knowledge.length-keep)).map(x=>x.id));state.knowledge=state.knowledge.filter(x=>!remove.has(x.id));for(const query of state.queries)if(query.ids?.some(id=>remove.has(knowledgeKey(ownerId,id))))query.complete=false;return remove.size;});
}
export async function openKnowledge(store,api,session,id){
  const stamp=session.stamp(),local=await localKnowledge(store,stamp.ownerId,id);
  // Explicit opening only: return local data without waiting for identity/network.
  const refresh=(async()=>{if(!await verify(api,session,stamp))return null;const source=await api.get(id);if(!session.matches(stamp))return null;return cacheKnowledge(store,stamp.ownerId,source,{pin:true});})();
  return {local,refresh};
}
async function verify(api,session,stamp){if(!session.matches(stamp)||!stamp.ownerId)return false;const identity=await api.identity();return session.matches(stamp)&&identity.ownerId===stamp.ownerId;}
export async function replayKnowledge(store,api,id,session){
  const stamp=session.stamp();if(!stamp.ownerId)return false;
  const current=await store.knowledgeTransaction(stamp.ownerId,state=>state.mutations.find(m=>m.id===id));if(!current)return true;
  if(['conflict','blocked','resolved'].includes(current.state))return true;
  try{
    if(!await verify(api,session,stamp))return false;
    const claimed=await store.knowledgeTransaction(stamp.ownerId,state=>{
      const m=state.mutations.find(x=>x.id===id);if(!m||!session.matches(stamp))return null;
      if(m.dependencies.some(dep=>{const parent=state.mutations.find(x=>x.id===dep);return parent?.state!=='acknowledged'||!parent.reconciled;}))return null;
      if(!m.attempted&&m.operation==='editGlobalKnowledge'){const parent=state.mutations.find(x=>m.dependencies.includes(x.id)&&x.operation!=='setTripIdea');if(parent)m.arguments.expectedRevision=parent.result.revision;}
      if(!m.attempted&&m.operation==='setTripIdea'){const parent=state.mutations.find(x=>m.dependencies.includes(x.id)&&x.operation==='setTripIdea');if(parent)m.arguments.expectedRevision=parent.result.revision;}
      if(m.state!=='acknowledged'){m.attempted=true;m.state='sending';}return copy(m);
    });if(!claimed)return true;
    const result=claimed.state==='acknowledged'?claimed.result:await api.mutate(claimed);
    if(!Number.isInteger(result?.revision)||result.revision<1||(claimed.operation==='setTripIdea'?(result.knowledgeId!==target(claimed)||result.tripId!==claimed.arguments.tripId||result.active!==claimed.arguments.active):(result.id!==target(claimed)||result.ownerId!==stamp.ownerId)))throw new Error('Invalid Knowledge acknowledgement');
    // Persist acknowledgement in its original owner partition even if auth changed in flight.
    await store.knowledgeTransaction(stamp.ownerId,state=>{const m=state.mutations.find(x=>x.id===id);if(m){m.result=result;m.state='acknowledged';m.reconciled=false;}});
    if(!await verify(api,session,stamp))return false;
    const fresh=claimed.operation==='setTripIdea'?await api.association(claimed.arguments.tripId,target(claimed)):await api.get(target(claimed));
    if(!session.matches(stamp))return false;
    await store.knowledgeTransaction(stamp.ownerId,state=>{
      const m=state.mutations.find(x=>x.id===id),row=record(state,stamp.ownerId,target(claimed));if(!m||!row)return;
      if(claimed.operation==='setTripIdea'){const old=row.associations[fresh.tripId];if(fresh.knowledgeId!==row.knowledgeId)throw new Error('Invalid association target');if(!old||fresh.revision>=old.revision)row.associations[fresh.tripId]=fresh;}else adoptSource(row,fresh,stamp.ownerId);
      m.reconciled=true;
    });return true;
  }catch(error){
    await store.knowledgeTransaction(stamp.ownerId,state=>{const m=state.mutations.find(x=>x.id===id);if(m&&m.state!=='acknowledged'){m.state=error.code==='revision_conflict'?'conflict':['not_found','invalid_semantic_input'].includes(error.code)?'blocked':'pending';m.error={code:error.code??'network_error',message:error.message,actual:error.actual??null};}});
    return error.code==='revision_conflict'||['not_found','invalid_semantic_input'].includes(error.code);
  }
}
// Explicit rebase keeps the original draft/receipt as resolved history and creates a new identity.
export async function resolveKnowledgeConflict(store,ownerId,id,{generation,choice,patch}={}){
  if(!['server','rebase'].includes(choice))throw new TypeError('Choose server or rebase');if(choice==='rebase')patch=knowledgeFields(patch);
  return store.knowledgeTransaction(ownerId,state=>{
    const m=state.mutations.find(x=>x.id===id),row=m&&record(state,ownerId,target(m));
    if(!m||m.state!=='conflict'||m.operation!=='editGlobalKnowledge'||!row?.source||row.generation!==generation)throw new Error('Review current source and local draft before resolving');
    const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const x of state.mutations)if(x.dependencies.some(dep=>ids.has(dep))&&!ids.has(x.id)){if(x.state==='acknowledged')throw new Error('A dependent write already synchronized');ids.add(x.id);changed=true;}}
    for(const x of state.mutations.filter(x=>ids.has(x.id))){x.state='resolved';x.resolution=choice;}row.generation++;
    return choice==='rebase'?copy(queue(state,ownerId,'editGlobalKnowledge',{knowledgeId:row.knowledgeId,patch,expectedRevision:row.source.revision})):copy(m);
  });
}
export async function resolveAssociationConflict(store,ownerId,id,{generation,choice,active}={}){
  if(!['server','rebase'].includes(choice)||choice==='rebase'&&typeof active!=='boolean')throw new TypeError('Choose server or an explicit association state');
  return store.knowledgeTransaction(ownerId,state=>{
    const m=state.mutations.find(x=>x.id===id),row=m&&record(state,ownerId,target(m)),association=row?.associations?.[m?.arguments.tripId];
    if(!m||m.state!=='conflict'||m.operation!=='setTripIdea'||!association||row.generation!==generation)throw new Error('Review current membership and draft before resolving');
    const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const x of state.mutations)if(x.dependencies.some(dep=>ids.has(dep))&&!ids.has(x.id)){if(x.state==='acknowledged')throw new Error('A dependent write already synchronized');ids.add(x.id);changed=true;}}
    for(const x of state.mutations.filter(x=>ids.has(x.id))){x.state='resolved';x.resolution=choice;}row.generation++;
    return choice==='rebase'?copy(queue(state,ownerId,'setTripIdea',{tripId:m.arguments.tripId,knowledgeId:row.knowledgeId,active,expectedRevision:association.revision})):copy(m);
  });
}
export async function knowledgeMutationGroup(store,ownerId,id){return store.knowledgeTransaction(ownerId,state=>{
  const root=state.mutations.find(x=>x.id===id);if(!root)throw new Error('Saved change no longer exists');const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const x of state.mutations)if(x.dependencies.some(dep=>ids.has(dep))&&!ids.has(x.id)){ids.add(x.id);changed=true;}}
  return state.mutations.filter(x=>ids.has(x.id)&&live(x)).map(copy);
});}
export async function discardKnowledgeGroup(store,ownerId,id,fingerprint){return store.knowledgeTransaction(ownerId,state=>{
  const root=state.mutations.find(x=>x.id===id);if(!root)throw new Error('Saved change no longer exists');const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const x of state.mutations)if(x.dependencies.some(dep=>ids.has(dep))&&!ids.has(x.id)){ids.add(x.id);changed=true;}}
  const group=state.mutations.filter(x=>ids.has(x.id)&&live(x));if(JSON.stringify(group)!==fingerprint)throw new Error('Saved changes changed. Review again.');
  if(group.some(x=>x.state==='acknowledged'||x.attempted&&!['conflict','blocked'].includes(x.state)))throw new Error('A write may already be saved online. Synchronize before discarding.');
  for(const x of group){x.state='resolved';x.resolution='discard';}
  const row=record(state,ownerId,target(root));if(row){row.generation++;if(!row.source&&!state.mutations.some(x=>target(x)===row.knowledgeId&&live(x)))state.knowledge=state.knowledge.filter(x=>x.id!==row.id);}
  return {discarded:group.length};
});}
