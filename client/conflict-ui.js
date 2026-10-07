import { conflictGroup,conflictFingerprint,discardConflict,retryConflict,mutationDiagnostics } from './conflicts.js';
import { validatePacket } from './core.js';

export async function openConflictRecovery({id,store,packet,api,dialog:d,esc,onResolved,onReedit}){
  const group=conflictGroup(await store.allMutations(),id),fingerprint=conflictFingerprint(group),mutation=group.find(x=>x.id===id),info=mutationDiagnostics(mutation,{packet});
  const localTitle=mutation.arguments?.patch?.title??mutation.arguments?.event?.title;
  const extra=group.length-1;
  d.innerHTML=`<button type="button" id="close">Close</button><h2>Resolve local edit</h2><p>The server changed before this edit could synchronize. Your local edit has not overwritten it.</p><p><strong>${esc(packet.events[info.eventId]?.title??info.operation)}</strong></p>${localTitle?`<p>Local title: ${esc(localTitle)}</p>`:''}<small>${esc(info.operation)} · ${esc(info.eventId??info.knowledgeId??info.tripId)}<br>Expected revision ${info.expectedRevision??'unknown'} · last known server revision ${info.currentRevision??'unknown'}</small><p>${extra?`${extra} later dependent edit(s) must also be discarded if you discard this edit.`:'Only this local edit will be discarded.'}</p><button type="button" data-discard>Discard local edit</button><button type="button" data-retry>Retry unchanged</button>${mutation.operation==='updateEvent'&&!info.eventId?.startsWith('pending:')?'<button type="button" data-review>Review current Event and re-edit</button>':''}<p data-recovery-message role="alert"></p><section data-recovery-review></section>`;
  d.querySelector('#close').onclick=()=>d.close();
  const message=d.querySelector('[data-recovery-message]'),review=d.querySelector('[data-recovery-review]');
  let busy=false;
  const run=async action=>{if(busy)return;busy=true;message.textContent='';try{await action();}catch(error){message.textContent=error.message;}finally{busy=false;}};
  d.querySelector('[data-retry]').onclick=()=>run(async()=>{await retryConflict(store,id,fingerprint);d.close();await onResolved();});
  const confirm=(event=null)=>{
    review.innerHTML=`<h3>${event?'Re-edit current server Event':'Discard local edit?'}</h3><p>${event?`Current server title: ${esc(event.title)} · revision ${event.revision}. The editor will start from this server Event, not automatically merge your old draft.`:'Keep the last synchronized server data and remove this local edit.'}${extra?` This also removes ${extra} dependent local edit(s).`:''}</p><button type="button" data-confirm-discard>${event?'Discard local edits and open editor':'Confirm discard'}</button><button type="button" data-keep>Keep local edits</button>`;
    review.querySelector('[data-keep]').onclick=()=>review.replaceChildren();
    review.querySelector('[data-confirm-discard]').onclick=()=>run(async()=>{
      await discardConflict(store,id,fingerprint);
      if(event)await onReedit(event);else{d.close();await onResolved();}
    });
  };
  d.querySelector('[data-discard]').onclick=()=>confirm();
  d.querySelector('[data-review]')?.addEventListener('click',()=>run(async()=>{
    message.textContent='Loading current server Event…';
    const fresh=validatePacket(await api.packet(packet.trip.id,null,{signal:AbortSignal.timeout(30000)}));
    const event=fresh.events[info.eventId];if(!event)throw new Error('Event is no longer available. You can discard the local edit.');
    message.textContent='';confirm(event);
  }));
}
