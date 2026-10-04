// Network-only boundary. Constructing this client performs no I/O or authentication.
export function sessionFetch({fetcher=fetch,onAuthenticationRequired=()=>{}}={}) {
  let refresh;
  return async function request(url,options={}) {
    const send=()=>fetcher(url,{...options,credentials:'same-origin'});
    let response=await send();
    if(response.status===401){
      refresh??=fetcher('/auth/refresh',{method:'POST',credentials:'same-origin'}).finally(()=>{refresh=null;});
      if((await refresh).ok)response=await send();
      if(response.status===401)onAuthenticationRequired();
    }
    return response;
  };
}
export function installSignIn({button,interactions,onClose,onSignedIn}) {
  const dialog=document.createElement('dialog');dialog.id='sign-in-dialog';document.body.append(dialog);
  button.onclick=()=>{
    if(interactions.active)return;
    const owner=interactions.begin('sign-in');
    dialog.innerHTML='<button data-close>Close</button><h2>Porter sign in</h2><p>Sign in to synchronize. Saved Trips and tickets remain available on this device.</p><form><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form><button data-logout>Disconnect sync</button><p role="status"></p>';
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>onClose(owner),{once:true});dialog.showModal();
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,submit=form.querySelector('button');submit.disabled=true;
      try{const response=await fetch('/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.elements.email.value.trim(),password:form.elements.password.value})});
        form.elements.password.value='';
        if(!response.ok)throw new Error(response.status===429?'Please wait a few minutes and try again.':'Sign in failed. Check your Porter account and password.');
        button.textContent='Account';dialog.close();await onClose(owner);await onSignedIn();
      }catch(error){dialog.querySelector('[role=status]').textContent=error.message;}finally{submit.disabled=false;}
    };
    dialog.querySelector('[data-logout]').onclick=async()=>{
      try{const response=await fetch('/auth/logout',{method:'POST',credentials:'same-origin'});if(!response.ok)throw new Error();button.textContent='Sign in';dialog.querySelector('[role=status]').textContent='Sync disconnected. Local travel data is still saved on this device.';}catch{dialog.querySelector('[role=status]').textContent='Connect to the internet to disconnect this session.';}
    };
  };
}
