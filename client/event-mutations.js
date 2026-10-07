import { validateTemporal } from '../src/temporal.js';
import { validateEventVisual } from '../src/event-visual.js';
import { mutationFailure } from './conflicts.js';
export const UNDO_MS=10000;
const target=m=>m.operation==='createEvent'?`pending:${m.id}`:m.arguments?.eventId;
const nextSequence=rows=>Math.max(0,...rows.map(x=>x.sequence??0))+1;
export function validateEventDraft(event){
  if(!event.title?.trim())throw new TypeError('Event title is required');
  validateTemporal(event.temporal??{});validateEventVisual(event.visual);
  if(!['optional','planned','confirmed','completed','cancelled'].includes(event.commitment??'planned'))throw new TypeError('Invalid event commitment');
  if(event.movement?event.spatial?.location:(event.spatial?.origin||event.spatial?.destination))throw new TypeError('Check the Event location fields');
}
/** Only the local transaction is on the Save path. No network or timers here. */
export async function recordEvent(store,mutation,before=null,now=Date.now()){
  validateEventDraft(mutation.arguments.event??{...before,...mutation.arguments.patch});
  return store.changeQueue(rows=>{
    const latest=rows.findLast(x=>target(x)===mutation.arguments.eventId&&x.localEvent&&x.state!=='acknowledged');
    if(latest&&latest.id!==before?.pendingMutationId)throw new Error('A newer local edit exists. Reopen this Event before saving.');
    const prior=before?.pendingMutationId?rows.find(x=>x.id===before.pendingMutationId):null;
    if(prior&&prior.state!=='acknowledged')prior.localEvent=true;
    const inverse=mutation.operation==='updateEvent'?Object.fromEntries(Object.keys(mutation.arguments.patch).map(key=>[key,structuredClone(before?.[key]??null)])):null;
    const value={...structuredClone(mutation),id:crypto.randomUUID(),localEvent:true,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),sequence:nextSequence(rows),undoUntil:now+UNDO_MS,inverse,dependsOn:prior?.id??null};
    rows.push(value);return value;
  });
}
export async function undoEvent(store,id,now=Date.now()){
  return store.changeQueue(rows=>{
    const original=rows.find(x=>x.id===id);
    if(!original||original.undone||now>original.undoUntil)throw new Error('Undo has expired.');
    if(rows.some(x=>x.dependsOn===id))throw new Error('A newer edit exists. Undo that edit first.');
    if(!original.attempted&&original.state!=='acknowledged'){
      rows.splice(rows.indexOf(original),1);return {cancelled:true};
    }
    original.undone=true;
    // Porter has no delete primitive. A committed create is cancelled using the
    // existing commitment, with optimistic concurrency against its own result.
    const mutation={id:crypto.randomUUID(),localEvent:true,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),sequence:nextSequence(rows),operation:'updateEvent',dependsOn:id,undoUntil:0,
      arguments:{tripId:original.arguments.tripId,eventId:original.result?.id??target(original),patch:original.operation==='createEvent'?{commitment:'cancelled'}:original.inverse}};
    rows.push(mutation);return mutation;
  });
}
export async function replayEvent(store,api,id){
  const claimed=await store.changeQueue(rows=>{
    const item=rows.find(x=>x.id===id);if(!item||['acknowledged','conflict'].includes(item.state))return null;
    if(item.dependsOn){const parent=rows.find(x=>x.id===item.dependsOn);if(!parent?.result)throw new Error('Waiting for preceding Event edit');item.arguments.eventId=parent.result.id;item.arguments.expectedRevision=parent.result.revision;}
    item.attempted=true;item.state='sending';item.updatedAt=new Date().toISOString();return structuredClone(item);
  });
  if(!claimed)return;
  try{
    const result=await api.mutate(claimed);
    await store.changeQueue(rows=>{const item=rows.find(x=>x.id===id);if(item){item.state='acknowledged';item.result=result;item.updatedAt=new Date().toISOString();delete item.error;delete item.errorCode;delete item.currentRevision;}});
  }catch(error){
    await store.changeQueue(rows=>{const item=rows.find(x=>x.id===id);if(item){item.state=error.code==='revision_conflict'?'conflict':'pending';item.error=error.message;Object.assign(item,mutationFailure(error));}});throw error;
  }
}
export async function retireEventReceipts(store,packet,now=Date.now()){
  await store.changeQueue(rows=>{
    const remove=rows.filter(x=>x.state==='acknowledged'&&x.undoUntil<now&&x.result?.revision<=packet.events[x.result.id]?.revision&&!rows.some(y=>y.dependsOn===x.id&&y.state!=='acknowledged'));
    for(const item of remove)rows.splice(rows.indexOf(item),1);
  });
}
