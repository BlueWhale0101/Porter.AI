import { localDateTimeValue } from './planning.js';
import { validTimezone } from '../src/temporal.js';

export const timezoneLabel=zone=>zone==='UTC'?'UTC':zone.split('/').slice(1).join(' · ').replaceAll('_',' ')||zone;
let zones;
export function timezoneChoices(extra=[]){
  zones??=Intl.supportedValuesOf?.('timeZone')??['UTC','Europe/London','Europe/Rome','Australia/Darwin','America/Los_Angeles'];
  return [...new Set([...zones,...extra.filter(validTimezone),'UTC',Intl.DateTimeFormat().resolvedOptions().timeZone])].sort((a,b)=>timezoneLabel(a).localeCompare(timezoneLabel(b)));
}
export function inferTimezone(packet,day,{deviceZone=Intl.DateTimeFormat().resolvedOptions().timeZone,now=new Date().toISOString()}={}){
  const wanted=day&&/^\d{4}-\d{2}-\d{2}$/.test(day)?day:localDateTimeValue(now,deviceZone).slice(0,10);
  const candidates=[];
  for(const event of Object.values(packet.events??{})){
    if(event.commitment==='cancelled')continue;
    const t=event.temporal??{},start=localDateTimeValue(t.start,t.startTimezone).slice(0,10),end=localDateTimeValue(t.end,t.endTimezone??t.startTimezone).slice(0,10);
    if(!event.movement&&start&&validTimezone(t.startTimezone)&&(start===wanted||(end&&start<=wanted&&wanted<=end)))candidates.push({zone:t.startTimezone,day:start,distance:0,rank:event.accommodation?0:1});
    for(const [date,zone] of [[start,t.startTimezone],[end,t.endTimezone??t.startTimezone]])if(date&&validTimezone(zone))candidates.push({zone,day:date,distance:Math.abs(Date.parse(date)-Date.parse(wanted)),rank:2});
  }
  candidates.sort((a,b)=>a.distance-b.distance||a.rank-b.rank||b.day.localeCompare(a.day)||a.zone.localeCompare(b.zone));
  return candidates[0]?.zone??(validTimezone(deviceZone)?deviceZone:'UTC');
}

/** Editor draft only: never writes, queues, closes or reacts to page lifecycle. */
export function installTimezonePicker(form,packet,existing={}){
  const all=timezoneChoices([existing.temporal?.startTimezone,existing.temporal?.endTimezone].filter(Boolean));
  const movement=form.elements.movement,start=form.elements.startTimezone,end=form.elements.endTimezone;
  const manual={startTimezone:Boolean(existing.temporal?.startTimezone),endTimezone:Boolean(existing.temporal?.endTimezone)};
  const chosen={startTimezone:existing.temporal?.startTimezone,endTimezone:existing.temporal?.endTimezone};
  const draw=(select,zone,query='')=>{
    select.replaceChildren(...all.filter(id=>id===zone||timezoneLabel(id).toLowerCase().includes(query.toLowerCase())).map(id=>new Option(timezoneLabel(id),id,false,id===zone)));
    select.dataset.automatic=String(!manual[select.name]);
  };
  const update=()=>{
    const day=form.elements.start.value.slice(0,10);
    const zone=manual.startTimezone?chosen.startTimezone:inferTimezone(packet,day);
    draw(start,zone,form.querySelector('[data-zone-search=startTimezone]').value);
    const endZone=!movement.checked?zone:manual.endTimezone?chosen.endTimezone:inferTimezone(packet,form.elements.end.value.slice(0,10)||day);
    draw(end,endZone,form.querySelector('[data-zone-search=endTimezone]').value);
    form.querySelector('[data-end-zone]').hidden=!movement.checked;
    form.querySelector('[data-zone-label]').textContent=movement.checked?'Departure timezone':'Timezone';
    form.querySelector('[data-zone-mode]').textContent=manual.startTimezone?'Selected by you':'Automatic from Trip or device';
  };
  draw(start,existing.temporal?.startTimezone??inferTimezone(packet,null));
  draw(end,existing.temporal?.endTimezone??start.value);
  // Legacy instants without a display zone must not disappear on an unrelated edit.
  if(existing.temporal?.start&&!existing.temporal.startTimezone)form.elements.start.value=localDateTimeValue(existing.temporal.start,start.value);
  if(existing.temporal?.end&&!existing.temporal.endTimezone)form.elements.end.value=localDateTimeValue(existing.temporal.end,movement.checked?end.value:start.value);
  for(const select of [start,end])select.onchange=()=>{manual[select.name]=true;chosen[select.name]=select.value;update();};
  for(const search of form.querySelectorAll('[data-zone-search]'))search.oninput=()=>{const select=form.elements[search.dataset.zoneSearch];draw(select,select.value,search.value);};
  form.elements.start.addEventListener('input',update);form.elements.end.addEventListener('input',update);movement.addEventListener('change',update);update();
}

/** Only a trusted activation of the separate Save button commits the draft.
 * Native/implicit form submissions (including keyboard Done) are inert. */
export function installExplicitSave(form,save){
  const button=form.querySelector('[data-save-event]');let saving=false;
  form.onsubmit=event=>event.preventDefault();
  form.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target!==button&&event.target.tagName!=='TEXTAREA')event.preventDefault();});
  button.onclick=async event=>{
    if(!event.isTrusted||saving||document.visibilityState!=='visible')return;
    if(!form.reportValidity())return;
    saving=true;button.disabled=true;
    try{await save();}finally{saving=false;button.disabled=false;}
  };
}
