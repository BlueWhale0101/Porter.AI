# Phase 2 increment 3: durable Knowledge and selective offline sync

Baseline: merged #26 `99d110b8688e3f41f28d43e2fc767b5e74f98b09`; tracks #24.
Builds on foundation/library/Trip Ideas contracts. No new UI, Event promotion,
enrichment, automatic collection download or production rollout.

## Server contracts

New semantic operations on the existing authenticated `/client/mutate` boundary:

| Operation | Arguments | Result |
|---|---|---|
| `captureGlobalKnowledge` | `knowledgeId`, `mutationId`, `knowledge` | `{id, ownerId, revision}` receipt |
| `editGlobalKnowledge` | `knowledgeId`, `mutationId`, `expectedRevision`, `patch` | `{id, ownerId, revision}` receipt |
| `setTripIdea` | Increment 2 arguments, including stable `mutationId` | Original association receipt |

Capture uses client-generated UUIDs for source identity and mutation identity,
persisted locally before network. The server assigns authenticated ownership;
existing IDs cannot be claimed/replaced, including IDs owned by another user.
An exact successful retry returns its original receipt without another insert or
revision increment. It does not resurrect a source deleted since the receipt.
Mutations never implicitly create Events. Trip association is a separate write.

The explicit fields are `title`, `content`, `tags`, `planning`. Title is required
for capture; content defaults empty. Primary URL lives in `planning.primaryUrl`.
Existing normalization, cost/currency, URL and tri-state validation is reused.
Planning is replaced as a bounded object when supplied, not recursively merged.
Edit cannot accept identity, owner, source provenance, locations, participant/
validity contexts, timestamps/revisions or reverse Event references. SQL updates
only these four fields plus revision/time. Legacy context/reference triggers remain
unchanged, and existing Trip-scoped create/update/parking operations keep working.

The staged `porter_mutate_knowledge` invoker RPC delegates to a private guarded
implementation. Private receipts are keyed by owner + mutation UUID and include
exact JSON semantic request and result. Receipt insertion/source mutation are one
transaction. A transaction advisory lock serializes retries of the same identity;
row lock and expected revision protect competing edits. Edits of legacy-context
records lock their original Trip before Knowledge to match existing transaction/
trigger lock ordering. Receipt replay never modifies the source. Payload reuse is
400, stale revision/identity collision is 409, inaccessible/deleted source is 404.
Rejected transactions create no receipt. GET current source is the conflict read
contract; 409 includes known revision details when available, otherwise `actual:null`.

`GET /client/identity` returns only verified authenticated owner identity.
`X-Porter-Owner` pins Knowledge reads to the intended owner; a mismatch is 401.
Queued mutations include outer `ownerId`, checked against the authenticated runtime
before dispatch. This prevents a refreshed/switched cookie session from replaying
an old account's capture into a new account. No secret credentials enter clients.

## Local persistence and save contracts

IndexedDB version 4 adds owner-indexed `knowledge` and `knowledgeQueries`, and an
owner index on the existing `mutations` store. Existing packets, artifacts,
settings and Trip index survive additive upgrade. Database connections close on
version change; blocked upgrades report a close-other-windows error. Both memory
and IndexedDB implementations expose `knowledgeTransaction(owner, synchronousChange)`.
Knowledge/query/queue writes commit atomically, and Save resolves only after
IndexedDB transaction completion. Failure leaves both source draft and queue intact.

`client/knowledge-sync.js` provides the data foundation:

| Function | Behavior |
|---|---|
| `captureKnowledge` | Validate, persist seed and create mutation; return stable source/mutation IDs |
| `editKnowledge` | Allowlisted patch, expected local generation, durable dependent write |
| `associateKnowledge` | Versioned desired membership; depends on source creation/prior membership |
| `localKnowledge` | Immediate owner-scoped source plus pending/conflicted overlays |
| `openKnowledge` | Return local record and a separate explicit refresh promise |
| `cacheKnowledge` / `cacheAssociation` | Accept canonical same-owner source/current association state |
| `beginKnowledgeQuery` / `cacheKnowledgePage` | Persist explicit page scope, request identity, IDs and completeness |
| `localKnowledgeQuery` | Bounded search of cached subset, including offline captures/edits |
| `evictKnowledge` | Evict clean unpinned sources only; preserve pending/conflicted records |
| `resolveKnowledgeConflict` / `resolveAssociationConflict` | Explicit server choice or reviewed rebase with a new mutation identity |

Canonical server source is separate from local seed and mutation overlays.
Local generation guards stale editors; remote refresh cannot overwrite drafts.
Newer canonical content revisions win; older responses cannot regress the source.
Ideas annotations are separated from the canonical fields and cached membership
version. TripPacket projections are never used to replace canonical source records.
Explicit cache entry points do not run from app initialization.

Query keys include owner, Trip/global scope, text, tag, cursor and limit. Late
responses from superseded identical-scope requests are ignored. A complete marker
requires a first page with no continuation, no pending local writes or evicted/
extra matching sources. Writes invalidate completeness. Continuation pages and
unqueried subsets are partial. Absence from any page/packet never deletes a source
or infers membership removal. Offline search is bounded to cached records; it
cannot promise unseen global results. Query metadata persists independently.

Captured/opened sources are pinned. Explicit page results are eligible for bounded
clean-record eviction. Failed reconciliation and conflicts remain protected. The
current owner cache transaction reads that owner's local records/history, not all
accounts or any server collection. Long-term receipt/query-history compaction is
follow-up work; nothing silently expires unresolved writes.

## Replay, authentication and conflicts

Reuse `replayQueue(store, api, knowledgeSession)` and its existing browser Web Lock
and per-store serialization. Without a KnowledgeSession the new lane is paused;
legacy Event/parking replay still runs. With one, local Knowledge rows delegate to
the new replayer inside the same loop, not a parallel network queue/worker.

`KnowledgeSession` tracks intended owner and auth epoch. The subsequent UI must
bind it to verified identity and call `setOwner(null)` on disconnect, or set the
new owner on sign-in/account change. Known cached owner selection can support
offline access; it is not network authorization. `knowledgeApi(...).forOwner(owner)`
uses the existing injected `sessionFetch`/error boundary, adds owner pinning, and
supports request cancellation/timeouts. Constructing it performs no I/O.

Each replay validates identity before sending and before reconciliation. Session
changes stop replay/adoption. An in-flight success is durably acknowledged only in
its original partition. It is never adopted into another account's cache.

Queued payload/UUID freezes on first attempt. Dependent edits use the preceding
write's acknowledged revision, never silently adopt an unrelated server revision.
Source creation must acknowledge and reconcile before dependent membership/edits.
Association changes chain against prior association receipts. Different content
and membership versions remain independent.

Receipt result is historical acknowledgement, not current canonical state. Persist
acknowledgement, then fetch current source/association. On refresh failure retain
an unreconciled acknowledgement and draft overlay; next replay retries only the
read. Dependent writes wait for reconciliation. Newer local writes remain overlaid
through delayed acknowledgements. Trip/Event cache purges preserve this global
lane; deleted association targets become blocked with their draft retained.

401/network/503 pause with durable pending state. 404/400 block the affected write;
409 preserves a conflict plus original patch/base revision. Independent writes can
continue after conflicts. No automatic merge, revision replacement or discard.
Resolution requires the current cached source/membership and local generation.
Choosing server or rebase explicitly resolves the affected dependent draft group,
retaining original arguments as history. Rebase creates a fresh ID against the
reviewed canonical revision. Callers must present the group/patch before invoking
resolution. Identity-collision capture and blocked/deleted-target recovery remain
explicit follow-up UX, with drafts retained; they are not silently retried as edits.

## Migration and rollout gate

`20261013100243_porter_knowledge_mutations.sql` is staged only. It adds one private
RLS-enabled receipt table and private implementation/public invoker RPC, with empty
search path, fixed relations, explicit owner validation and PUBLIC/anon execution
denied. There are no grants or client policies on receipt data. It uses Phase 1
validation triggers and needs the complete verified Phase 1 schema. Increment 2's
planning migration must be applied before association replay can work.

Production history remains unreconciled. Reconcile actual Phase 1 schema/functions/
grants/triggers/history by reviewed content first, then independently approve and
apply the staged increments in order, verify security advisors/roles/PostgREST, and
separately approve deployment. No live data, migration/history or app changes here.
Assistant/Coach resources are untouched. Server receipts have no TTL; retention or
purge requires an explicit replay-expiry contract. Prior app rollback leaves new
source/receipt/planning state intact; no legacy column removal/down migration.

## Verification and limits

192 Node tests pass: existing 176 regressions and 16 new owner/auth, offline save,
IndexedDB restart/upgrade/atomic failure, dependency ordering, ambiguous retries,
failed refresh, revision conflicts/resolution, late response, eviction and safe
deletion tests. SQL migrations plus global Knowledge/Trip deletion/artifact/Ideas
and new receipt tests pass in disposable PGlite (PostgreSQL-compatible), including
roles, exact replay, CAS, payload reuse, validation rollback and preserved V0 fields.
The new SQL suite is wired into standard CI PostgreSQL execution.

Production build/check-build and whitespace checks pass. Main JS gzip grows from
55.76 to 57.07 KB; no new startup request, full collection hydration or timers.
Browser regression execution is blocked locally: binaries absent, Playwright CDN
downloads yielded corrupt archives. Native multi-connection PostgreSQL concurrency,
live Supabase/PostgREST and physical-iPhone acceptance remain rollout checks.
The local foundation is callable/tested but intentionally not connected to Library/
Ideas UI or auth dialogs yet. Subsequent UI must handle refresh errors, bind session
lifecycle, request explicit pages and present conflict/dependency decisions.
