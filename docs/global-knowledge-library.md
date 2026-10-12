# Global Knowledge Library — Phase 2 foundation

Baseline: `976fced6a6863e57dc5a2b54f6afe599bc12ce2b`. Tracks #24;
URL enrichment remains deferred to #23.

## Existing implementation and gaps

Phase 1 has owner-global creation, get/update with revision CAS, planning/tag
validation, normalized Event references and derived reverse IDs. Legacy creation
with a Trip retains operational contexts. Copy/deletion preserve global identity.
TripPacket includes only explicit contexts and Event references, with contextual
participant/validity projection. The existing `client/library.js` is a **Trips**
library helper, not a Knowledge library. Browser mutations still adapt legacy
Trip capture; no global list/search or independent Knowledge cache existed.

This first increment adds read contracts only: repository bounded scanning,
service search, authenticated HTTP routes, an injectable client API adapter and
tests. It does not install the adapter in startup, change navigation, alter writes,
modify MCP inventory, or deploy anything. Association mutation, idempotent capture,
selective persistence, replay/conflict UI and Event promotion follow separately.

## Read API (implemented)

Increment 2 supersedes Trip-scoped scan and association proposals below;
see `trip-ideas-associations.md`. Global unscoped scan behavior is unchanged.

`GET /client/knowledge?query=&tag=&tripId=&cursor=&limit=50`

- Uses the existing authenticated runtime and user JWT. Repository also applies
  `owner_id`, protecting the provisioned service-role path. Trip scope is checked
  for ownership before scanning. No browser table access or service credential.
- `limit` is an integer 1–100. Cursor is the last scanned UUID; records sort by
  immutable UUID ascending. Queries accept only the documented keys. Search text
  is capped at 500 characters, tag at 200. IDs are validated UUIDs.
- Returns `{items, nextCursor, scanned}`. **Limit bounds scanned records**, not
  matching records. One request fetches at most limit+1 source records. Empty
  matching pages can have a continuation. A consumer must not treat them as
  exhaustive or automatically drain every page on launch/keystroke. Show explicit
  continuation and cancel superseded queries. Restart pagination when scope/query
  changes. Concurrent insertions before the cursor appear on the next fresh search;
  this is traversal, not snapshot isolation or a synchronization watermark.
- Matching is literal substring across title, notes (`content`) and individual
  tags, using trimmed NFKC/lowercase normalization. Tag filtering is exact under
  the Phase 1 case-insensitive contract. Inputs are never PostgREST filter syntax.
- Items retain canonical global shape, plus `associatedTripIds` from the explicit
  association relation. `relatedEventIds` remains the derived global mirror.
  Event-only references do not imply explicit Ideas association. Such records are
  still available in TripPacket Details; the eventual Trip Ideas UI must merge
  Event-linked records or request a separately bounded Trip-reference read.
- This intentionally modest scan avoids schema changes. Sparse searches may need
  multiple explicit pages. If measured library size makes that poor UX, replace
  with a reviewed owner-scoped SQL search RPC preserving normalized matching and
  bounded pagination; do not hide an unbounded server/client loop.

`GET /client/knowledge/:id` returns canonical Knowledge through the existing owner
guard (404 for inaccessible records). Both routes use no-store and existing
401/400/404/503 error handling. `client/knowledge-api.js` injects the application's
authenticated request/error functions and accepts AbortSignal; it makes no calls
until explicitly invoked. It is a data adapter, not a cache implementation.

## Proposed mutation and selective offline contracts (not implemented)

Keep existing legacy calls unchanged. Add distinct global create/edit and
association operations rather than reinterpret legacy parking arguments.

- Global capture: required title, optional content/tags/planning. Create globally
  first; an explicit chosen Trip association is a second durable dependent write.
  Neither operation creates an Event. Use a stable mutation ID, deterministic
  Knowledge identity and a durable receipt/payload check for retries, including
  ambiguous network failure. Returning an unrelated existing row on retry is not
  adequate. Never trust caller-supplied owner/identity/revision fields.
- Content edit: allow only editable Knowledge fields, expected content revision,
  stable mutation ID/receipt. Never replay `relatedEventIds`, operational context,
  owner or legacy Trip hint from a cached editor. Conflict returns/loads latest
  owner-scoped source while retaining draft/base. No automatic overwrite or
  rebasing a revision just because a refresh succeeded.
- Association/disassociation: explicit Trip and Knowledge IDs, same-owner guards,
  expected association version and retry receipt. Adding to England keeps the
  same Knowledge ID. Removing Ideas association leaves Event references and the
  global source intact. Do not upsert empty participants/windows over an existing
  operational context. Content revision is not an association revision.
- Current association schema is operational: all existing rows are projected as
  `operationalContext:true`. A later additive schema contract must distinguish
  planning association from operational context, preserve legacy rows/copy behavior,
  and support versioned association changes (including removal/re-add conflicts).
  An explicit discriminator plus association version/tombstone or separate planning
  relation are implementation options; decide in the next reviewed increment.
- Event promotion: prefill a new Event draft from Knowledge; explicit scheduling
  creates an Event with `knowledgeIds` retaining the source. Reuse the existing
  guarded Event transaction/revision path; association never invokes it. Offline
  promotion depends on acknowledgement of any pending source creation.

Cache records by authenticated owner + Knowledge ID in a separate IndexedDB
store, with query-page metadata and completeness limited to the traversed scope.
Only cache selected/opened/captured records and explicitly requested pages; no
global refresh on app launch or TripPacket refresh. Cached subsets must be labeled
as such offline. Trip-associated/Event-required essentials continue through the
existing packet lane. Never replace a full record from a perspective-projected
packet or infer global deletion from absence in a page/TripPacket.

Persist draft/base/revision and mutation atomically before showing capture saved.
Overlay pending edits on canonical snapshots; fresh pages cannot erase drafts.
Serialize dependent source/association/promotion writes; replay only within their
owner scope and pause on auth changes. Pending/conflicted records are not evictable.
An explicit conflict resolution chooses server state or a reviewed patch against
the latest version. Deletes/disassociations need tombstone handling. Trip deletion
must not discard global content edits merely because capture began in that Trip.
Bound eviction of unpinned clean records; preserve selected offline records and
existing Door Mode artifacts. Upgrade IndexedDB additively and test reopen/replay.

## Migration and rollout requirements

No schema or production writes in this increment. Live read-only inspection found
the direct owner Knowledge policy and corrected same-owner Trip-association policy.
Remote migration history lists `porter_global_knowledge_expand` but not backfill,
contract or the policy fix. Earlier V0 migration timestamps also differ from source.
This is confirmed drift, not evidence those scripts need applying again.

Before any future migration tooling: compare actual columns, constraints, triggers,
function definitions/grants and policies with all Phase 1 scripts; record checksums
and reconcile history in a separately approved operator step. This inspection is
not a complete schema reconciliation. Do not use db push/branch replay against
the shared production project until that is complete. Any additive association,
receipt or search schema work needs separate review and production approval.

Rollout stays the existing reviewed release procedure. This PR requires no
migration and no PWA/physical-iPhone acceptance claim. Existing legacy columns,
packet/cache/parking behavior, tickets and Door Mode remain supported.
