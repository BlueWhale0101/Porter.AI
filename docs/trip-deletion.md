# V0 Trip deletion (app management only)

Trips → Edit → Delete Trip… opens a named, irreversible confirmation with Event/Knowledge counts. Keep Trip leaves source/cache untouched. Confirm requires an authenticated connection; no offline mutation or Saved · Undo is created. Failures retain the local Trip and explain retry/conflict. A changed cached Trip must be synchronized and reviewed again.

The HTTP boundary has GET `/client/trips/:id/deletion` (owned source revision snapshot) and DELETE `/client/trips/:id` with `{expected:{trip,events,knowledge}}`. These are separate from `/client/mutate`. Neither the semantic service nor the MCP/plugin inventory gains a delete tool. No plugin package change is needed.

## Transaction and concurrency

Apply `supabase/migrations/20261006074753_porter_delete_trip.sql` before deploying this build. It adds a security-invoker RPC restricted to authenticated callers, checks `auth.uid()` ownership, locks the Trip and all child records, and compares their existing integer revisions plus ID membership. New/removed/changed children and stale Trip edits produce a conflict. This uses source revisions, not the packet projection hash as a database concurrency token. TripPacket's existing revision is only an extra stale-UI check before showing confirmation.

Existing Trip foreign keys intentionally cascade Events and Knowledge. Composite children, participants, booking/artifact metadata and relationship IDs are either cascaded rows or embedded JSON. There are no separate participant/relationship tables. The migration replaces the single-column parent FK with a same-Trip composite FK, closing the parent-move loophole that could otherwise make a cascade cross Trip boundaries. Existing cross-Trip corruption causes migration failure rather than silently deleting or repairing records.

## Artifact files

The database aggregate is deleted atomically; Supabase Storage cannot participate in that transaction. The transaction returns artifact references; the authenticated server then removes only `supabase-storage` objects whose bucket equals the configured Porter bucket and whose full key equals `TripID/EventID/ArtifactID/original`. External/local/shared references are untouched. No prefix/bucket-wide removal and no direct deletion from `storage.objects` are used.

If storage cleanup fails, the Trip deletion remains committed and the UI reports that stored files need server cleanup. Structured server logs identify failed Trip/Event/artifact IDs for exact-path administrative cleanup. Unexpected/foreign references are never followed. Private unreferenced files can remain in Storage after a cleanup failure, an interrupted server response, or an earlier unattached upload; this PR adds no general garbage collector or trash system. Operators must verify exact ownership/path before cleanup. Signed URLs already issued may remain valid until their normal expiry. No production deletion or migration is performed by this PR.

## Device lifecycle

After server acceptance, one IndexedDB transaction clears every perspective/legacy packet, artifact, queued mutation/acknowledgement, library row and active selection for this Trip. A small device-only removal marker in existing settings prevents delayed cache/index writes or another tab's stale sync from restoring it; it holds only the UUID and is not a recoverable/soft-deleted domain record. The UI returns to Trips, preserving unrelated cached Trips. Other open tabs receive a removal notification; owned interactions are not interrupted, and normal release leaves a deleted Trip. A confirmed 404 on subsequent synchronization also evicts the unavailable local Trip. Network/auth failures never evict it.

## Verification / deployment

`npm test`, production build/bundle checks and Chromium/WebKit phone regressions cover cancellation, named confirmation, success, failed deletion/retry, stale children, controlled reload, alternate cached perspectives, pending drafts, unchanged unrelated aggregates and MCP inventory. CI runs all checked-in migrations and `test/sql/trip-deletion.sql` against isolated PostgreSQL 17 with Supabase-shaped auth/storage test schemas, exercising RLS, RPC privileges, revision conflicts, parent constraints and real cascades. This is not a claim of production Supabase or physical-iPhone acceptance.

Deploy the migration first, then the reviewed main app using the existing deployment procedure. The old app remains compatible with the stricter parent constraint. Application rollback can retain the additive RPC/constraint; never restore deleted data or undo the migration as part of an application rollback.
