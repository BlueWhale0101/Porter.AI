const raw = value => JSON.stringify(value, null, 2);
export const exportEvent = (event, format='text') => format === 'json' ? raw(event) : `Event: ${event.title}\n${event.description ?? ''}\nRevision: ${event.revision}`;
export const exportKnowledge = (item, format='text') => format === 'json' ? raw(item) : `Knowledge: ${item.title}\n${item.content}\nRevision: ${item.revision}`;
export const exportTrip = (source, format='text') => format === 'json' ? raw(source) : [`Trip: ${source.trip.title}`, `Events (${source.events.length}):`, ...source.events.map(e=>`- ${e.title}`), `Knowledge (${source.knowledge.length}):`, ...source.knowledge.map(k=>`- ${k.title}: ${k.content}`)].join('\n');
