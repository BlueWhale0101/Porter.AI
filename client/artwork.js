// Presentation only. Never writes inferred roles back into Event source truth.
import { EVENT_VISUAL_ROLES,eventVisualRole,eventIconPath } from '../src/event-visual.js';
const families = {
  brand: ['brand', '', []],
  event: ['event-illustrations', 'event', EVENT_VISUAL_ROLES.filter(role=>role!=='none')],
  current: ['current-state', 'state', ['accommodation','hire','parked']],
  system: ['system-states', 'system', ['no-active-trip','offline-ready','missing-artifact','sync-failed']],
  stamp: ['status-stamps', 'stamp', ['added-later','archived','later','next','now','parked-here','past','ready-offline','ticket-ready']],
  texture: ['textures', 'texture', ['archival-paper','paper','postcard-stock','ticket-stock']],
  frame: ['frames', 'frame', ['airmail','photo','postcard','taped-note','ticket','torn-note']],
  marginalia: ['marginalia','marginalia',['aircraft','arrows','compass','ephemera','journey-paths','landscapes','location-pin','map-marks','train']],
  icon: ['operational-icons','icon',['accommodation','add','details','events','hire','knowledge','location','navigate','offline','parking','participants','sync','tickets','trip']],
};
export const artwork = Object.freeze(Object.fromEntries(Object.entries(families).map(([key,[folder,prefix,roles]])=>
  [key,Object.freeze(key==='brand'?{wordmark:'/artwork/brand/porter-wordmark-compass.webp',hero:'/artwork/brand/porter-journey-hero.webp'}:Object.fromEntries(roles.map(role=>[role,`/artwork/${folder}/porter-${prefix}-${role}.webp`])))])));

export function safeAsset(value) {
  const url = typeof value==='string' ? value : value?.url;
  if (typeof url!=='string') return null;
  if (/^\/(?!\/)/.test(url) || /^https:\/\//i.test(url)) return url;
  return null;
}
export function resolveArtwork(object, {kind='event', slot='thumbnail_asset'}={}) {
  const visual=object?.visual??object?.presentation??{};
  const custom=safeAsset(visual[slot])??safeAsset(visual.hero_asset);
  if(custom) return {src:custom,fallback:generic(object,kind),custom:true};
  const src=generic(object,kind);
  return src?{src,custom:false}:null;
}
function generic(object,kind) {
  if(kind==='trip') return null; // A typographic journal cover is the default.
  const visual=object?.visual??object?.presentation??{};
  if(artwork.event[visual.visual_role]) return artwork.event[visual.visual_role];
  if(object?.accommodation) return artwork.event.accommodation;
  if(object?.hire) return artwork.event.hire;
  const text=`${object?.title??''} ${object?.description??''}`.toLowerCase();
  const hints=[[/flight|fly|airline/, 'flight'],[/train|rail/, 'train'],[/airport|terminal|transit/,'airport'],[/opera|theatre|theater|concert|performance/,'theatre'],[/museum|gallery|culture/,'museum'],[/café|cafe|dinner|restaurant|lunch|breakfast|food/,'cafe'],[/park|hike|nature|spa|garden|outdoor/,'outdoors'],[/city|walking tour/,'city']];
  return artwork.event[hints.find(([pattern])=>pattern.test(text))?.[1]]??null;
}
export const systemCopy = Object.freeze({
  'no-active-trip': ['Your next chapter starts here','Choose a Trip or create one online. Previously saved Trips remain available offline.'],
  'offline-ready': ['Packed for offline travel','Your local Trip is available. Ticket readiness is verified separately on this device.'],
  'missing-artifact': ['This pass needs attention','A verified ticket is missing on this device. Connect to sync, or use the ticket source when available.'],
  'sync-failed': ['Your local journey is safe','Sync failed. Keep using your saved Trip and try again when you have a connection.'],
});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function artMarkup(asset, className='illustration') {
  if(!asset)return '';
  const descriptor=typeof asset==='string'?{src:asset}:asset;
  return `<span class="${escape(className)}" aria-hidden="true"><img src="${escape(descriptor.src)}" ${descriptor.fallback?`data-art-fallback="${escape(descriptor.fallback)}"`:''} alt="" width="640" height="640" loading="lazy" decoding="async" fetchpriority="low"></span>`;
}
// Deliberately separate from the larger resolver: no title, structural or URL fallback.
export function eventIconMarkup(event){
  const src=eventIconPath(eventVisualRole(event));
  return src?`<span class="event-icon" aria-hidden="true"><img src="${src}" alt="" width="68" height="68" decoding="async" loading="lazy" fetchpriority="low"></span>`:'';
}
export function systemMarkup(state) {
  const [title,copy]=systemCopy[state]??systemCopy['no-active-trip'];
  return `<aside class="system-state">${artMarkup(artwork.system[state],'system-art')}<div><h2>${title}</h2><p>${copy}</p></div></aside>`;
}
export function installArtFallback(root) {
  root.addEventListener('error',event=>{
    const img=event.target;
    if(img.tagName!=='IMG'||img.alt)return;
    if(img.dataset.artFallback){const src=img.dataset.artFallback;delete img.dataset.artFallback;img.src=src;}
    else img.style.visibility='hidden'; // Preserve reserved layout, never rerender the UI.
  },true);
}
