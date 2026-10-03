# Local-first phone foundation

The phone renders its last known-good IndexedDB TripPacket before starting authentication or network sync. The server remains the sole projection builder: client API → `PersistentPorterService` → TripPacket; the browser never reads Travel tables or recreates current-state rules.

`syncPacket` validates a candidate, stages only required offline artifacts, verifies their version and SHA-256 checksum, then commits the packet and staged cache entries in one local transaction. Artifact cache identity is `tripId + eventId + artifactId`, preventing a similarly named artifact on another Event or Trip from satisfying readiness. Any failure preserves the previous usable packet and artifact cache. Artifact bytes live separately from packet JSON. Queued semantic mutations persist with their expected revision; replay preserves conflicts rather than overwriting source truth. Device readiness compares the packet manifest to the actual cached version/checksum; dynamic/external access is never presented as locally ready.

The browser sends its Supabase bearer JWT to the semantic client API. Artifact retrieval is authenticated, first verifies Event ownership through `PersistentPorterService`, then reads the opaque storage reference and returns artifact version/checksum headers. Browser mutation input is routed through an explicit small dispatcher, never a caller-selected service method.

The client stores an active Trip ID alongside its packets. A URL hash overrides that selection for development/deep links, but a normal PWA launch reopens the active local packet before network work begins.

Run `npm run dev` for the PWA shell and `node client-api/server.mjs` for the authenticated semantic client API. It accepts a Supabase JWT per request, never a service key. The hidden developer diagnostics panel reports packet/cache/queue state and metadata-only performance marks; it can copy a trace, verify cache state, or clear the selected local packet after confirmation.
