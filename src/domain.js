import { randomUUID } from 'node:crypto';

export const TRIP_LIFECYCLES = new Set(['draft', 'upcoming', 'active', 'archived']);
export const EVENT_COMMITMENTS = new Set(['optional', 'planned', 'confirmed', 'completed', 'cancelled']);
const IMMUTABLE_FIELDS = new Set(['id', 'ownerId', 'tripId', 'createdAt', 'updatedAt', 'revision']);

const now = () => new Date().toISOString();
const copy = (value) => structuredClone(value);
const array = (value) => value == null ? [] : [...value];

export function newTrip(input, ownerId) {
  validateTrip(input);
  const lifecycle = input.lifecycle ?? 'draft';
  const timestamp = now();
  return { id: randomUUID(), ownerId, title: input.title.trim(), description: input.description ?? null,
    lifecycle, participants: array(input.participants), presentation: input.presentation ?? {},
    createdAt: timestamp, updatedAt: timestamp, revision: 1 };
}

export function newEvent(input, tripId) {
  validateEvent(input);
  const timestamp = now();
  return { id: randomUUID(), tripId, parentEventId: input.parentEventId ?? null, title: input.title.trim(),
    description: input.description ?? null, participants: array(input.participants), temporal: input.temporal ?? {},
    spatial: input.spatial ?? {}, booking: input.booking ?? {}, artifacts: array(input.artifacts),
    provenance: array(input.provenance), commitment: input.commitment ?? 'planned', visual: input.visual ?? {},
    movement: Boolean(input.movement), accommodation: Boolean(input.accommodation), hire: Boolean(input.hire),
    createdAt: timestamp, updatedAt: timestamp, revision: 1 };
}

export function newKnowledge(input, tripId) {
  validateKnowledge(input);
  const timestamp = now();
  return { id: randomUUID(), tripId, title: input.title.trim(), content: input.content,
    relatedEventIds: array(input.relatedEventIds), participantIds: array(input.participantIds),
    validityWindows: array(input.validityWindows), locations: array(input.locations), sources: array(input.sources),
    tags: array(input.tags), createdAt: timestamp, updatedAt: timestamp, revision: 1 };
}

export function revise(object, patch, expectedRevision) {
  if (expectedRevision !== object.revision) throw new ConflictError(object.id, expectedRevision, object.revision);
  for (const field of Object.keys(patch)) if (IMMUTABLE_FIELDS.has(field)) throw new TypeError(`${field} is immutable`);
  const result = { ...copy(object), ...copy(patch), revision: object.revision + 1, updatedAt: now() };
  validateObject(result);
  return result;
}

export class ConflictError extends Error {
  constructor(id, expected, actual) { super(`Revision conflict for ${id}: expected ${expected}, found ${actual}`); this.name = 'ConflictError'; this.expected = expected; this.actual = actual; }
}

function validateTrip(trip) {
  if (!trip.title?.trim()) throw new TypeError('Trip title is required');
  if (!TRIP_LIFECYCLES.has(trip.lifecycle ?? 'draft')) throw new TypeError('Invalid trip lifecycle');
}
function validateEvent(event) {
  if (!event.title?.trim()) throw new TypeError('Event title is required');
  if (!EVENT_COMMITMENTS.has(event.commitment ?? 'planned')) throw new TypeError('Invalid event commitment');
  const spatial = event.spatial ?? {};
  if (event.movement) {
    if (spatial.location) throw new TypeError('Movement Event cannot have ordinary location');
  } else if (spatial.origin || spatial.destination) throw new TypeError('Non-movement Event cannot have origin/destination');
  validateTemporal(event.temporal ?? {});
}
function validateTemporal(temporal) {
  for (const field of ['start','end']) if (temporal[field] != null && (typeof temporal[field] !== 'string' || Number.isNaN(Date.parse(temporal[field])))) throw new TypeError(`Invalid Event temporal ${field}`);
}
function validateKnowledge(knowledge) {
  if (!knowledge.title?.trim() || knowledge.content == null || String(knowledge.content).trim() === '') throw new TypeError('Knowledge title and content are required');
  validateWindows(knowledge.validityWindows ?? []);
}
function validateObject(object) {
  if ('ownerId' in object) validateTrip(object);
  else if ('commitment' in object) validateEvent(object);
  else validateKnowledge(object);
}
function validateWindows(windows) {
  for (const window of windows) {
    if (!window || (!window.start && !window.end)) throw new TypeError('Validity window needs a start or end');
    if (window.start && window.end && Date.parse(window.start) > Date.parse(window.end)) throw new TypeError('Validity window end precedes start');
  }
}
