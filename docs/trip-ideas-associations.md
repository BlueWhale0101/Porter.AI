# Phase 2 increment 2: Trip Ideas and association contracts

Baseline: merged #25 at `ce44a1319fbd8f095d6cdf39173240c2359e9e73`.
Related to #24. No Knowledge UI, enrichment, cache/replay implementation or
production rollout is included.

## Persistence decision

Leave `travel_trip_knowledge` unchanged. It is the legacy **operational context**
relation, carrying participants/validity windows and interpreted by TripPacket,
parking, legacy queues and Trip copies. Do not infer operational meaning from tags.

Add `travel_trip_ideas(trip_id, knowledge_id, active, revision)` for **planning
membership** only. The pair is unique; Knowledge retains its global owner and ID.
No source data is backfilled or rewritten. Existing contexts still appear in Ideas
with `operationalContext:true`, but are not converted into planning flags.
An item can independently have planning membership, operational context and Events.

Inactive rows are tombstones. Never deleting them on disassociation prevents ABA
conflicts: add v1 → remove v2 → re-add v3 cannot accept a stale v0/v1 request.
Content revisions and Event revisions do not change on membership writes.
An absent planning pair is `{active:false, revision:0}`. Even a successful no-op
desired-state write advances its version once. Same-owner checks run in service
and in the guarded database transaction, including service-role calls.

The extra relation avoids changing the established legacy upsert/trigger contract.
This is an additive engineering distinction, not a new user-facing category or
Knowledge subclass. Existing Trip copies continue their Phase 1 operational/context
and Event-reference behavior; copying planning-only membership is not added here.
Global source deletion/Trip deletion cascade the new membership rows. Trip deletion
never deletes owner-global Knowledge. Existing packet/deletion aggregate contracts
are unchanged: planning-only source content is not a TripPacket dependency.

## Retrieval (implemented)

`GET /client/trips/:id/ideas?query=&tag=&cursor=&limit=50`

The existing `/client/knowledge?tripId=...` also delegates to this implementation,
so it no longer scans unrelated global records. Global search without Trip scope
keeps #25's bounded-scan contract. Its association metadata now includes active
planning memberships as well as legacy contexts.

The invoker `porter_trip_ideas` RPC constructs candidate IDs from:

1. Active planning membership for this Trip.
2. Existing operational contexts for this Trip.
3. Normalized Knowledge references from this Trip's Events.

`UNION` deduplicates before joining Knowledge and filtering. Existing Trip/context/
Event indexes plus new planning forward/reverse indexes restrict candidates to the
Trip; no global-library scan or full Event/source hydration in JavaScript. Query
and tag filters run in SQL before pagination. Search is literal NFKC/lowercase
substring across title, content and tags; tag filters use the Phase 1 exact helper.

Returns `{items, nextCursor}`; items are canonical Knowledge plus:

- `ideaAssociation`: `{tripId, knowledgeId, active, revision}` for this Trip.
- `operationalContext`: this Trip has legacy operational context (not a packet
  reprojection instruction).
- `tripEventIds`: derived references in this Trip only, for scheduled indicators.
- `associatedTripIds`: deduplicated active planning/operational Trip associations.

Global `relatedEventIds` remains the compatibility-derived mirror, not editable
reference authority. List records retain canonical source participant/validity
fields; they are not contextual packet projections and must not activate parking.

Limit is 1–100 **matching** items with one lookahead. UUID keyset cursor sorts by
immutable ID. Changing query/scope restarts traversal; pages are not a snapshot or
change feed. Concurrent insertions before a cursor require a fresh traversal.
Payload and returned item count are bounded; SQL filtering may inspect all
candidate IDs in a large Trip, but never unrelated global sources. No total count
or exhaustive automatic pagination. Explicitly requested pages only.

## Association writes and retries (implemented)

Read state, including tombstone versions:
`GET /client/trips/:id/ideas/:knowledgeId/association`.

Use existing `POST /client/mutate` with:

```json
{
  "operation": "setTripIdea",
  "arguments": {
    "tripId": "<UUID>",
    "knowledgeId": "<UUID>",
    "active": true,
    "expectedRevision": 0,
    "mutationId": "<stable UUID>"
  }
}
```

`active:false` disassociates planning membership. It **never** removes operational
context, Event references or global source. Consequently an Event-linked or
operational item remains in Ideas after removal. The later UI should explain the
remaining reasons and disable meaningless planning removal, not silently delete
the Event/parking context. Adding an idea never creates an Event.

The transaction locks Trip first, then takes Knowledge key-share, matching the
existing Event/deletion lock ordering. Trip locking serializes membership writes
and same-Trip receipts; no check-then-write race. It validates owner/JWT, Knowledge
owner, expected association version, then changes membership and stores its receipt
atomically. Same-owner Knowledge cannot disappear between validation and insert.

Receipts in `porter_private.idea_receipts` are keyed by Trip + mutation UUID, with
exact semantic payload and original result. Reusing an ID for a different Knowledge,
desired state or expected version is 400. Exact replay returns the original result
**without applying anything**, even after later membership changes. A retry result
is an acknowledgement, not necessarily current canonical state: retire that write,
then refresh state before issuing a new dependent association edit. Deletion of
Trip/source returns 404 rather than re-creating either. Trip deletion clears its
receipts. Receipt retention is deliberately not time-limited while offline queues
may replay; a future retention scheme needs an explicit replay-expiry contract.

409 requires explicit conflict resolution. 404 means inaccessible/deleted target;
400 means invalid shape/payload reuse; network/auth/503 leave the write pending.
The mutation UUID lives in arguments; it is distinct from the existing generic
queue envelope ID and must never be regenerated on retry. Browser queues are not
wired to this new operation by a UI in this increment.

## Offline follow-on requirements

- Persist owner-scoped source snapshots, planning association states (including
  tombstones), query scope/completeness and pending writes separately from packets.
  Render a cached subset immediately, clearly distinguish it from a complete list.
- Capture globally with durable identity/receipt first, then queue chosen Trip
  membership as a dependency. Source editing uses its own CAS, never membership
  revision. Source creation/edit receipts remain a subsequent increment.
- Persist base state, exact mutation arguments/UUID and overlay atomically before
  reporting saved locally. Fresh pages may not erase pending drafts/associations.
- On acknowledgement retire the exact queued write; do not adopt a historical
  receipt result over a newer snapshot. Read current association state before the
  next dependent write. Conflict resolution rebases only with explicit choice.
- Search page absence is not deletion/disassociation evidence. Use the state read
  to obtain removed-pair versions. Keep pending records from eviction.
- Event promotion is a separate explicit Event creation retaining `knowledgeIds`;
  it depends on source creation, not on planning membership. Event reference
  authority/CAS stays unchanged.
- Planning memberships do not enter every TripPacket refresh in this increment.
  Selective Ideas caching will be its own lane; existing essential Event-linked and
  operational source/ticket/QR/parking packet behavior remains unchanged.

## Security, migration and verification

`20261012050310_porter_trip_ideas.sql` is generated with Supabase CLI and staged
only. It adds two relations and three public RPCs (plus one private implementation).
Planning table RLS is SELECT-only with explicit same-owner predicates; no direct
association DML is granted even to service_role. Receipt table is private with RLS,
no client policies or grants. Read RPCs are invoker. The narrowly scoped write
implementation is private SECURITY DEFINER with empty search path, fixed tables,
JWT/same-owner checks and no dynamic SQL. Public wrapper is invoker; PUBLIC/anon
EXECUTE is revoked. No unrelated application/schema/policy changes.

Before production use: reconcile Phase 1 actual columns, constraints, functions,
triggers/policies/grants and migration-history entries by reviewed content, obtain
separate migration approval, apply only the new migration, verify security advisors
and role tests, then obtain deployment approval. Never blindly replay Phase 1.
These API changes require the new schema/RPCs; do not deploy application first.
Rollback to prior app leaves additive planning state intact; do not drop data.

176 Node tests pass. SQL migration/backfill, global Knowledge, deletion, artifact
and new Ideas tests run against a disposable PGlite PostgreSQL-compatible runtime,
including RLS/role denial, privileged owner checks, tombstone CAS, receipt mismatch,
old retry after later change, filtered pagination, union deduplication and retained
operational/source/Event records. Standard CI PostgreSQL tests include the new
suite through `test/sql/run.sh`. PGlite is not a multi-connection concurrency test
or a production Supabase/PostgREST acceptance test. Production build/check passes.
No live migration/deployment, UI, browser or physical-iPhone success is claimed.
