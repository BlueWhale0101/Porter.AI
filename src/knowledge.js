// Presentation/planning attributes only: no Knowledge subclasses or lifecycle.
export const KNOWLEDGE_TRI_STATES = new Set(['yes','no','unknown']);
export const tagKey = tag => tag.trim().normalize('NFKC').toLowerCase();
export function normalizeTags(tags=[]) {
  if(!Array.isArray(tags)||tags.some(t=>typeof t!=='string'||!t.trim()||t.length>200))throw new TypeError('Tags must be non-empty strings up to 200 characters');
  const seen=new Set();return tags.map(t=>t.trim()).filter(t=>{const key=tagKey(t);if(seen.has(key))return false;seen.add(key);return true;});
}
export const hasTag=(tags,tag)=>(tags??[]).some(t=>tagKey(t)===tagKey(tag));
export function validatePlanning(p={}) {
  if(!p||typeof p!=='object'||Array.isArray(p))throw new TypeError('Knowledge planning must be an object');
  if(Object.keys(p).some(k=>!['cost','bookingRequired','timedAvailability','primaryUrl'].includes(k)))throw new TypeError('Unknown Knowledge planning field');
  for(const field of ['bookingRequired','timedAvailability'])if(p[field]!=null&&!KNOWLEDGE_TRI_STATES.has(p[field]))throw new TypeError(`${field} must be yes, no or unknown`);
  if(p.cost!=null){const c=p.cost;if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['amount','currency'].includes(k))||!Number.isFinite(c.amount)||c.amount<0||typeof c.currency!=='string'||!/^[A-Z]{3}$/.test(c.currency))throw new TypeError('Cost needs a finite non-negative amount and uppercase three-letter currency');}
  if(p.primaryUrl!=null){let u;try{u=new URL(p.primaryUrl);}catch{}if(typeof p.primaryUrl!=='string'||p.primaryUrl.length>8192||!u||!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new TypeError('Primary URL must be an HTTP(S) URL without credentials');}
}
// Inclusive floating local date. No conversion to a UTC instant or Event-derived date.
export function validateEndDate(value) {
  if(value==null)return;
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||value<'0001-01-01'||value>'9999-12-31')throw new TypeError('Trip endDate must be a YYYY-MM-DD local date');
  const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value)throw new TypeError('Trip endDate must be a real local date');
}
export function knowledgeReferences(ids=[]) {
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!id))throw new TypeError('Knowledge references must be string IDs');
  return [...new Set(ids)];
}
