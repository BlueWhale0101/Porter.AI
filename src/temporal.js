// Shared UI/domain validation; no coercion or calendar overflow normalization.
export const MIN_EVENT_YEAR=1900,MAX_EVENT_YEAR=2100;
export function calendarParts(value,{instant=false}={}){
  const pattern=instant?/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/:/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
  const match=typeof value==='string'&&pattern.exec(value);
  if(!match)throw new TypeError('Enter a complete date and time.');
  const [,y,m,d,h,min,s='0',fraction='',offset]=match;
  const parts=[+y,+m,+d,+h,+min,+s,+(fraction.padEnd(3,'0'))];
  if(+y<MIN_EVENT_YEAR||+y>MAX_EVENT_YEAR)throw new TypeError(`Event year must be between ${MIN_EVENT_YEAR} and ${MAX_EVENT_YEAR}.`);
  const check=new Date(Date.UTC(...[+y,+m-1,+d,+h,+min,+s,parts[6]]));
  if(check.getUTCFullYear()!==+y||check.getUTCMonth()!==+m-1||check.getUTCDate()!==+d||+h>23||+min>59||+s>59)throw new TypeError('Enter a real calendar date and time.');
  if(offset&&offset!=='Z'&&(+offset.slice(1,3)>23||+offset.slice(4)>59))throw new TypeError('Invalid timestamp offset.');
  return parts;
}
export function validTimezone(zone){try{return typeof zone==='string'&&Boolean(new Intl.DateTimeFormat('en',{timeZone:zone}));}catch{return false;}}
export function validateTemporal(temporal){
  if(!temporal||typeof temporal!=='object'||Array.isArray(temporal))throw new TypeError('Event temporal must be an object.');
  for(const field of ['start','end'])if(temporal[field]!=null){calendarParts(temporal[field],{instant:true});if(!Number.isFinite(Date.parse(temporal[field])))throw new TypeError(`Invalid Event ${field}.`);}
  for(const field of ['startTimezone','endTimezone'])if(temporal[field]!=null&&!validTimezone(temporal[field]))throw new TypeError('Choose a valid timezone.');
  if(temporal.start&&temporal.end&&Date.parse(temporal.end)<Date.parse(temporal.start))throw new TypeError('End must not be before start.');
}
