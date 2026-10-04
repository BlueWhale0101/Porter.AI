export function workerMessage(worker, message) {
  if(!worker)return Promise.resolve(null);
  return new Promise(resolve=>{
    const channel=new MessageChannel();
    const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};
    const timer=setTimeout(()=>finish(null),2000);
    channel.port1.onmessage=event=>finish(event.data);
    worker.postMessage(message,[channel.port2]);
  });
}

/** Explicit consent + ownership checks both before activation and before reload. */
export function createUpdateController({interactions, activate, reload, changed=()=>{}}) {
  const state={available:false,requested:false,applying:false,reloadPending:false,error:null};
  let reloaded=false;
  const notify=()=>changed({...state});
  const safe=async()=>{
    if(interactions.active)return notify();
    if(state.reloadPending&&state.requested&&!reloaded){reloaded=true;reload();return;}
    if(!state.available||!state.requested||state.applying)return notify();
    state.applying=true;notify();
    try{const result=await activate();if(!result?.accepted){state.applying=false;state.requested=false;state.error=result?.reason??'Update unavailable. Try again.';notify();}}
    catch{state.applying=false;state.requested=false;state.error='Update unavailable. Try again.';notify();}
  };
  return {state,ready(){state.available=true;notify();},request(){state.requested=true;state.error=null;return safe();},safe,
    controllerChanged(){if(!state.requested)return;state.reloadPending=true;return safe();}};
}

export function installUpdates({interactions,revision,onError=()=>{}}) {
  const panel=document.createElement('aside');panel.id='porter-update';panel.hidden=true;
  panel.innerHTML='<span role="status"></span> <button type="button">Update</button>';
  document.querySelector('.masthead').after(panel);
  let registration,runningBuild=null,waitingBuild=null;
  const controller=createUpdateController({interactions,reload:()=>location.reload(),
    activate:()=>workerMessage(registration?.waiting,{type:'porter-activate'}),
    changed:state=>{
      panel.hidden=!state.available;
      panel.querySelector('span').textContent=state.error??(state.requested?(interactions.active?'Porter update queued · finish the current action':'Updating Porter…'):'Porter update ready');
      panel.querySelector('button').disabled=state.requested;
    }});
  panel.querySelector('button').onclick=()=>controller.request();
  const inspect=async()=>{
    if(registration?.waiting){waitingBuild=await workerMessage(registration.waiting,{type:'porter-build'});controller.ready();}
  };
  const check=async()=>{try{await registration?.update();await inspect();}catch{onError('update_check_failed');}};
  navigator.serviceWorker.addEventListener('controllerchange',()=>controller.controllerChanged());
  navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(async reg=>{
    registration=reg;
    const identity=await workerMessage(navigator.serviceWorker.controller??reg.active,{type:'porter-build'});
    if(identity?.revision===revision)runningBuild=identity.buildId;
    const watch=()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')inspect();});};
    reg.addEventListener('updatefound',watch);watch();await inspect();await check();
  }).catch(()=>onError('registration_failed'));
  addEventListener('online',check);
  addEventListener('pageshow',check);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});
  // Detection only: a long-lived foreground window must not stay stale indefinitely.
  setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)check();},5*60*1000);
  return {safe:controller.safe,snapshot:()=>({runningRevision:revision,runningBuild,waitingBuild,...controller.state})};
}
