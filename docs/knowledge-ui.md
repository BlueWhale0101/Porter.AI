# Phase 2 increment 4 — Library and Ideas

Baseline: deployed `a8de4d1e4efd5b49fda316d8b5d3af2d4a0f74cb`. Tracks #24.

## Workflow

Trips exposes Knowledge Library independently of an active Trip. Trip navigation
adds Ideas alongside Journey, Itinerary and Calendar. Cached records appear first;
no global collection or identity request is added to ordinary app startup.
Retrieve results/next page are explicit actions using the existing bounded API.
Search/title/notes/tag filters operate locally as typed; Retrieve searches the
same scope online. Trip search expands to All Knowledge while keeping the active
Trip context available through navigation and association choices.

Capture needs title only. Notes, comma-separated mutable tags and URL are primary
fields; cost/currency and tri-states are collapsed planning details. Trip capture
proposes a checked, reviewable planning association; Library capture chooses none.
Save commits locally before closing. Association remains a separate dependent
mutation, never an Event. Edit preserves global identity and the existing allowlist.

List coverage is explicitly partial unless the exact first query completed with
no continuation and the cache has no extra/evicted/pending matching records. Pages
can be empty with a continuation; the UI offers the next page. Cached pagination
is user-driven in 50-record increments. Multiple traversed server pages remain
conservatively labeled partial, rather than inventing a complete global snapshot.

Ideas deduplicates local planning, operational and Event-related sources. TripPacket
notes can be viewed immediately even before the separate Knowledge cache has been
populated. These fallback notes stay read-only until canonical retrieval; no packet
projection is written as a global source. Relationship labels distinguish Planning
idea, Operational note and Linked to an Event. Removal changes planning membership
only, so operational/Event-linked records may remain. Unknown membership must be
read once online before offline editing; cached versions then support offline writes.
Associated Trip names and locally cached linked Event names are visible in Details.
Uncached Event names are shown as linked scheduled Events without hydrating Trips.

## Synchronization and recovery

The existing replayQueue/Web Lock is reused for all mutations. KnowledgeSession
uses a remembered verified-owner hint for offline reopening; explicit Library open,
retrieval or sync validates network identity. Account changes reset the displayed
cache projection and bind the new owner. Disconnect pauses and clears the Knowledge
session while retaining stored data. Existing auth dialogs notify this lifecycle.
UI cannot commit a form captured under an older session epoch into a new account.

Pending/conflicted/blocked states appear on records. Review shows original patches
and their dependent group before discard. A discard refuses potentially committed
ambiguous writes; synchronize those first. Conflicts can fetch current server state,
then explicitly use server or apply the reviewed local version with a new CAS/receipt
identity. Local generation guards reject stale editor/review saves. Source/queue
history stays separate; no silent overwrite, new queue or background library drain.

## Integration limits

The UI preserves Porter typography, paper/palette, dialogs and interaction ownership.
Inputs are at least 16px and buttons at least 44px. Existing Trip, Calendar, Event,
parking, ticket, Door and service-worker routes are retained. Library/Ideas browsing
cancels adoption of unrelated Trip background renders. Returning to Trip views uses
the existing packet; no forced Trip hydration. After a PWA reload the normal Trip/
Trips landing still opens; reentering Library restores saved drafts and cached data.

The main bundle remains one script, avoiding a new blocking chunk request. It grows
about 9.5 KB gzip for these surfaces; request-count/startup regression is tested.
No schema changes, URL enrichment, scrapbook, Event promotion UI or production writes.
Existing server contracts may return identity/association failures; the UI retains
drafts and explains recovery instead of removing them.

## Review and rollout

Node tests cover form validation/escaping, states/relationship semantics and safe
dependent-group discard, in addition to the increment 3 cache/auth/replay tests.
New Chromium/WebKit browser tests cover capture/edit/search/reuse/disassociation,
offline worker-controlled reopen/recovery, nonblocking local save, remote conflict
resolution, navigation/account changes and no startup Knowledge/identity requests.
Browser tests attach Trip Ideas and offline Library screenshots; CI uploads them
as `knowledge-ui-evidence`. Full existing browser/SQL/build suites also run in CI.

Rollout after review: approve merge, then separately approve deployment of the exact
merged release through the existing release procedure. No migration is needed for
this increment. On physical iPhone verify first Library open, London capture with URL,
England association, offline reopen/edit, network recovery/conflict, account disconnect,
safe PWA update and an existing offline ticket/parking/Door path. No deployment or
physical-iPhone acceptance is performed by this PR.
