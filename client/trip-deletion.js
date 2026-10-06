/** Explicit online management; deliberately never goes through the mutation queue. */
export function installTripDeletion({dialog,trip,cached,api,store,esc,onDeleted}){
  const area=document.createElement('section');area.className='trip-danger';
  area.innerHTML='<h3>Delete this Trip</h3><p>Permanently remove its itinerary and associated data.</p><button type="button" id="delete-trip" class="destructive">Delete Trip…</button><p role="alert" id="delete-message"></p>';
  dialog.append(area);const message=area.querySelector('#delete-message'),start=area.querySelector('#delete-trip');
  start.onclick=async()=>{
    start.disabled=true;message.textContent='Checking Trip…';
    try{
      const preview=await api.deletionPreview(trip.id);
      if(!dialog.open||!area.isConnected)return;
      if(preview.trip.revision!==trip.revision||(cached&&preview.packetRevision!==cached.revision))throw new Error('This Trip has changed. Close, open the Trip and Sync before reviewing deletion again.');
      message.textContent='';const form=dialog.querySelector('#trip-form');form.hidden=true;start.hidden=true;
      const confirm=document.createElement('section');confirm.id='delete-confirmation';
      confirm.innerHTML=`<h2>Delete “${esc(preview.trip.title)}”?</h2><p>This permanently deletes this Trip, its ${preview.eventCount} Events, ${preview.knowledgeCount} Knowledge records, participants, tickets and associated itinerary data, including unsynced local edits. This cannot be undone.</p><button type="button" id="cancel-delete">Keep Trip</button><button type="button" id="confirm-delete" class="destructive">Permanently delete Trip</button>`;
      area.insertBefore(confirm,message);confirm.querySelector('#cancel-delete').onclick=()=>{confirm.remove();form.hidden=false;start.hidden=false;};
      confirm.querySelector('#confirm-delete').onclick=async()=>{
        const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const prevent=e=>e.preventDefault();dialog.addEventListener('cancel',prevent);message.textContent='Deleting Trip…';let accepted=false;
        try{const result=await api.deleteTrip(trip.id,preview.expected);accepted=true;await store.removeTrip(trip.id);await onDeleted(trip.id,result);}
        catch(error){message.textContent=accepted?'Deleted on the server. Local cleanup failed; retry to clear this device.':error.code==='revision_conflict'?'This Trip changed while you were reviewing it. Nothing was deleted. Close and Sync before trying again.':error.code==='not_found'?'Trip is already unavailable. Close and Sync to clear this device.':`Deletion was not confirmed. Your local Trip is retained. ${error.message}`;}
        finally{dialog.removeEventListener('cancel',prevent);buttons.forEach(b=>b.disabled=false);}
      };
    }catch(error){message.textContent=error.message;}finally{start.disabled=false;}
  };
}
