import { createHash } from 'node:crypto';
import { zonedDateTimeToIso } from '../client/planning.js';

export const SEED='porter-v0-acceptance-v1';
export const TITLE='Porter V0 Acceptance Journey';
export const seedDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Darwin',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const people=[{id:'wes',name:'Wes'},{id:'skye',name:'Skye'},{id:'tor',name:'Tor'}];
const all=people.map(p=>p.id);
const shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);

export function acceptanceData(today=seedDay()) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||new Date(today+'T12:00:00Z').toISOString().slice(0,10)!==today)throw new TypeError('Seed date must be YYYY-MM-DD');
  const events=[],knowledge=[],tickets=[];
  const zone=n=>n<=0?'Europe/London':'Europe/Rome';
  const at=(n,time,tz=zone(n))=>zonedDateTimeToIso(`${shift(today,n)}T${time}`,tz);
  const add=(key,title,n,start,end,extra={})=>{
    const temporal=start?{start:at(n,start),end:at(n,end),startTimezone:zone(n),endTimezone:zone(n)}:{};
    const item={key,title,description:'Synthetic Porter acceptance itinerary. Not a real reservation.',participants:all,commitment:n<0?'completed':'confirmed',temporal,spatial:{location:{name:n<=0?'Central London':'Centro Storico, Rome'}},...extra};events.push(item);return item;
  };
  const movement=(key,title,n,start,end,startZone,endZone,origin,destination,endDay=n)=>add(key,title,n,null,null,{movement:true,temporal:{start:at(n,start,startZone),end:at(endDay,end,endZone),startTimezone:startZone,endTimezone:endZone},spatial:{origin:{name:origin},destination:{name:destination}},description:'Synthetic flight; verify departure and arrival in their own local time zones. No booking exists.'});
  movement('outbound','Arrive in London · overnight flight',-10,'06:00','07:30','Europe/Paris','Europe/London','Paris Charles de Gaulle','London Heathrow');
  movement('mid-flight','London → Rome · afternoon flight',1,'13:00','16:30','Europe/London','Europe/Rome','London Heathrow Terminal 5','Rome Fiumicino Terminal 3');
  movement('return','Return flight · Rome → London',10,'18:00','19:45','Europe/Rome','Europe/London','Rome Fiumicino','London Heathrow');
  for(const [key,title,start,end,location,flag] of [
    ['first-stay','Bloomsbury townhouse · first stay',-10,-5,'Bedford Place, London','accommodation'],
    ['current-stay','South Bank apartment · current base',-5,1,'Belvedere Road, London','accommodation'],
    ['rome-stay','Trastevere courtyard apartment',1,10,'Via della Scala, Rome','accommodation'],
    ['london-car','Hire car · London day trips',-3,1,'Waterloo station, London','hire'],
    ['rome-car','Hire car · countryside loop',2,8,'Roma Termini','hire'],
  ])add(key,title,start,null,null,{[flag]:true,commitment:end<0?'completed':'confirmed',temporal:{start:at(start,'16:00'),end:at(end,'10:00',zone(start)),startTimezone:zone(start),endTimezone:zone(start)},spatial:{location:{name:location}},description:'Multi-day acceptance resource. Check Current State, related Knowledge, checkout and perspective.'});
  const london=[
    ['Breakfast at Borough Market','Borough Market, London','Choose pastries and fruit before the crowds.'],
    ['Natural History galleries','Natural History Museum, London','Allow time for dinosaurs and the mineral gallery; meet by the main stairs.'],
    ['Riverside supper and lights','South Bank, London','An unhurried supper followed by a short walk along the river.'],
    ['Bookshops and a warm drink','Charing Cross Road, London','Browse used books and stop for hot chocolate.'],
    ['Garden sketchbook hour','Kew Gardens, London','Bring a pencil and sketch greenhouse plants.'],
    ['Evening chamber music','Wigmore Hall, London','Arrive early; this synthetic plan has no valid admission.'],
  ];
  const rome=[
    ['Coffee and the morning market','Campo de Fiori, Rome','Pick fruit and watch the stalls open.'],
    ['Mosaics and shaded courtyards','Trastevere, Rome','Follow a short route between churches, with time to sit.'],
    ['Pasta supper in the piazza','Piazza Santa Maria, Rome','Meet beside the fountain before finding a table.'],
    ['Bakery breakfast walk','Testaccio, Rome','Compare breads and find a quiet bench.'],
    ['Villa Borghese play and gallery','Villa Borghese, Rome','Playground first; gallery visit can be split by participant.'],
    ['Twilight river promenade','Lungotevere, Rome','Easy evening loop; take a layer for the walk home.'],
  ];
  for(let n=-10;n<=10;n++){
    const catalog=n<=0?london:rome;
    for(let slot=0;slot<3;slot++){
      const [title,location,description]=catalog[((n+10)%2)*3+slot];
      const participants=slot===0?all:slot===1?(n%3===0?['skye']:n%3===1?['wes']:['skye','tor']):all;
      add(`day-${n+10}-${slot}`,title,n,['09:00','14:00','19:00'][slot],['10:00','16:00','20:30'][slot],{participants,description,spatial:{location:{name:location}},commitment:n<0?'completed':slot===1?'planned':'confirmed'});
    }
  }
  add('wes-overlap','Wes · architecture photo walk',0,'14:30','16:30',{participants:['wes'],spatial:{location:{name:'Barbican, London'}},description:'Overlaps the afternoon plan; check Calendar lanes and Wes perspective.'});
  add('tor-overlap','Tor + Skye · science play session',0,'14:15','15:30',{participants:['skye','tor'],spatial:{location:{name:'Science Museum, London'}}});
  add('optional','Optional · sunrise river photographs',1,'06:00','07:00',{participants:['wes'],commitment:'optional',description:'Must never become operational Next, even when earlier than confirmed plans.'});
  add('cancelled','Cancelled · rooftop tasting',2,'18:00','19:00',{participants:['wes','skye'],commitment:'cancelled',description:'Cancelled synthetic booking; retain for planning context, never operational Next.'});
  add('composite','Ostia day out · family excursion',3,'08:00','18:00',{description:'Composite container; its children, not this parent, drive operational ordering.'});
  add('composite-train','Train to the coast',3,'08:30','09:30',{parentKey:'composite',movement:true,spatial:{origin:{name:'Roma Porta San Paolo'},destination:{name:'Ostia Antica'}}});
  add('composite-ruins','Ruins and picnic under the pines',3,'10:00','13:00',{parentKey:'composite',spatial:{location:{name:'Ostia Antica'}}});
  for(const [key,title,participants] of [['bookshop','Find a tiny independent bookshop',['wes']],['postcards','Choose postcards for home',all],['sketch','Finish the courtyard sketch',['skye']]])add(key,title,4,null,null,{participants,commitment:'optional',description:'Intentionally unscheduled. Find this in Itinerary, not an unexplained Calendar block.'});
  const admissionEvent=(key,title,n,missing=false,dynamic=false)=>{
    const event=add(key,title,n,'18:00','19:30',{booking:{expectedAdmissions:all.map(id=>({id:`${key}-${id}`,participantId:id,...(dynamic?{status:'external_dynamic'}:{})})),...(dynamic?{appUrl:'https://example.invalid/porter-acceptance-app'}:{})},description:'SYNTHETIC ACCEPTANCE TICKETS — NOT VALID FOR ADMISSION. '+(dynamic?'Requires external venue app.':missing?'Tor admission intentionally has no artifact.':'All three admissions must be usable offline.')});
    if(!dynamic)for(const id of all.filter(id=>!missing||id!=='tor'))tickets.push({eventKey:key,id:`acceptance-${key}-${id}`,participantId:id,admissionId:`${key}-${id}`,format:id==='wes'?'qr':id==='skye'?'code128':null});
    return event;
  };
  admissionEvent('family-tickets','Family theatre · three offline admissions',0);
  admissionEvent('missing-ticket','Planetarium · one admission missing',2,true);
  admissionEvent('dynamic-ticket','Evening concert · external app only',4,false,true);
  add('original-ticket','Paper voucher · cached original fallback',5,'11:00','12:00',{booking:{expectedAdmissions:[{id:'original-family'}]},description:'SYNTHETIC — NOT VALID FOR ADMISSION. No derivative code: open the cached original image.'});
  tickets.push({eventKey:'original-ticket',id:'acceptance-original-family',admissionId:'original-family',format:null});
  const note=(key,title,content,eventKeys=[])=>knowledge.push({key,title,content,eventKeys});
  note('guide','Acceptance guide','Disposable acceptance data, not real reservations. All tickets are invalid. Explore every perspective, then cache each before testing it offline.');
  note('meeting','Family meeting point','If separated, meet by the main entrance and send a message. No real emergency or booking information is stored.');
  note('check-in','Apartment access and checkout','Synthetic room 204. Lift beside reception; checkout at 10:00. Ask for the quiet courtyard side.',['current-stay']);
  note('car','Hire collection checklist','Synthetic bay C12. Photograph the car; child seat requested. Return with a full tank.',['london-car']);
  note('rome','Rome arrival plan','Synthetic host meeting in the courtyard at 17:30. Luggage can be left by reception.',['rome-stay','mid-flight']);
  note('theatre','Doors and seating','Doors 17:30; synthetic seats A1–A3. Wes QR, Skye barcode, Tor cached-original fallback. NONE ARE VALID TICKETS.',['family-tickets']);
  return {today,start:shift(today,-10),end:shift(today,10),trip:{title:TITLE,description:`[${SEED}] Disposable synthetic acceptance data. Anchor day: ${today}. Safe to reseed; not real reservations.`,participants:people,lifecycle:'active'},events,knowledge,tickets};
}

const marker=key=>({type:SEED,key});
const tagged=(items,field,key)=>items.filter(x=>x[field]?.some(s=>s.type===SEED&&s.key===key));
const one=items=>{if(items.length>1)throw new Error('Duplicate seed markers found; inspect before proceeding');return items[0];};
const differs=(current,patch)=>Object.entries(patch).some(([k,v])=>JSON.stringify(current[k])!==JSON.stringify(v));
const original=ticket=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="480"><rect width="900" height="480" fill="#fff8df"/><g fill="#522" font-family="sans-serif" text-anchor="middle"><text x="450" y="110" font-size="38">PORTER ACCEPTANCE SAMPLE</text><text x="450" y="220" font-size="40">NOT VALID FOR ADMISSION</text><text x="450" y="300" font-size="24">${ticket.id}</text><text x="450" y="370" font-size="22">Synthetic original · no real booking</text></g></svg>`);

export async function seedAcceptance(service,storage,{today=seedDay()}={}) {
  const data=acceptanceData(today),trips=await service.listTrips();
  let trip=one(trips.filter(t=>t.description?.startsWith(`[${SEED}]`)));
  if(!trip&&trips.some(t=>t.title===TITLE))throw new Error('Acceptance title exists without our marker; refusing to overwrite or duplicate it');
  if(!trip)trip=await service.createTrip(data.trip);
  else if(differs(trip,data.trip))trip=await service.updateTrip(trip.id,data.trip,trip.revision);
  const existing=await service.listEvents(trip.id),ids={};
  for(const {key,parentKey,...fields} of data.events){
    const current=one(tagged(existing,'provenance',key));
    const patch={...fields,parentEventId:parentKey?ids[parentKey]:null,provenance:[marker(key)]};
    const saved=!current?await service.createEvent(trip.id,patch):differs(current,patch)?await service.updateEvent(current.id,patch,current.revision):current;
    ids[key]=saved.id;
  }
  const existingKnowledge=await service.listKnowledge(trip.id);
  for(const {key,eventKeys,...fields} of data.knowledge){
    const current=one(tagged(existingKnowledge,'sources',key));
    const patch={...fields,relatedEventIds:eventKeys.map(key=>ids[key]),sources:[marker(key)]};
    if(!current)await service.createKnowledge(trip.id,patch);
    else if(differs(current,patch))await service.updateKnowledge(current.id,patch,current.revision);
  }
  for(const ticket of data.tickets){
    let event=await service.getEvent(ids[ticket.eventKey]);
    const bytes=original(ticket),checksum=createHash('sha256').update(bytes).digest('hex');
    let artifact=event.artifacts.find(a=>a.id===ticket.id);
    if(!artifact){
      const storageRef={provider:'supabase-storage',bucket:storage.bucket,key:`${trip.id}/${event.id}/${ticket.id}/original`,filename:ticket.id+'.svg'};
      const metadata={id:ticket.id,role:'ticket',mediaType:'image/svg+xml',storageRef,participantIds:ticket.participantId?[ticket.participantId]:[],satisfiesAdmissionIds:[ticket.admissionId],offlineRequired:true,version:'1'};
      // Recover a previous upload whose metadata response was interrupted, without
      // overwriting bytes or bypassing the semantic ownership/path validator.
      if(await storage.exists(storageRef)){
        if(await storage.checksum(storageRef)!==checksum)throw new Error('Existing seed original differs; refusing overwrite');
        event=await service.attachArtifactMetadata(event.id,metadata,event.revision);
      }else event=await service.storeArtifact(event.id,{...metadata,filename:storageRef.filename,data:bytes,contentType:metadata.mediaType},event.revision);
      artifact=event.artifacts.find(a=>a.id===ticket.id);
    }
    if(await storage.checksum(artifact.storageRef)!==checksum)throw new Error('Seed artifact checksum mismatch');
    const patch={...artifact,checksum,...(ticket.format?{code:{format:ticket.format,value:`INVALID-PORTER-${ticket.participantId.toUpperCase()}-${ticket.eventKey.toUpperCase()}`}}:{})};
    if(differs(artifact,patch))await service.updateEvent(event.id,{artifacts:event.artifacts.map(a=>a.id===ticket.id?patch:a)},event.revision);
  }
  const packet=await service.tripContext(trip.id);
  return {tripId:trip.id,title:TITLE,today:data.today,dateRange:[data.start,data.end],events:data.events.length,knowledge:data.knowledge.length,artifacts:data.tickets.length,edgeCases:Object.fromEntries(['current-stay','london-car','mid-flight','family-tickets','missing-ticket','dynamic-ticket','original-ticket','composite','optional','cancelled','return'].map(key=>[key,ids[key]])),packetRevision:packet.revision};
}
