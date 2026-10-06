# V0 physical-iPhone polish

## Event Save and narrow Undo

Ordinary create/edit now validates, commits a mutation in the existing IndexedDB `mutations` store, projects it locally, closes the editor and shows **Saved · Undo** for ten seconds. Neither the semantic HTTP request nor TripPacket/artifact refresh is awaited by Save. A failed local transaction keeps the editor open and does not claim success. No new database store or server migration is required.

Replay retains a durable acknowledgement until a sufficiently new authoritative packet is available and the Undo window expires. The overlay applies queued edits in order, including while an earlier request is in flight. Dependent edits use the revision returned by their own preceding mutation—not an arbitrary freshly fetched remote revision. External revision conflicts remain visible and queued. Failed writes remain pending; the normal Sync action retries. Web Locks serialize replay between Porter windows while short IndexedDB transactions serialize Save/Undo/acknowledgement. Local pending Journey placement reuses `buildTripPacket` rules rather than inventing new projection rules.

Undo removes an unattempted mutation atomically. Once a request has started its outcome may be uncertain, so Undo records a durable dependent compensation. An edit restores only its changed fields. **Architectural deviation:** Porter has no semantic Event-delete operation; undoing an already sent/committed create uses the existing `cancelled` commitment. It remains identifiable as cancelled in Itinerary, rather than introducing deletion or a new domain primitive. Undo cannot silently replace a newer local edit and a remote conflicting revision is never bypassed.

The HTTP create path uses the durable mutation ID to derive a stable owner/Trip-scoped Event ID. Retrying a create after an interrupted response therefore cannot insert duplicates. Other callers that omit a mutation ID keep the existing create behavior. An ambiguous update acknowledgement can still become an ordinary revision conflict on retry; it is retained for resolution, never force-applied. This is not a general Undo framework.

## Update handshake

Activation re-resolves the live service-worker registration. If the detected worker is still waiting, the existing single-window activation protocol is used. If it has already become the new active/controller worker (including after a lost activation reply), explicit consent reloads into it. Reload is checked again against interaction ownership. A Door/editor/Quick Actions/Details interaction is never interrupted. Reloading into an already-active worker affects only that page and does not require closing other windows; activating a waiting worker still does.

## Hydration and performance

Only a Trip/perspective without a usable local packet shows **Preparing trip…**, with real Loading trip / Preparing offline access phases. Failure shows Retry and Trips controls. Remote preparation has a bounded request timeout and preserves the prior usable cache. Cached startup still renders the local packet immediately. Library refreshes and obsolete launches cannot overwrite the selected preparation view. Successful selection updates the current URL so subsequent Sync targets that Trip.

Diagnostics retain `eventLocalSaveMs`; first hydration has separate `first_remote_hydration_start`, `first_remote_hydration_complete` / `failed` marks and a duration measure. These are not physical-device benchmark claims.

## Phone presentation

- Editable controls use at least 16 CSS px; tap controls use `touch-action: manipulation`. Intentional pinch zoom stays enabled. Existing page overflow containment remains.
- Event rows have a 68 px left-hand illustration (64 px on the narrowest phones), with one CSS paper frame/crop. Next retains its larger art. Shell-cached derivatives are 144 px and total 75,970 bytes for twelve roles; originals are untouched.
- Journey uses compact known-zone, same-day time ranges. Other days keep a date prefix; cross-day and movement/differing-zone rows retain necessary date/zone context. Details are unchanged.
- The canonical **food** source from merged PR #15 is preserved unchanged. Food uses the existing explicit `visual_role`, friendly selector, MCP enum, resolver and shell-cached derivative path. No title/content inference is added.

No export, sharing/collaboration, Diary or planning feature is added. Trips remain private/live; future exports may be static snapshots. Native collaboration is not planned.

Regression coverage includes durable Save failures, delayed requests, newer edits, unsent and in-flight Undo, restart/replay/conflicts, idempotent create retry, uncached/cached hydration and failure, active-worker races with ownership, typography/pinch-zoom policy, narrow framed artwork and timezone-safe ranges. Production browser tests use Chromium and WebKit phone viewports; physical-iPhone acceptance remains a separate user step.
