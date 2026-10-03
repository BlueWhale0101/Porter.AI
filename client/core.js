const clone=value=>structuredClone(value);
const transactionDone=transaction=>new Promise((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});

export class MemoryStore {
  constructor(seed={}){this.packets=new Map(seed.packets);this.artifacts=new Map(seed.artifacts);this.mutations=seed.mutations??[];}
  async getPacket(id){return clone(this.packets.get(id)??null);}
  async putPacket(id,value){this.packets.set(id,clone({id,...value}));}
  async putArtifact(value){this.artifacts.set(value.id,clone(value));}
  async getArtifacts(){return clone([...this.artifacts.values()]);}
  async commitCandidate(tripId,packet,artifacts){const packets=new Map(this.packets);const cache=new Map(this.artifacts);packets.set(tripId,clone({id:tripId,...packet}));artifacts.forEach(x=>cache.set(x.id,clone(x)));this.packets=packets;this.artifacts=cache;}
  async enqueue(value){this.mutations.push(clone({id:value.id??crypto.randomUUID(),...value}));}
  async pending(){return clone(this.mutations);}
  async replaceQueue(values){this.mutations=clone(values);}
}

export class IndexedDbStore {
  constructor(db='porter-v0'){this.db=db;}
  async #db(){return new Promise((resolve,reject)=>{const request=indexedDB.open(this.db,1);request.onupgradeneeded=()=>['packets','artifacts','mutations'].forEach(name=>{if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async #op(name,mode,operation){const db=await this.#db();return new Promise((resolve,reject)=>{const transaction=db.transaction(name,mode);const request=operation(transaction.objectStore(name));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  getPacket(id){return this.#op('packets','readonly',store=>store.get(id));}
  putPacket(id,value){return this.#op('packets','readwrite',store=>store.put({id,...value}));}
  putArtifact(value){return this.#op('artifacts','readwrite',store=>store.put(value));}
  getArtifacts(){return this.#op('artifacts','readonly',store=>store.getAll());}
  async commitCandidate(tripId,packet,artifacts){const db=await this.#db();const transaction=db.transaction(['packets','artifacts'],'readwrite');transaction.objectStore('packets').put({id:tripId,...packet});artifacts.forEach(value=>transaction.objectStore('artifacts').put(value));await transactionDone(transaction);}
  enqueue(value){return this.#op('mutations','readwrite',store=>store.put({id:value.id??crypto.randomUUID(),...value}));}
  pending(){return this.#op('mutations','readonly',store=>store.getAll());}
  async replaceQueue(values){const db=await this.#db();const transaction=db.transaction('mutations','readwrite');const store=transaction.objectStore('mutations');store.clear();values.forEach(value=>store.put(value));await transactionDone(transaction);}
}

export class PerformanceTrace {
  constructor(context={}){this.context={...context};this.marks={};this.measures={};}
  mark(name){const value=performance.now();this.marks[name]=value;performance.mark?.(`porter:${name}`);}
  measure(name,start,end){if(this.marks[start]!==undefined&&this.marks[end]!==undefined)this.measures[name]=this.marks[end]-this.marks[start];}
  finish(){this.measure('time_to_shell','app_start','shell_painted');this.measure('local_packet_read','local_packet_open_start','local_packet_ready');this.measure('time_to_first_useful_render','app_start','first_useful_render');this.measure('time_to_utility_interactive','app_start','critical_actions_interactive');this.measure('synchronization','background_sync_start','background_sync_complete');this.measure('enhancement','enhancement_start','enhancement_complete');}
  json(){this.finish();return {context:this.context,marks:this.marks,measures:this.measures};}
}

export function validatePacket(packet){if(!packet||packet.packetVersion!==1||!packet.trip?.id||!packet.events||!packet.current)throw new TypeError('Malformed TripPacket');return packet;}
export async function checksum(data){const bytes=data instanceof ArrayBuffer?data:data.buffer.slice(data.byteOffset??0,(data.byteOffset??0)+(data.byteLength??data.length));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const matchingArtifact=(manifest,cache)=>cache.find(item=>item.id===manifest.id&&item.state==='verified'&&(!manifest.version||item.version===manifest.version)&&(!manifest.checksum||item.checksum===manifest.checksum));
export function readiness(packet,artifacts){const manifest=new Map((packet.artifactManifest??[]).map(x=>[x.id,x]));let ready=0,external=0;for(const access of packet.access??[]){if(access.status==='external_dynamic'){external++;continue;}if((access.artifactIds??[]).some(id=>matchingArtifact(manifest.get(id)??{id},artifacts)))ready++;}const required=(packet.access??[]).filter(x=>x.status!=='external_dynamic').length;return {required,ready,external,missing:required-ready,state:ready===required?'ready_offline':ready?'partially_ready':'missing'};}

export async function syncPacket({store,api,tripId,fetchArtifact}){
  const previous=await store.getPacket(tripId);
  try {
    const candidate=validatePacket(await api.packet(tripId));
    const staged=[];
    for(const artifact of (candidate.artifactManifest??[]).filter(x=>x.offlineRequired)){
      const bytes=await fetchArtifact(artifact);
      if(!bytes?.data)throw new Error(`Required artifact ${artifact.id} unavailable`);
      if(artifact.version&&bytes.version!==artifact.version)throw new Error('Artifact version mismatch');
      const actualChecksum=await checksum(bytes.data);
      if(artifact.checksum&&actualChecksum!==artifact.checksum)throw new Error('Artifact checksum mismatch');
      staged.push({id:artifact.id,eventId:artifact.eventId,state:'verified',version:bytes.version??artifact.version,checksum:actualChecksum,mediaType:artifact.mediaType,data:bytes.data});
    }
    await store.commitCandidate(tripId,{packet:candidate,meta:{revision:candidate.revision,generatedAt:candidate.generatedAt,lastSync:new Date().toISOString(),usable:true}},staged);
    return candidate;
  } catch(error) {if(previous)return previous.packet;throw error;}
}

export async function replayQueue(store,api){const keep=[];for(const mutation of await store.pending()){try{await api.mutate(mutation);}catch(error){keep.push({...mutation,state:error.code==='revision_conflict'?'conflict':'pending',error:error.message});}}await store.replaceQueue(keep);return keep;}
export async function startLocalFirst({store,tripId,api,render,trace=new PerformanceTrace()}){trace.mark('app_start');trace.mark('shell_painted');trace.mark('local_packet_open_start');const local=await store.getPacket(tripId);trace.mark('local_packet_ready');if(local?.meta?.usable){await render(local.packet,{local:true,trace});trace.mark('first_useful_render');trace.mark('critical_actions_interactive');}trace.mark('enhancement_start');trace.mark('background_sync_start');const sync=syncPacket({store,api,tripId,fetchArtifact:api.artifact}).then(async packet=>{if(!local)await render(packet,{local:false,trace});trace.mark('background_sync_complete');trace.mark('enhancement_complete');return packet;}).catch(()=>null);return {local,sync,trace};}
