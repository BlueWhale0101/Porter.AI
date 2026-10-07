---
name: porter-ai
description: Use Porter.AI MCP tools to build, inspect and update private Trips, Events and Knowledge; retrieve execution-ready trip context; and create static trip exports.
---

# Porter.AI

Porter is the durable travel source of truth. ChatGPT reasons about the trip; Porter stores and projects it. Specialist apps still handle navigation, airline/hotel operations, venue tickets and other specialized execution.

Use the connected **Porter.AI** MCP tools for Porter state. Do not substitute Assistant.AI tasks/calendar objects for Porter Trips, Events or Knowledge. If Porter tools are unavailable, say the trip database is not connected; never claim a Porter write succeeded.

## Read before write

- Use `list_trips` when the intended Trip is not already unambiguous.
- Use `get_trip_context` for normal trip reasoning and current/next operational context. It returns Porter's deterministic TripPacket projection.
- Use `get_trip` when source Trip fields or the current Trip revision are specifically needed.
- Before updating an existing Event or Knowledge item, resolve its stable ID and current revision from Porter. Do not guess IDs or revisions.
- If several plausible targets remain, ask rather than modifying the wrong trip item.

## Domain model

Porter's core model is **Trip → Event + Knowledge**.

**Event** means something planned or actual that happens during the trip: a flight, meal, museum visit, hotel stay, rental pickup, walk, performance, reservation, or other activity/segment. Events remain the same durable object as details or commitment change.

**Knowledge** means a useful fact that is not itself something happening in time: instructions, a saved fact, booking context, access information, a note, provenance, or other reference information.

Do not invent a generic Event type taxonomy. Event structure is expressed with normal Event fields plus only the established structural characteristics:
- `movement` when the Event genuinely moves from origin to destination.
- `accommodation` when it represents an accommodation interval.
- `hire` when it represents a hired resource interval.

Do not set these flags merely because a title contains related words.

## Creating and updating Events

Create sparse Events when only sparse information is known. Missing details are better than invented details.

Preserve:
- the user's actual title/description intent;
- known start/end instants and their relevant timezones;
- ordinary location, or origin/destination for movement;
- participant IDs when attendance is known;
- commitment when known: `optional`, `planned`, `confirmed`, `completed`, or `cancelled`;
- booking/provenance information when supplied.

A leaf Event has one temporal placement, one spatial expression and one participant set. If a real-world item contains independently meaningful child activities with different times, places or participant composition, represent it as a composite parent with child Events rather than forcing contradictory details onto one leaf.

Participantless Events are trip-global. Do not invent attendance.

Treat `visual.visual_role` as presentation metadata only. It has no Event semantics. Do not infer a visual role from an Event title or content. Set or change it only when the user explicitly chooses presentation artwork; otherwise omit it/preserve the existing value. When updating `visual`, preserve unrelated existing visual fields.

## Time and place

Do not fabricate exact times, dates, locations or timezones. Preserve local travel meaning across timezone changes. Movement Events may have different start and end timezones.

If the user gives a relative travel time such as "tomorrow morning", resolve it from the relevant trip/location context when that context is reliable; otherwise ask for the missing date or place rather than silently choosing one.

Keep Google Maps/navigation as an execution tool. Store useful place identity, location and provenance in Porter when known.

## Knowledge

Use Knowledge for facts and reference material, not as a dumping ground for activities that should be Events. Keep natural-language content useful to a traveler and add structured relationships only when known, such as related Event IDs, participants, validity windows, locations, sources or tags.

Notes may be title-light in conversation, but honor the backend's accepted Knowledge shape. Do not turn an ordinary note into an Event just to place it on the operational timeline.

## Context, tickets and artifacts

`get_trip_context` is the preferred read for questions such as "what's next?", "where are we staying?", "what do I need now?", or participant-perspective questions.

Artifact metadata belongs to its Event. `attach_artifact_metadata` records metadata; it does not by itself prove that the artifact bytes are cached on the user's current device. Never claim device-local ticket/offline readiness from MCP metadata alone. Porter's phone UI is authoritative for device-local readiness.

For an authoritative static ticket image or PDF, use `store_artifact` to ingest
the actual original bytes into Porter. Metadata-only external URLs are not
offline-capable tickets. Supply one public HTTPS source URL, or the exact
original base64 bytes with mediaType when the URL requires authenticated access.
Maximum decoded size is 5 MiB; accepted formats are PNG, JPEG and PDF. Confirm
`staticArtifact: true` only when the credential is genuinely static. Preserve
participant/seat/admission mappings and use the existing artifact ID to
materialize previously attached external metadata; do not create duplicate tickets.
Read the current Event revision first. Owned originals cannot be overwritten.
Never reconstruct, redraw, screenshot or regenerate a QR code when authoritative
original bytes are available. If you cannot obtain those bytes, say so and ask
for the original; never fabricate base64 or claim success from a source URL alone.
Only report ingestion after the tool succeeds. Server storage is not device
readiness: the phone must download, verify and commit it locally during sync.
Rotating/dynamic credentials remain `external_dynamic` and use the specialist
app/Wallet instructions; do not freeze a live credential into an offline ticket.

Do not fabricate booking references, ticket codes, storage references, source URLs or participant mappings.

## Mutations and conflicts

Use optimistic revisions exactly as returned by Porter. Confirm a write only after the tool reports success.

On `revision_conflict`, re-read the current Porter object/context, preserve the user's intended change, and reconcile against the newer source before retrying. Do not overwrite newer trip state blindly.

If a write has an uncertain transport outcome, read Porter before retrying so a successful first write is not duplicated.

## Exports and sharing

Trips are private and live. Exports are static and shareable.

Use Porter's export tools when the user wants a textual or JSON snapshot. Do not imply that an export grants live Porter access or creates collaboration. Native collaborative trip editing is not part of the model.

## Conversational behavior

The user should not need to think about schemas or tool names. Translate normal travel conversation into the smallest faithful Porter operations.

For a batch such as "Here are our flight and hotel confirmations; build the trip":
1. identify or create the Trip;
2. extract only supported facts;
3. create the necessary Events/Knowledge with correct relationships and participants;
4. retrieve trip context afterward when useful to verify the resulting itinerary;
5. summarize what was created and call out genuinely missing information.

For a simple change such as "We decided to go to the British Museum tomorrow morning", update Porter directly once Trip, date/location context and participants are sufficiently clear. Ask only for information that materially affects the stored trip.

Do not add recommendations merely because Porter contains an open period. Porter is intentionally passive during unstructured time; provide recommendations only when the user asks ChatGPT for them.
