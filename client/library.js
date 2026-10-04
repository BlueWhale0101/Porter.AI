import { packetCacheId } from './core.js';

export const newParticipantId = () => `participant:${crypto.randomUUID()}`;
export function normalizeParticipants(rows) { return rows.filter(row=>row.name?.trim()).map(row=>({id:row.id||newParticipantId(),name:row.name.trim()})); }
export function participantRemovalAllowed(packet, participantId) { return !Object.values(packet?.events??{}).some(event=>event.participants?.includes(participantId)); }
export function packetIdentity(tripId,perspectiveParticipantId=null) { return packetCacheId(tripId,perspectiveParticipantId); }
export function libraryRows(index, activeTripId) { return [...index].sort((a,b)=>a.title.localeCompare(b.title)).map(item=>({...item,active:item.id===activeTripId})); }
