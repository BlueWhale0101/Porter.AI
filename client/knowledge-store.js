const copy=x=>structuredClone(x);
export const knowledgeKey=(ownerId,id)=>`${ownerId}:${id}`;
export function validateOwner(ownerId){if(typeof ownerId!=='string'||!ownerId.trim())throw new TypeError('Knowledge owner is required');}
function validateState(ownerId,state){
  for(const name of ['knowledge','queries','mutations'])for(const row of state[name])if(row.ownerId!==ownerId||typeof row.id!=='string'||(name==='mutations'?!row.localKnowledge:!row.id.startsWith(ownerId+':')))throw new TypeError('Invalid owner-scoped Knowledge transaction');
}
export async function memoryKnowledgeTransaction(store,ownerId,change){
  validateOwner(ownerId);
  const state=copy({knowledge:[...store.knowledge.values()].filter(x=>x.ownerId===ownerId),queries:[...store.knowledgeQueries.values()].filter(x=>x.ownerId===ownerId),mutations:store.mutations.filter(x=>x.localKnowledge&&x.ownerId===ownerId)});
  const result=change(state);if(result?.then)throw new TypeError('Knowledge transaction must be synchronous');validateState(ownerId,state);
  for(const [name,rows] of [['knowledge',state.knowledge],['knowledgeQueries',state.queries]]){const map=store[name];for(const [key,row] of map)if(row.ownerId===ownerId)map.delete(key);rows.forEach(row=>map.set(row.id,copy(row)));}
  store.mutations=store.mutations.filter(x=>!x.localKnowledge||x.ownerId!==ownerId).concat(copy(state.mutations));return copy(result);
}
export async function indexedKnowledgeTransaction(db,ownerId,change){
  validateOwner(ownerId);
  const tx=db.transaction(['knowledge','knowledgeQueries','mutations'],'readwrite');
  return new Promise((resolve,reject)=>{
    let result,failure,count=0;const state={},old={};
    tx.oncomplete=()=>{db.close();resolve(copy(result));};tx.onerror=tx.onabort=()=>{db.close();reject(failure??tx.error??new Error('Knowledge transaction aborted'));};
    for(const [tableName,name] of [['knowledge','knowledge'],['knowledgeQueries','queries'],['mutations','mutations']]){
      const table=tx.objectStore(tableName),request=table.index('ownerId').getAll(ownerId);
      request.onsuccess=()=>{
        state[name]=request.result.filter(x=>name!=='mutations'||x.localKnowledge);old[name]=copy(state[name]);
        if(++count!==3)return;
        try{result=change(state);if(result?.then)throw new TypeError('Knowledge transaction must be synchronous');validateState(ownerId,state);
          for(const [storeName,key] of [['knowledge','knowledge'],['knowledgeQueries','queries'],['mutations','mutations']]){const store=tx.objectStore(storeName);old[key].forEach(row=>store.delete(row.id));state[key].forEach(row=>store.put(row));}
        }catch(error){failure=error;tx.abort();}
      };
    }
  });
}
