import { buildTripPacket } from '../../src/projection.js';
import { MemoryStore, artifactCacheId, checksum } from '../core.js';

export const FIXTURE_NOW='2026-12-10T23:00:00Z';
const participants=[{id:'wes',name:'Wes'},{id:'skye',name:'Skye'},{id:'tor',name:'Tor'}];
const common={createdAt:FIXTURE_NOW,updatedAt:FIXTURE_NOW,revision:1};
const event=(id,title,start,end,aspects={})=>({ ...common,id,tripId:'demo-active',title,description:null,parentEventId:null,participants:[],temporal:start?{start,end,startTimezone:'America/Los_Angeles',endTimezone:'America/Los_Angeles'}:{},spatial:{},booking:{},artifacts:[],provenance:[],commitment:'confirmed',movement:false,accommodation:false,hire:false,visual:{},...aspects});
const knowledge=(id,title,content,rest={})=>({...common,id,tripId:'demo-active',title,content,relatedEventIds:[],participantIds:[],validityWindows:[],locations:[],sources:[],tags:[],...rest});
export function fixtureSource() {
  const trip={...common,id:'demo-active',ownerId:'fixture-only',title:'Los Angeles, slowly',lifecycle:'active',participants,presentation:{},description:'A family journey · December 2026'};
  const start='2026-12-10T00:00:00-08:00',end='2026-12-13T11:00:00-08:00';
  const events=[
    event('stay','The little house by the sea',start,end,{accommodation:true,spatial:{location:{name:'Redondo Beach',address:'Redondo Beach, California'}}}),
    event('hire','Our rental car',start,end,{hire:true,spatial:{location:{name:'LAX return centre',address:'Los Angeles International Airport'}}}),
    event('past','Breakfast at the café','2026-12-10T09:00:00-08:00','2026-12-10T10:00:00-08:00',{commitment:'completed'}),
    event('now','A walk along the pier','2026-12-10T14:30:00-08:00','2026-12-10T15:30:00-08:00',{visual:{visual_role:'city'}}),
    event('opera','Candide at the opera','2026-12-10T19:30:00-08:00','2026-12-10T22:00:00-08:00',{description:'An evening together. Doors open at 6:30 pm. Keep all three passes handy.',participants:['wes','skye','tor'],spatial:{location:{name:'Dorothy Chandler Pavilion',address:'135 N Grand Ave, Los Angeles'}},booking:{expectedAdmissions:participants.map(p=>({id:p.id,participantId:p.id}))}}),
    event('museum','An afternoon at the museum','2026-12-11T13:00:00-08:00','2026-12-11T16:00:00-08:00',{participants:['skye','tor'],commitment:'planned'}),
    event('lunch','Lunch with old friends','2026-12-11T14:00:00-08:00','2026-12-11T15:00:00-08:00',{participants:['wes']}),
    event('spa','A quiet spa morning','2026-12-12T09:00:00-08:00','2026-12-12T12:00:00-08:00',{commitment:'optional'}),
    event('cancelled','Cancelled dinner','2026-12-12T18:00:00-08:00','2026-12-12T19:00:00-08:00',{commitment:'cancelled'}),
    event('train','Train to the coast','2026-12-12T13:00:00-08:00','2026-12-12T15:00:00-08:00',{movement:true,spatial:{origin:{name:'Union Station'},destination:{name:'Oceanside'}}}),
    event('airport','Airport check-in','2026-12-13T17:00:00-08:00','2026-12-13T18:00:00-08:00'),
    event('flight','Flight to Melbourne','2026-12-13T21:00:00-08:00','2026-12-15T08:00:00+11:00',{movement:true,temporal:{start:'2026-12-13T21:00:00-08:00',end:'2026-12-15T08:00:00+11:00',startTimezone:'America/Los_Angeles',endTimezone:'Australia/Melbourne'},spatial:{origin:{name:'LAX'},destination:{name:'Melbourne'}}}),
    event('class','Cooking together',null,null),
    event('market','Market tour','2026-12-12T07:00:00-08:00','2026-12-12T08:00:00-08:00',{parentEventId:'class'}),
    event('cook','Cooking session','2026-12-12T08:00:00-08:00','2026-12-12T09:00:00-08:00',{parentEventId:'class'}),
    event('sparse','Find something unexpected',null,null,{commitment:'optional'}),
  ];
  return {trip,events,knowledge:[knowledge('room','Room','Room 814 · key at reception',{relatedEventIds:['stay']}),knowledge('plate','Vehicle','Blue hatchback · ABC123',{relatedEventIds:['hire']}),knowledge('parking','Parked by the pier','Level B, near the stairs',{tags:['parking','current'],locations:[{latitude:33.839,longitude:-118.391}],validityWindows:[{start:FIXTURE_NOW}]})]};
}
export async function createFixtures(state='ready') {
  const source=fixtureSource(),store=new MemoryStore(),bytes=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="white"/><text x="40" y="100" font-size="28">DEVELOPMENT SAMPLE — NOT VALID</text><text x="40" y="180" font-size="24">Candide · Original cached pass</text></svg>'),sum=await checksum(bytes);
  const opera=source.events.find(e=>e.id==='opera');
  opera.artifacts=participants.map((p,i)=>({id:`pass-${p.id}`,role:'ticket',participantIds:[p.id],satisfiesAdmissionIds:[p.id],mediaType:'image/svg+xml',storageRef:{provider:'fixture'},offlineRequired:true,version:'1',checksum:sum,sourceUrl:'https://example.com/ticket',...(i<2?{code:{format:i?'code128':'qr',value:`PORTER-DEMO-${p.id.toUpperCase()}`}}:{})}));
  if(state==='dynamic')opera.booking.expectedAdmissions.forEach(a=>a.status='external_dynamic');
  if(state==='dynamic')opera.artifacts.forEach(a=>a.appUrl='https://example.com/venue-app');
  for(const perspective of [null,...participants.map(p=>p.id)]) {
    const packet=buildTripPacket(source,{now:FIXTURE_NOW,perspectiveParticipantId:perspective});
    await store.putPacket(source.trip.id,{packet,meta:{usable:true,lastSync:FIXTURE_NOW}},perspective);
  }
  for(const [i,a] of opera.artifacts.entries())if(state!=='missing'&&(state!=='partial'||i<2))await store.putArtifact({id:artifactCacheId(source.trip.id,opera.id,a.id),tripId:source.trip.id,eventId:opera.id,artifactId:a.id,state:'verified',version:a.version,checksum:sum,mediaType:a.mediaType,data:bytes});
  for(const lifecycle of ['upcoming','draft','archived']) {
    const trip={...source.trip,id:`demo-${lifecycle}`,title:{upcoming:'Across the African continent',draft:'A week without plans',archived:'Prague, remembered'}[lifecycle],lifecycle};
    await store.putPacket(trip.id,{packet:buildTripPacket({trip,events:[],knowledge:[]},{now:FIXTURE_NOW}),meta:{usable:true,lastSync:FIXTURE_NOW}});
  }
  if(state==='pending'||state==='conflict')await store.enqueue({id:'demo-edit',operation:'updateEvent',state:state==='conflict'?'conflict':'pending',arguments:{tripId:source.trip.id,eventId:'opera',expectedRevision:1,patch:{description:'Bring the three printed passes as well.'}}});
  if(state!=='empty')await store.setActiveTrip(source.trip.id);
  const api={trips:async()=>state==='empty'?[]:(await store.listTripIndex()),packet:async(id,perspective)=>{if(['failed','pending','conflict'].includes(state))throw new Error('Fixture sync failure');if(state==='syncing')return new Promise(()=>{});return (await store.getPacket(id,perspective)).packet;},artifact:async a=>{const cached=(await store.getArtifacts(source.trip.id)).find(x=>x.artifactId===a.id);if(!cached)throw new Error('Fixture missing pass');return cached;},mutate:async()=>{throw new Error('Development fixture: changes remain local; no production API is called.');}};
  if(state==='empty')store.tripIndex.clear();
  return {store,api,now:FIXTURE_NOW};
}
