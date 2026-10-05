// Presentation vocabulary, never Event types or operational projection rules.
export const EVENT_VISUAL_ROLES=Object.freeze(['none','accommodation','airport','cafe','city','destination','flight','hire','museum','outdoors','theatre','train']);
export const eventVisualRole=event=>EVENT_VISUAL_ROLES.includes(event?.visual?.visual_role)?event.visual.visual_role:'none';
export const eventVisualLabel=role=>role==='cafe'?'Café':role==='hire'?'Hire car':role[0].toUpperCase()+role.slice(1);
export const eventIconPath=role=>EVENT_VISUAL_ROLES.includes(role)&&role!=='none'?`/artwork/event-icons/porter-event-${role}.webp`:null;
export function validateEventVisual(visual){
  if(visual==null)return;
  if(typeof visual!=='object'||Array.isArray(visual))throw new TypeError('Event visual must be an object.');
  if(visual.visual_role!=null&&!EVENT_VISUAL_ROLES.includes(visual.visual_role))throw new TypeError(`Event visual.visual_role must be one of: ${EVENT_VISUAL_ROLES.join(', ')}.`);
}
