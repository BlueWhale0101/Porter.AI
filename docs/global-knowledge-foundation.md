# V1 global Knowledge — Phase 1

Baseline: main `4f7036fddad53f070754a0e8c132243a0350b8a9` (PR #20), unchanged
since the architecture investigation. This phase supplies contracts, ownership,
reference integrity and V0 compatibility. It adds no library UI, cache/sync lane,
MCP tools, Knowledge uploads, geocoding or full-library download.

## Source contracts

Knowledge belongs to an authenticated `ownerId`, independent of a Trip. Its
stable ID, creation time and owner are immutable; content mutations retain the
existing expected-revision CAS. `title` is required, `content` is freeform notes
and may be empty. Existing `sources` and `locations` preserve original references;
coordinates and uploaded media are not introduced.

`planning` is an optional bounded aspect:

- `cost: { amount, currency }` or absent/null. Amount is finite and non-negative;
  currency is an uppercase three-letter code. Zero is explicitly free, while
  missing cost is unknown. No automatic currency conversion or inferred price.
- `bookingRequired`, `timedAvailability`: `yes`, `no`, `unknown`, or omitted/null
  (unknown). These are planning answers, not lifecycle states or Event types.
- `primaryUrl`: optional HTTP(S) reference without embedded credentials.

Tags are one mutable, untyped string vocabulary. Matching uses trimmed NFKC
normalization and lowercasing; spelling is retained for display. New semantic
writes deduplicate case-insensitively, but migration does not rewrite old tags.
The SQL matching helper has the same convention. No Trip/topic tag type exists.

Trip adds optional `endDate` and `knowledgePreloadTag`. `endDate` is a real
`YYYY-MM-DD` floating local calendar date, inclusive: a Trip ending December 10
still qualifies throughout local December 10 and has passed on December 11.
It is not a UTC midnight instant and is never inferred from itinerary Events.
A future preload caller compares it with its explicit current local calendar
date (normally the device date); timezone travel must not silently convert the
stored date. `knowledgePreloadTag` is a trimmed plain-text lookup hint, not
ownership, an authorization rule or a special tag type. No preload behavior is
implemented in this phase.

## Event references and non-owning operational context

`Event.knowledgeIds` is the semantic reference authority. Persistence uses
`travel_event_knowledge(event_id, knowledge_id)` with unique pairs, foreign keys,
owner isolation, and reverse indexes. Event create/update and reference replacement
are one transaction using the Event's existing revision CAS. A stale update
cannot overwrite a newer link set. Direct join-table writes are withheld.

`Knowledge.relatedEventIds` remains a derived compatibility mirror for existing
TripPacket consumers and old calls. Link changes do not change Knowledge content
revisions/timestamps. Ordinary Knowledge content updates never send this derived
list back as an editable field; otherwise a stale read could remove a newer link.

The existing legacy `createKnowledge(tripId, input)` and revision-protected
`updateKnowledge(..., { relatedEventIds })` calls remain adapters. Legacy link
writes can alter only the original context Trip's Events; references outside that
context remain intact. They validate ownership and advance affected Event revisions
atomically. New global callers create with `createKnowledge(input)` and edit links
on Events. No new MCP operations/schema expansion is shipped.

`travel_trip_knowledge` explicitly retains non-owning Trip context, including
legacy participant IDs and validity windows. TripPacket fetches the union of this
Trip's contexts and Event-linked Knowledge, not the global library. Contextual
participant/validity data is applied within the Trip; a packet-only
`operationalContext` marker distinguishes explicit contexts from Event-only
references (old packets without the marker retain their V0 interpretation).
Linking a global record alone cannot activate parking or inherit another Trip’s
participant/validity context. Trip copies preserve that distinction; unrelated planning records
never become parking merely because their tags match. Old packet formats remain
readable and the narrow client overlay falls back to old reverse references when
`knowledgeIds` is absent.

Trip copies keep global Knowledge IDs and copy non-owning contexts/reference
links; they do not duplicate Knowledge content. Shared content/tags remain shared
when edited. Artifact originals are still omitted from copies by the existing
rule. Parking capture/replay/clear remain the same semantic operations.

Trip deletion retains all global Knowledge, removes its contexts/Event links,
and nulls the legacy context hint. Individual Event/subtree deletion removes
links without editing Knowledge source content. Existing aggregate revision
checks remain conservative and include the Trip's relevant Knowledge. Knowledge
row deletion removes links and advances affected Event revisions atomically;
no new app/MCP Knowledge deletion surface is added here.

## Database boundary

Knowledge RLS checks `owner_id = auth.uid()` directly, for reads and writes.
Explicit relationship owner guards also apply to the privileged MCP runtime.
The browser still uses its user JWT, with no service credential changes.

The Event transaction is an invoker public RPC backed by a narrowly scoped private
SECURITY DEFINER implementation: direct join DML is revoked, so this helper is
necessary for atomic controlled writes. It has an empty search path, fixed tables,
explicit owner/JWT checks, same-owner Knowledge checks and revision comparison.
Only authenticated/service_role can execute; anon/PUBLIC cannot. The server-only
service role retains its existing trusted provisioned-owner semantic boundary.
Private trigger functions maintain compatibility mirrors/context; their EXECUTE
permissions are revoked from clients. This introduces no public privileged SQL
or dynamic queries.

## Production rollout — operator steps after review/merge

Nothing in development applies these files to production. Do not use the test
SQL scripts against production; they create/delete disposable fixture users.

1. Record the reviewed merged-main SHA. Back up Porter source tables and associated
   relationships; preserve a database restore point. Record current application
   release and migration history. Other applications in the shared project remain
   outside this migration's scope.
2. Preflight legacy Knowledge: nonblank titles, string-array tags and valid
   `related_event_ids` resolving to Events in its original Trip. Verify owner
   existence and no cross-Trip/dangling references. Invalid legacy links abort the
   migration; report/review repair separately, never silently drop them.
3. Apply `20261010113300_porter_global_knowledge_expand.sql` through the existing
   migration procedure. Existing code can still run. This adds optional Trip
   fields, global ownership/planning columns, RLS-protected associations and the
   legacy owner-fill trigger. No source IDs/revisions/timestamps are rewritten.
4. Apply `20261010113306_porter_global_knowledge_backfill.sql`. It takes bounded
   table write locks, fills owners, and creates contexts/references. Compare counts,
   source checksums/revisions/timestamps and relationship owner integrity before
   proceeding. Plan a short write-maintenance window for these locked stages.
5. Apply `20261010113313_porter_global_knowledge_contract.sql`. Under a write lock
   it repeats the backfill for writes between stages, establishes direct owner RLS,
   replaces the Knowledge Trip cascade with SET NULL, installs guarded relationship
   transactions/adapters, and replaces deletion RPCs. The contract changes ownership,
   not the presence of legacy columns. It retains old writers/queues deliberately.
6. Verify database grants, RLS, owner/reference/context counts and invoker/private
   function privileges using the deployment owner and a disposable non-owner.
   Refresh the PostgREST schema cache if required before new RPC/embedded reads.
7. Deploy the exact reviewed merged-main release with the existing release script;
   restart web and private MCP services. New repository code requires all three
   migrations, so never deploy it ahead of the database sequence.
8. On disposable data verify owner-global creation with empty notes, Event links,
   legacy queued parking/location calls, Trip copy references, Event/Trip deletion,
   and unrelated-owner rejection. Then use the existing safe PWA update lifecycle
   and physically verify V0 local startup, current-state perspective and cached
   Door Mode. No physical-iPhone success is claimed by automated tests.
9. Only a later reviewed cleanup may remove legacy `trip_id`, `related_event_ids`
   and context-field adapters after old server versions/PWA workers/queued calls
   are accounted for. This PR does not schedule or execute that cleanup.

Migration filenames were generated with the Supabase CLI. Match existing live
migration history by content/name as documented in deployment.md; do not reapply
old CREATE migrations or assume remote timestamps equal source filenames.

## Rollback limitations

After expand/backfill, the old application can still run. Additive columns and
backfilled associations may remain; do not undo source data or add cascades.

After ownership contract/global creation/shared links, rolling back to an
unmodified V0 application is NOT a complete safe rollback: it cannot find
Trip-independent records or copied contexts and its UI describes obsolete
Knowledge deletion semantics. Use a reviewed compatibility release/forward fix
while retaining the new owner schema. Never restore Trip-owned ON DELETE CASCADE.

The release script's application symlink rollback does not roll back database
migrations. A database restore is a coordinated recovery decision and can discard
post-backup writes; it is not an automatic down migration. Taking irreversible
legacy-column cleanup is explicitly deferred. Shared Knowledge must never be
forced into one Trip or deleted to make an old version work.

## Verification

Tests cover old-schema backfill preservation, owner RLS, privileged same-owner
checks, empty notes/planning/date/tag contracts, normalized link CAS and rollback,
derived reverse references, direct-write denial, global deletion invalidation,
shared Trip copies, deletion retention, legacy queue restart/replay, unchanged MCP
inventory and the existing Trip-only packet/cache boundary. Production Chromium
and WebKit phone tests cover offline packet Details/parking/Door and shared
Knowledge retention through phone Trip deletion.
