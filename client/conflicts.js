// Queue recovery is local management, not a new semantic mutation or merge engine.
export const QUEUE_OPERATIONS=['createTrip','updateTrip','createEvent','updateEvent','createKnowledge','updateKnowledge','setCurrentParking','clearCurrentParking'];
const codes=['revision_conflict','authentication_failed','invalid_semantic_input','not_found','backend_error','network_error'];
const number=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const id=value=>typeof value==='string'&&/^[\w:.-]{1,160}$/.test(value)?value:null;
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function mutationFailure(error,now=new Date().toISOString()){
  return {errorCode:codes.includes(error.code)?error.code:'network_error',currentRevision:number(error.actual),updatedAt:now};
}
export function mutationDiagnostics(mutation,{packet,projectedEventIds=new Set(),projectedParkingIds=new Set()}={}){
  const args=mutation.arguments??{},operation=QUEUE_OPERATIONS.includes(mutation.operation)?mutation.operation:'unknown';
  const eventId=args.eventId??mutation.result?.id??(operation==='createEvent'?`pending:${mutation.id}`:null);
  const errorCode=codes.includes(mutation.errorCode)?mutation.errorCode:mutation.state==='conflict'?'revision_conflict':mutation.error?'network_error':null;
  return {id:id(mutation.id),operation,tripId:id(args.tripId),eventId:id(eventId),knowledgeId:id(args.knowledgeId),state:['conflict','sending','acknowledged','pending'].includes(mutation.state)?mutation.state:'pending',createdAt:time(mutation.createdAt),updatedAt:time(mutation.updatedAt),expectedRevision:number(args.expectedRevision),currentRevision:number(packet?.events?.[eventId]?.revision??packet?.knowledge?.find(k=>k.id===args.knowledgeId)?.revision??(operation==='updateTrip'?packet?.trip?.revision:null)??mutation.currentRevision),errorCode,error:errorCode==='revision_conflict'?'Server revision changed; explicit resolution required.':errorCode?'Synchronization failed; retry or inspect connection/sign-in.':null,projected:projectedEventIds.has(mutation.id)||projectedParkingIds.has(mutation.id),dependsOn:id(mutation.dependsOn)};
}
export function conflictGroup(rows,id){
  const selected=rows.find(x=>x.id===id);
  if(!selected||selected.state!=='conflict')throw new Error('This conflict changed. Close and reopen recovery.');
  const ids=new Set([id]);let changed=true;
  while(changed){changed=false;for(const row of rows)if(row.dependsOn&&ids.has(row.dependsOn)&&!ids.has(row.id)){ids.add(row.id);changed=true;}}
  if(rows.some(x=>ids.has(x.id)&&x.state==='acknowledged'))throw new Error('A dependent edit has synchronized. Close and synchronize before recovery.');
  return rows.filter(x=>ids.has(x.id));
}
export const conflictFingerprint=rows=>JSON.stringify(rows);
export async function discardConflict(store,id,expected){
  return store.changeQueue(rows=>{
    const group=conflictGroup(rows,id);
    if(conflictFingerprint(group)!==expected)throw new Error('The local edits changed. Close and review them again.');
    const ids=new Set(group.map(x=>x.id));for(let i=rows.length-1;i>=0;i--)if(ids.has(rows[i].id))rows.splice(i,1);
    return {removedIds:[...ids]};
  });
}
export async function retryConflict(store,id,expected){
  return store.changeQueue(rows=>{
    const group=conflictGroup(rows,id);
    if(conflictFingerprint(group)!==expected)throw new Error('The local edits changed. Close and review them again.');
    const selected=group.find(x=>x.id===id);selected.state='pending';selected.updatedAt=new Date().toISOString();
    // Deliberately retain the exact arguments, mutation ID and expected revision.
    return structuredClone(selected);
  });
}
export function queueBlocked(mutation,rows){
  const parent=rows.find(x=>x.id===mutation.dependsOn);
  if(mutation.dependsOn&&parent?.state!=='acknowledged')return true;
  const args=mutation.arguments??{};
  return rows.some(x=>x.state==='conflict'&&x.id!==mutation.id&&x.arguments?.tripId===args.tripId&&(
    x.operation==='updateTrip'||mutation.operation==='updateTrip'||
    args.eventId&&x.arguments?.eventId===args.eventId||
    args.knowledgeId&&x.arguments?.knowledgeId===args.knowledgeId||
    ['setCurrentParking','clearCurrentParking'].includes(x.operation)&&['setCurrentParking','clearCurrentParking'].includes(mutation.operation)));
}
