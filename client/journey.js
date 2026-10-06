import { parkingProjection } from '../src/parking.js';
import { artifactCacheId, readiness } from './core.js';

const endpoint=value=>typeof value==='string'?value:value?.address??value?.name??value?.label??null;
export function localTime(value,timeZone){if(!value)return null;try{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',...(timeZone?{timeZone}:{})}).format(new Date(value));}catch{return value;}}
export function eventTime(event){const t=event.temporal??{};if(event.movement)return {departure:localTime(t.start,t.startTimezone),arrival:localTime(t.end,t.endTimezone)};return {start:localTime(t.start,t.startTimezone),end:localTime(t.end,t.endTimezone)};}
export function mapUrl(location){if(!location)return null;if(typeof location==='object'&&Number.isFinite(location.latitude)&&Number.isFinite(location.longitude))return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;const query=endpoint(location);return query?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`:null;}
export function navigationFor(event,now=new Date().toISOString()){const spatial=event.spatial??{};if(event.movement){const departed=event.temporal?.start&&Date.parse(now)>=Date.parse(event.temporal.start);return mapUrl(departed?spatial.destination:spatial.origin);}return mapUrl(spatial.location);}
export function pendingParking(mutations,tripId){return mutations.filter(m=>m.operation==='setCurrentParking'&&m.arguments?.tripId===tripId&&m.arguments?.knowledge?.tags?.includes('parking')&&m.arguments?.knowledge?.tags?.includes('current')).map(m=>({...m.arguments.knowledge,pending:true}));}
export function activeJourney(packet,{pendingMutations=[]}={}){return {current:{accommodation:packet.current.accommodation??[],hire:packet.current.hire??[],parking:parkingProjection(packet,pendingMutations)},past:[...(packet.current.past??[])].map(id=>packet.events[id]).filter(Boolean).sort((a,b)=>Date.parse(b.temporal?.end??0)-Date.parse(a.temporal?.end??0)),now:(packet.current.now??[]).map(id=>packet.events[id]).filter(Boolean),next:packet.current.next?packet.events[packet.current.next]:null,later:(packet.current.later??[]).map(id=>packet.events[id]).filter(Boolean)};}
const participantName=(trip,id,index)=>{const item=(trip.participants??[]).find(p=>(typeof p==='string'?p:p.id)===id);return typeof item==='object'?item.name??item.title??`Ticket ${index+1}`:item??`Ticket ${index+1}`;};
const usableExternalUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'||url.protocol==='http:'||(/^[a-z][a-z0-9+.-]*:$/i.test(url.protocol)&&url.protocol!=='javascript:'&&url.protocol!=='data:')?url.href:null;}catch{return null;}};
export function doorEntries(packet,eventId,artifacts){const event=packet.events[eventId];return (packet.access??[]).filter(access=>access.eventId===eventId).map((access,index)=>{const candidates=(access.artifactIds??[]).map(id=>(packet.artifactManifest??[]).find(a=>a.eventId===eventId&&a.id===id)).filter(Boolean);const verified=candidates.map(a=>({manifest:a,cache:artifacts.find(c=>c.id===artifactCacheId(packet.trip.id,eventId,a.id)&&c.state==='verified'&&(!a.version||a.version===c.version)&&(!a.checksum||a.checksum===c.checksum))})).filter(x=>x.cache);const code=verified.find(x=>x.manifest.code);const source=code??verified[0]??null;const metadata=source?.manifest??candidates[0]??{};return {id:access.requirementId,label:participantName(packet.trip,access.participantId,index),status:access.status,ready:Boolean(source)&&access.status!=='external_dynamic',artifact:source?.manifest??null,cache:source?.cache??null,allArtifacts:verified,sourceUrl:usableExternalUrl(metadata.sourceUrl??event.booking?.sourceUrl),appUrl:usableExternalUrl(metadata.appUrl??event.booking?.appUrl)};});}
export function ticketSummary(packet,eventId,artifacts){const eventAccess=(packet.access??[]).filter(x=>x.eventId===eventId);const r=readiness({...packet,access:eventAccess},artifacts);return r.external? 'Requires venue app':`${r.ready}/${r.required} ready offline`;}
export function requestLocation(geolocation){return new Promise((resolve,reject)=>{if(!geolocation?.getCurrentPosition){reject(new Error('Geolocation is unavailable on this device.'));return;}geolocation.getCurrentPosition(position=>resolve({latitude:position.coords.latitude,longitude:position.coords.longitude,capturedAt:new Date(position.timestamp).toISOString()}),()=>reject(new Error('Location unavailable. Please try again when location is available.')),{enableHighAccuracy:false,timeout:10000});});}

/** Compact only when both endpoints share a known zone and calendar day. */
export function journeyTime(event,{now=new Date().toISOString(),locale='en-US'}={}){
  const t=event.temporal??{},zone=t.startTimezone,endZone=t.endTimezone??zone;
  const full=()=>{const parts=eventTime(event);return `${parts.departure??parts.start??'Timing not set'}${parts.arrival?' → '+parts.arrival:parts.end?' – '+parts.end:''}`;};
  if(!t.start||!zone)return full();
  try{
    const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
    if(event.movement||endZone!==zone){
      const stamp=(value,timeZone)=>new Intl.DateTimeFormat(locale,{timeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
      return stamp(t.start,zone)+(t.end?' → '+stamp(t.end,endZone):'');
    }
    if(t.end&&day(t.start)!==day(t.end))return full();
    const formatter=new Intl.DateTimeFormat(locale,{timeZone:zone,hour:'numeric',minute:'2-digit'});
    const time=(t.end?formatter.formatRange(new Date(t.start),new Date(t.end)):formatter.format(new Date(t.start))).replace(/\s*–\s*/g,'–').replace(/\u202f/g,' ');
    return (day(t.start)===day(now)?'':new Intl.DateTimeFormat(locale,{timeZone:zone,year:'numeric',month:'short',day:'numeric'}).format(new Date(t.start))+' · ')+time;
  }catch{return full();}
}
