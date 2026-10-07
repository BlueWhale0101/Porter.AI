# V0 local mutation conflict recovery

No production Trip, database row or existing device queue is changed by development.
This update requires the normal reviewed app/PWA deployment, not a migration or
MCP/plugin change. The existing Los Angeles conflict is reserved for acceptance.

## Why an edit could become stranded

`replayQueue()` persisted a 409 as `state: conflict` with the stale expected
revision. `withPendingEvents()` continued projecting that draft over subsequently
fetched TripPackets. Launch/replay retried the unchanged conflict and stopped at
its failure, so unrelated queued work could remain behind it. Editing that Event
could produce a dependent edit waiting on a result the conflicted parent would
never receive. The app displayed a conflict banner but had no durable resolution
operation. Counts alone could not identify the record or target.

## Lifecycle and deliberate actions

Save remains validate → durable IndexedDB mutation → local projection → background
replay. A revision conflict now pauses for deliberate resolution, survives
restart, stays projected, and displays **Resolve local edit** on the Trip surface.
Door, Details, editors and conflict recovery retain interaction ownership; packet
adoption and service-worker updates cannot replace their UI while owned.

- **Discard local edit** opens confirmation. It removes that conflict and its
  `dependsOn` descendants atomically from the existing queue, not from server data.
  The confirmation identifies dependent edits; cancellation changes nothing.
  A changed queue/confirmation fails safely rather than discarding a newer edit.
  Projection is recomputed without those records. Offline, the latest synchronized
  local packet wins; online, normal background replay/packet synchronization
  obtains current authoritative state. Other edits remain queued/projected.
- **Retry unchanged** retains the mutation ID, arguments and original expected
  revision. It can succeed only if the semantic API accepts that revision. Another
  409 returns it to conflict; no last-write-wins or revision bump is performed.
- **Review current Event and re-edit** (Event updates only) fetches the current
  all-participant TripPacket through the normal authenticated API. It shows the
  current title/revision and requires explicit consent to discard the local edit
  and dependent edits. The existing editor starts from the server Event, not an
  automatic application/merge of the old patch. Only explicit Save records a new
  local-first mutation against that fetched Event revision. If the server changes
  again, normal CAS rejects it. Failed fetch leaves the conflict intact. Closing
  the editor without Save makes no new mutation; the prior discard was deliberate.

Other operations have discard and unchanged retry, not a new merge/editor system.
Conflicts and edits with unresolved `dependsOn` parents are not replayed
automatically. Independent mutations continue; same Event/Knowledge targets,
Trip edits affecting a conflicted Trip, and parking-operation chains are held
conservatively. Transport/auth failures retain the existing stop/retry behavior.

## Safe diagnostics

Enable the existing `?porter-diagnostics=1` mode; Refresh/Copy includes `mutations`
for all unacknowledged queue records (counts remain scoped to the displayed Trip):

- mutation/Trip/Event/Knowledge IDs, operation, state and dependency ID;
- creation/update timestamps when recorded (legacy missing values are null);
- expected revision and last-known packet/server-error revision when numeric;
- allowlisted error code and fixed safe error summary;
- `projected`: whether that record is included in the displayed Event/parking
  optimistic projection (later Event patches may supersede individual fields).
  Other-Trip records and superseded parking captures are false. Some
  operations have no local overlay; false does not mean already synchronized.

No full mutation arguments, patches, inverse drafts, API error text, credentials,
artifact bytes/URLs/codes, ticket content or server-private strings are serialized.
The revision is last-known local information, not a promise of live server state.
New mutations/state transitions record timestamps and safe error codes; old
IndexedDB records remain valid without a schema reset.

## Verification and reserved acceptance

Unit/integration tests exercise genuine semantic revision conflicts, restart,
safe diagnostics, dependency discard, confirmation races/storage failure,
unchanged retry, explicit re-edit racing with another server update, and unrelated
offline Event/Knowledge replay. Production Chromium/WebKit phone tests use a
controlling service worker, actual IndexedDB/API/editor flows and disposable data.
Existing parking, tickets, artifacts, deletion and local-first tests remain intact.

After reviewed deployment, use diagnostics on the existing real phone first,
identify its target/revisions, then choose a deliberate recovery action. Do not
clear IndexedDB or alter Supabase to bypass the conflict. Verify the banner clears
only after all current-Trip conflicts resolve and the server itinerary/tickets
remain unchanged. Physical-iPhone acceptance has not been performed in CI.
