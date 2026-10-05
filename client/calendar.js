import { calendarProjection } from './planning.js';

// Presentation only. Never derive palette choices from Event semantics.
export const EVENT_COLORS = [
  {id:'terracotta',label:'Terracotta'}, {id:'olive',label:'Olive'},
  {id:'sky',label:'Sky'}, {id:'ochre',label:'Ochre'},
  {id:'lavender',label:'Lavender'}, {id:'rose',label:'Rose'},
  {id:'slate',label:'Slate'},
];
const palette=new Set(EVENT_COLORS.map(x=>x.id));
const date=day=>new Date(`${day}T12:00:00Z`);
export const shiftDay=(day,n)=>new Date(date(day).getTime()+n*86400000).toISOString().slice(0,10);
export function monday(day){const d=date(day).getUTCDay();return shiftDay(day,-((d+6)%7));}
const weekday=new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'});
const shortDay=new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'});
const monthDay=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
export const dayHeading=day=>`${weekday.format(date(day))} · ${monthDay.format(date(day))}`;
export function blockClasses(event){return `calendar-block${palette.has(event.visual?.color)?` color-${event.visual.color}`:''}${event.commitment==='optional'?' tentative':''}${event.pending?' pending':''}${event.pendingConflict?' conflict':''}`;}

/** Fixed waking range keeps weeks comparable. Out-of-range Events stay tappable. */
export function weekProjection(calendar,week=null){
  if(!calendar.days.length)return null;
  const first=monday(calendar.days[0].day),last=monday(calendar.days.at(-1).day);
  const wanted=monday(week??calendar.days.find(d=>d.current)?.day??calendar.days[0].day);
  const start=wanted<first?first:wanted>last?last:wanted;
  const byDay=new Map(calendar.days.map(d=>[d.day,d]));
  return {start,previous:start>first?shiftDay(start,-7):null,next:start<last?shiftDay(start,7):null,
    startHour:6,endHour:23,days:Array.from({length:7},(_,i)=>{
      const day=shiftDay(start,i),source=byDay.get(day)??{day,blocks:[],current:false};
      return {...source,early:source.blocks.filter(b=>b.start<360),late:source.blocks.filter(b=>b.start+b.duration>1380),
        visible:source.blocks.filter(b=>b.start<1380&&b.start+b.duration>360).map(b=>({...b,
          top:(Math.max(360,b.start)-360)/1020*100,
          height:(Math.min(1380,b.start+b.duration)-Math.max(360,b.start))/1020*100}))};
    })};
}

export function calendarMarkup(packet,{mode='week',week=null,now,esc}){
  const calendar=calendarProjection(packet,now?{now}:undefined),overview=weekProjection(calendar,week);
  if(!overview)return {week:null,html:'<section><h2>Calendar</h2><p class="calendar-empty">No scheduled events yet</p></section>'};
  const label=event=>`${event.title}${event.commitment==='optional'?' · Optional (tentative)':''}`;
  const block=(b,style='',short=false)=>`<button class="${blockClasses(b.event)}" data-event="${esc(b.event.id)}" aria-label="${esc(label(b.event))}" title="${esc(label(b.event))}" style="${style}"><strong>${esc(b.event.title)}</strong>${short?'':`<small>${String(Math.floor(b.start/60)).padStart(2,'0')}:${String(b.start%60).padStart(2,'0')}</small>`}</button>`;
  const header=d=>`<h3 class="calendar-date${d.current?' current-day':''}"><span>${shortDay.format(date(d.day))}</span><strong>${monthDay.format(date(d.day))}</strong>${d.current?'<small>Today</small>':''}</h3>`;
  const edges=(name,key)=>overview.days.some(d=>d[key].length)?`<div class="week-edge"><small>${name}</small>${overview.days.map(d=>`<div>${d[key].map(b=>block(b,'',true)).join('')}</div>`).join('')}</div>`:'';
  const weekHtml=`<div class="week-pager"><button data-week="${overview.previous??''}" aria-label="Previous week" ${overview.previous?'':'disabled'}>‹</button><h3>${monthDay.format(date(overview.start))} – ${monthDay.format(date(shiftDay(overview.start,6)))}</h3><button data-week="${overview.next??''}" aria-label="Next week" ${overview.next?'':'disabled'}>›</button></div>
    <p class="calendar-caption">Event-local times · dashed blocks are optional</p>
    <div class="calendar week-overview"><div class="week-head"><span></span>${overview.days.map(header).join('')}</div>${edges('Before 6','early')}
    <div class="week-body"><div class="week-hours">${[6,9,12,15,18,21].map(h=>`<span style="top:${(h-6)/17*100}%">${h}</span>`).join('')}</div>${overview.days.map(d=>`<div class="week-day${d.current?' current-day':''}">${d.visible.map(b=>block(b,`top:${b.top}%;height:${b.height}%;left:${b.lane/b.lanes*100}%;width:${100/b.lanes}%`,true)).join('')}</div>`).join('')}</div>${edges('After 23','late')}</div>`;
  const scheduleHtml=`<p class="calendar-caption">Event-local times · scroll within Schedule</p><div class="calendar-scroll" tabindex="0" aria-label="Detailed Schedule"><div class="calendar schedule" style="--hours:${calendar.endHour-calendar.startHour};--days:${calendar.days.length}"><div class="schedule-corner">Time</div>${calendar.days.map(header).join('')}<div class="schedule-hours">${Array.from({length:calendar.endHour-calendar.startHour},(_,i)=>`<span>${String(calendar.startHour+i).padStart(2,'0')}:00</span>`).join('')}</div>${calendar.days.map(d=>`<div class="calendar-grid">${d.blocks.map(b=>block(b,`top:${(b.start-calendar.startHour*60)*1.2}px;height:${Math.min(b.duration,calendar.endHour*60-b.start)*1.2}px;left:${b.lane/b.lanes*100}%;width:${100/b.lanes}%`)).join('')}</div>`).join('')}</div></div>`;
  return {week:overview.start,html:`<section class="calendar-section"><h2>Calendar</h2><div class="calendar-modes" aria-label="Calendar view"><button data-calendar-mode="week" aria-pressed="${mode==='week'}">Week overview</button><button data-calendar-mode="schedule" aria-pressed="${mode==='schedule'}">Schedule</button></div>${mode==='schedule'?scheduleHtml:weekHtml}</section>`};
}
