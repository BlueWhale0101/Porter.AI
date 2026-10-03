const raw = value => JSON.stringify(value, null, 2);
export const exportEvent = (event, format='text') => format === 'json' ? raw(event) : `Event: ${event.title}\n${event.description ?? ''}\nRevision: ${event.revision}`;
export const exportKnowledge = (item, format='text') => format === 'json' ? raw(item) : `Knowledge: ${item.title}\n${item.content}\nRevision: ${item.revision}`;
export const exportTrip = (source, format='text') => format === 'json' ? raw(source) : `Porter.AI Trip source truth\n\n${raw(source)}`;
