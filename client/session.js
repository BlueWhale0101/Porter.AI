import { responseCorrelation, SyncFailure, transportFailure } from './sync-failure.js';

// A packet deadline stops this caller waiting without aborting a shared renewal.
async function waitForRenewal(renewal,signal) {
  if(!signal)return renewal;
  let abort;
  try{
    return await Promise.race([renewal,new Promise((_,reject)=>{
      abort=()=>reject(signal.reason);
      if(signal.aborted)abort();
      else signal.addEventListener('abort',abort,{once:true});
    })]);
  }finally{signal.removeEventListener('abort',abort);}
}

// Network-only boundary. Constructing this client performs no I/O or authentication.
export function sessionFetch({fetcher=fetch,onAuthenticationRequired=()=>{},onAuthentication=()=>{}}={}) {
  let refresh;
  return async function request(url,options={},observation) {
    const {phase,attempt}=observation??{};
    const send=async()=>{
      try{
        const response=await fetcher(url,{...options,credentials:'same-origin'});
        if(attempt)attempt.requests[phase]=responseCorrelation(response);
        return response;
      }catch(error){
        throw observation?transportFailure(phase,error,options.signal):error;
      }
    };
    let response=await send();
    if(response.status!==401)return response;
    const headers=attempt?{'X-Porter-Sync-Attempt':attempt.id}:{};
    refresh??=fetcher('/auth/refresh',{method:'POST',credentials:'same-origin',headers}).finally(()=>{refresh=null;});
    let renewal;
    try{renewal=await waitForRenewal(refresh,observation&&options.signal);}
    catch(error){
      if(!observation||!options.signal?.aborted)onAuthentication({operation:'renewal',state:'failed',status:null,requestId:null});
      if(observation){
        if(options.signal?.reason?.code==='timeout')throw new SyncFailure('session_renewal','network','timeout');
        throw transportFailure('session_renewal',error,options.signal);
      }
      throw error;
    }
    const correlation=responseCorrelation(renewal);
    onAuthentication({operation:'renewal',state:renewal.ok?'succeeded':'failed',...correlation});
    if(attempt)attempt.requests.session_renewal=correlation;
    if(renewal.ok)response=await send();
    if(response.status===401)onAuthenticationRequired();
    if(observation&&!renewal.ok){
      throw new SyncFailure('session_renewal','authentication',renewal.status===401?'authentication_failed':'renewal_failed',correlation);
    }
    return response;
  };
}
export function installSignIn({button,interactions,onClose,onSignedIn,onPostLoginFailure=()=>{},onAuthentication=()=>{},onDisconnected=()=>{}}) {
  const dialog=document.createElement('dialog');dialog.id='sign-in-dialog';document.body.append(dialog);
  button.onclick=()=>{
    if(interactions.active)return;
    const owner=interactions.begin('sign-in');
    dialog.innerHTML='<button data-close>Close</button><h2>Porter sign in</h2><p>Sign in to synchronize. Saved Trips and tickets remain available on this device.</p><form><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form><button data-logout>Disconnect sync</button><p role="status"></p>';
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>onClose(owner),{once:true});dialog.showModal();
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,submit=form.querySelector('button');submit.disabled=true;let accepted=false;
      try{const response=await fetch('/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.elements.email.value.trim(),password:form.elements.password.value})});
        form.elements.password.value='';
        onAuthentication({operation:'login',state:response.ok?'succeeded':'failed',...responseCorrelation(response)});
        if(!response.ok)throw new Error(response.status===429?'Please wait a few minutes and try again.':'Sign in failed. Check your Porter account and password.');
        accepted=true;button.textContent='Account';dialog.close();await onClose(owner);await onSignedIn();
      }catch(error){if(accepted)onPostLoginFailure();else dialog.querySelector('[role=status]').textContent=error.message;}finally{submit.disabled=false;}
    };
    dialog.querySelector('[data-logout]').onclick=async()=>{
      try{const response=await fetch('/auth/logout',{method:'POST',credentials:'same-origin'});if(!response.ok)throw new Error();await onDisconnected();button.textContent='Sign in';dialog.querySelector('[role=status]').textContent='Sync disconnected. Local travel data is still saved on this device.';}catch{dialog.querySelector('[role=status]').textContent='Connect to the internet to disconnect this session.';}
    };
  };
}
