export async function diagnosticsSnapshot({store,packet,activeRun,trace,revision,online,sw,swError,lastError,update}) {
  const active=await store.getActiveSelection(),tripId=packet?.trip?.id??active?.tripId??null,perspective=packet?.perspectiveParticipantId??active?.perspectiveParticipantId??null;
  const cached=tripId?await store.getPacket(tripId,perspective):null;
  const artifacts=tripId?await store.getArtifacts(tripId):[],queue=(await store.pending()).filter(x=>x.arguments?.tripId===tripId);
  return {revision,tripId,perspective,packetRevision:packet?.revision??null,generatedAt:packet?.generatedAt??null,lastSuccessfulSync:cached?.meta?.lastSync??null,usefulLocalDataAtLaunch:Boolean(activeRun?.local?.meta?.usable),localPacketUsable:Boolean(cached?.meta?.usable),requiredArtifacts:(packet?.artifactManifest??[]).filter(x=>x.offlineRequired).map(x=>({eventId:x.eventId,artifactId:x.id,present:artifacts.some(a=>a.eventId===x.eventId&&a.artifactId===x.id&&a.state==='verified'&&(!x.version||a.version===x.version)&&(!x.checksum||a.checksum===x.checksum))})),pendingMutations:queue.length,conflicts:queue.filter(x=>x.state==='conflict').length,online,serviceWorker:sw,update:update??null,serviceWorkerError:swError??null,lastRequestError:lastError??null,performance:trace?.json()??null};
}
export function installDiagnostics(snapshot) {
  const panel=document.createElement('details');panel.id='porter-diagnostics';panel.innerHTML='<summary>Porter diagnostics</summary><button data-refresh>Refresh diagnostics</button><button data-copy>Copy diagnostics</button><pre></pre>';document.body.append(panel);
  let value;
  const update=async()=>{value=await snapshot();panel.querySelector('pre').textContent=JSON.stringify(value,null,2);};
  panel.querySelector('[data-refresh]').onclick=update;
  panel.querySelector('[data-copy]').onclick=async()=>{await update();await navigator.clipboard.writeText(JSON.stringify(value,null,2));};
  panel.addEventListener('toggle',()=>{if(panel.open)update();});
}
export async function workerIdentity() {
  const controller=navigator.serviceWorker?.controller;
  if(!controller)return {controlled:false};
  return new Promise(resolve=>{const channel=new MessageChannel();const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};const timer=setTimeout(()=>finish({controlled:true,identity:'unavailable'}),1000);channel.port1.onmessage=event=>finish({controlled:true,...event.data});controller.postMessage({type:'porter-build'},[channel.port2]);});
}
