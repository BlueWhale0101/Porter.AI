import { knowledgeQuery } from '../src/knowledge.js';

// Inject the existing authenticated request/fail boundary. No startup fetch or cache.
export function knowledgeApi(request,fail) {
  return {
    async ideas(tripId,input={}, {signal}={}) {return this.search({...input,tripId},{signal});},
    async association(tripId,knowledgeId,{signal}={}) {return (await fail(await request(`/client/trips/${encodeURIComponent(tripId)}/ideas/${encodeURIComponent(knowledgeId)}/association`,{signal}))).json();},
    async search(input={}, {signal}={}) {
      const query=knowledgeQuery(input),params=new URLSearchParams();
      for(const [key,value] of Object.entries(query))if(value!==null&&value!=='')params.set(key,String(value));
      return (await fail(await request(`/client/knowledge?${params}`,{signal}))).json();
    },
    async get(id,{signal}={}) {
      return (await fail(await request(`/client/knowledge/${encodeURIComponent(id)}`,{signal}))).json();
    }
  };
}
