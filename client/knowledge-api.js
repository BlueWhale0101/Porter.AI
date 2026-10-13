import { knowledgeQuery } from '../src/knowledge.js';

// Inject the existing authenticated request/fail boundary. No startup fetch or cache.
export function knowledgeApi(request,fail,ownerId=null) {
  const send=(path,options={})=>request(path,{...options,signal:options.signal??AbortSignal.timeout(30000),headers:{...options.headers,...(ownerId?{'X-Porter-Owner':ownerId}:{})}});
  return {
    forOwner(id){return knowledgeApi(request,fail,id);},
    async identity(){return (await fail(await send('/client/identity'))).json();},
    async mutate(mutation){return (await fail(await send('/client/mutate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(mutation),signal:AbortSignal.timeout(30000)}))).json();},
    async ideas(tripId,input={}, {signal}={}) {return this.search({...input,tripId},{signal});},
    async association(tripId,knowledgeId,{signal}={}) {return (await fail(await send(`/client/trips/${encodeURIComponent(tripId)}/ideas/${encodeURIComponent(knowledgeId)}/association`,{signal}))).json();},
    async search(input={}, {signal}={}) {
      const query=knowledgeQuery(input),params=new URLSearchParams();
      for(const [key,value] of Object.entries(query))if(value!==null&&value!=='')params.set(key,String(value));
      return (await fail(await send(`/client/knowledge?${params}`,{signal}))).json();
    },
    async get(id,{signal}={}) {
      return (await fail(await send(`/client/knowledge/${encodeURIComponent(id)}`,{signal}))).json();
    }
  };
}
