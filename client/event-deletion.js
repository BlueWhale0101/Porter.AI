/** App-only, online destructive operation. Never optimistic or queued. */
export function installEventDeletion({dialog,event,tripId,api,store,esc,onDeleted}){
  const area=document.createElement('section');area.className='trip-danger';
  area.innerHTML='<h3>Delete this Event</h3><button type="button" id="delete-event" class="destructive">Delete Event…</button><p id="event-delete-message" role="alert"></p>';dialog.append(area);
  const start=area.querySelector('button'),message=area.querySelector('p');
  start.onclick=async()=>{
    start.disabled=true;message.textContent='Checking Event…';
    try{
      if((await store.pending()).some(m=>m.arguments?.tripId===tripId))throw Error('Sync pending edits before deleting an Event.');
      const preview=await api.eventDeletionPreview(event.id);
      if(!dialog.open||!area.isConnected)return;
      if(preview.event.revision!==event.revision)throw Error('This Event changed. Close and Sync before reviewing deletion.');
      message.textContent='';const form=dialog.querySelector('form');form.hidden=true;start.hidden=true;
      const confirm=document.createElement('section');confirm.id='event-delete-confirmation';confirm.innerHTML=`<h2>Delete “${esc(preview.event.title)}”?</h2><p>This permanently deletes this Event${preview.eventIds.length>1?` and its ${preview.eventIds.length-1} child Events`:''}, including their tickets and artifact metadata. Trip Knowledge is kept, with links to these Events removed. This cannot be undone.</p><button type="button" id="keep-event">Keep Event</button><button type="button" id="confirm-event-delete" class="destructive">Permanently delete Event</button>`;area.insertBefore(confirm,message);
      confirm.querySelector('#keep-event').onclick=()=>{confirm.remove();form.hidden=false;start.hidden=false;};
      confirm.querySelector('#confirm-event-delete').onclick=async()=>{
        const buttons=[...dialog.querySelectorAll('button')],prevent=e=>e.preventDefault();buttons.forEach(b=>b.disabled=true);dialog.addEventListener('cancel',prevent);let accepted=false;message.textContent='Deleting Event…';
        try{const result=await api.deleteEvent(event.id,preview.expected);accepted=true;await store.removeEvents(tripId,result.eventIds);await onDeleted(result);}
        catch(error){message.textContent=accepted?'Deleted on the server. Close and Sync to finish local cleanup.':error.code==='revision_conflict'?'This Trip changed. Nothing was deleted. Close and Sync before trying again.':`Deletion was not confirmed. Your Event is retained. ${error.message}`;}
        finally{dialog.removeEventListener('cancel',prevent);buttons.forEach(b=>b.disabled=false);}
      };
    }catch(error){message.textContent=error.message;}finally{start.disabled=false;}
  };
}
