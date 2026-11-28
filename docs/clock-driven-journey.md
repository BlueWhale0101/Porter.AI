# Clock-driven Journey

An installed PWA projects a cached Trip at the device clock before its first useful paint. A failed refresh can leave the source older while Journey continues to advance. The Sydney–Los Angeles regression uses the investigation's synthetic timings. At 22:52 UTC on 14 November 2026 the inbound flight belongs in Past, the stay and wedding are active, and the parking window has opened. The production phone's exact Event endpoints were unavailable.

## Packet and projection contract

The HTTP packet and MCP `get_trip_context` both call the service's `buildTripPacket`. Assembly scopes source data once. `projectJourney({events, knowledge, hiddenChildParents}, perspectiveParticipantId, now)` then evaluates it. The client calls the same pure function. Supply an ISO instant with an offset or Z. All comparisons use epoch milliseconds. Event endpoint zones remain available for display.

| Field | Meaning |
| --- | --- |
| `packetVersion: 1` | Existing envelope, Event descriptors, visible tree, access, artifact manifest and evaluated compatibility view |
| `projectionInput.version: 1` | Additive source contract. The existing Event dictionary contains the visible descriptors. |
| `projectionInput.hiddenChildParents: string[]` | Visible parent IDs with at least one hidden child. The server sends no hidden child descriptor. Known visible edges come from parentEventId. |
| `knowledge` and `projectionInput.otherKnowledge` | Disjoint arrays. The first is valid at the server's evaluation instant. Their union holds all permitted Trip-context records and visible Event references, including expired and future windows. Each row retains its validity windows, participant scope and operational context. |
| `revision` | Existing aggregate source revision. Local edits and clock changes leave this value intact. |
| `generatedAt` | Packet assembly instant. MCP can request an independent evaluation instant. |
| `projectedAt` | Instant used to evaluate the returned view. Diagnostics report the displayed view's evaluation time. |
| `nextBoundary` | Next epoch millisecond at which reevaluation may change a classification or a validity window, or null. The browser computes its own from the effective input. |
| Cached `meta.lastVerifiedSync` | Time of the last verified candidate commit, reported as lastSuccessfulSync. Clock evaluation is in memory. |

The authenticated repository bounds input to the Trip's operational associations and linked Events. The assembler applies participant visibility before including additional Knowledge. An Event-only reference needs a visible Event link and cannot activate parking. Planning-only Ideas, preload tags, global search results and the independent Knowledge cache do not contribute rows. Normal admission and original-artifact lookup still use the verified local cache.

## Time and ordering

| Case | Journey behavior |
| --- | --- |
| Two endpoints | Operational leaves are Now from start through end, inclusive. The first past instant is end + 1 ms. Accommodation and hire follow the same rule and may overlap. |
| Equal endpoints | Now for that single millisecond. An app suspended through it correctly wakes into Past. |
| Start only | Future until start. At start it leaves Next/Later. |
| End only | Past strictly after end. |
| Unscheduled | Remains available in planning. Completed Events still appear in Past. |
| Optional or cancelled | Excluded from Now, Next, Later and resources. An elapsed end still puts the Event in Past. |
| Composite | Only leaves drive operational state. Visible parent markers also cover children outside the participant's packet. |
| Knowledge | Any matching window suffices. Missing bounds are open, both endpoints are inclusive, and an empty list means always valid. |
| Overlaps and ties | Sort leaves by absolute start, then stable ID in code-unit order, with missing starts last. The first future leaf is Next. Past cards keep their newest-end-first display order. Valid Knowledge rows and parking IDs use stable ID order. |

## Device lifecycle and mutations

The PWA prepares one effective input from the selected packet, ordered queue records and deletion receipts. It applies optimistic and conflicted Event data, aliases local create IDs to acknowledged IDs, and covers Undo and dependent edits through the existing queue. Participant-changing edits carry a local base descriptor so a previously hidden Event can enter another cached perspective. Deletion receipts override queued and returned Event IDs. Trip tombstones still guard reads, commits and late responses.

Set and clear parking operations update scoped Knowledge before temporal evaluation. A capture supersedes the previous current parking, even when the replacement is outside today's validity window. Clear matches the capture provenance or Knowledge ID. Acknowledgements survive a failed packet refresh. Receipt retirement checks usable cached perspectives, Event revisions, the Undo window, pending dependencies and ordered parking evidence. An inactive older selection can therefore retain a small receipt until it catches up. Conflict resolution and replay continue using their existing explicit controls.

Source changes rebuild the effective input. Visible Journey schedules one timeout for the next boundary, capped at one minute to detect foreground wall-clock adjustments. The guard checks the clock without repainting when the interval still applies. Visibility, focus and page restoration read the wall clock directly. Hiding or leaving the page cancels the timer. Open dialogs retain interaction ownership. On release the app applies deferred source data and checks the clock. A clock transition replaces only Journey sections, retains Past expansion and restores the scroll offset. The header, tabs, dialogs, artifact bytes and sync status stay in place.

## Compatibility, rollback and product questions

- A legacy or unknown-extension packet uses the v1 envelope immediately. Diagnostics show `legacy-partial`. Known rows still expire, visible children identify parents, and the original classification can prove that an apparently eligible parent was suppressed. Future Knowledge omitted at assembly and ambiguous hidden edges require a compatible sync. A hidden child's deletion or reparenting can leave a conservative parent marker in another cached perspective until that perspective refreshes.
- Switching among previously acquired participant packets works offline. Existing per-perspective cache identities and the online acquisition requirement for a new perspective are preserved.
- Previous clients can read the v1 compatibility view from the new server. A newer client can reopen packets after a server rollback. An application rollback restores the old snapshot-based Journey and its old parking-overlay behavior until refresh. Queue operation names, idempotency keys, artifact identities and IndexedDB schema are compatible. No data migration, cache purge or sign-in is required for upgrade.
- The current product treats validity windows as display relevance. Future and expired permitted operational notes now reside on the owner's device. An embargo or an expiry-time removal requirement would need a separate content-access design. Confirm this interpretation before release.
- Start-only, end-only and point Events retain their existing behavior. Treating a start-only wedding as an all-day activity, giving a point Event a dwell interval, or choosing one preferred overlapping stay or hire would require a product decision. Exact offline instants depend on the device clock.

## Regression and performance evidence

The Node suite includes the incident, unchanged revisions over multiple offline days, both date-line directions, DST gap and fold, four host zones, boundaries, future Knowledge, overlaps, participant and deletion overlays, parking receipts and real MCP transport parity. Mobile WebKit and Chromium exercise the production bundle with IndexedDB and a controlling service worker. The clock scenarios reopen both packet generations, keep an offline ticket open through a multi-day jump, restore the page, move the clock backward and cross a visible timer boundary. They compare stored revision, generation and verified sync time and count Trip API requests. The existing suites also exercise conflicts, Undo, artifact failures, cross-tab deletion and worker updates.

Measured against Increment 1 at `d1dd673` with the same dependency tree. Packet measurements use the 85-Event acceptance descriptors, a fixed clock and synthetic notes. Rendering uses the 85-Event browser rich fixture. Times are development-host measurements, not physical-iPhone budgets.

| Measurement | Increment 1 | Clock-driven Journey |
| --- | ---: | ---: |
| Vite production JavaScript, raw / gzip (decimal kB) | 232.11 / 69.19 | 236.25 / 70.65 |
| Packet JSON, six currently valid notes (bytes) | 42,215 | 42,357 |
| Packet JSON, same six plus one future note (bytes) | 42,216 | 42,704 |
| Median cached first useful render, nine offline loads in mobile Chromium | 68.9 ms | 48.4 ms |
| Pure projection, median of 21 batches of 200 | — | 0.18 ms |
| Boundary refresh including synchronous layout, nine foreground clock jumps | — | 16 ms median, 18 ms maximum |

Startup timings varied with host load. The browser reuses bounded date formatters. Additional persisted packet storage scales with out-of-window scoped rows and visible hidden-child markers per cached perspective. The client keeps one prepared in-memory input for the selected Trip, with one additional base descriptor for a participant-changing queued edit. Clock ticks perform no IndexedDB writes, ticket-byte copies or Trip requests. Artifact storage requirements are unchanged.

## Physical iPhone acceptance

Increment 1 physical-device acceptance remains a release gate. Use a test build and disposable Trip with known endpoints, two cached perspectives, a time-windowed note and a verified ticket. Record the build, perspective, timezone, displayed projection time, source revision and last successful sync.

1. Warm the Trip and ticket, enable airplane mode, then cold-launch the installed PWA on either side of a boundary. Check the first displayed Journey, current stay/hire and ticket readiness before opening diagnostics.
2. Lock the phone across a boundary and resume. Repeat after a multi-day device clock jump and a timezone change across the date line. Verify the stay, hire, parking, note and flight placements against their absolute instants.
3. Keep Journey visible through a start and an inclusive end. Expand Past and scroll down. Verify correct ordering, expansion and scroll after the change. Open an editor with unsaved text and repeat. Close it and check the current Journey.
4. Open Door Mode with a verified ticket. Lock and restore while offline, change the clock, and switch admissions. Verify the original or code remains available and Journey catches up on close.
5. Offline, create and edit an Event, Undo, switch cached participants, capture parking twice and clear the second capture. Restart. Reconnect, force a failed candidate, then retry. Check for a lost or doubled edit and verify that only the successful candidate advances the sync timestamp.
6. Open a legacy cached Trip after updating the shell with Trip connectivity unavailable. Confirm useful first paint, partial coverage and ticket access. Acquire a compatible packet and confirm complete coverage and later-opening Knowledge. Restore automatic date/time after the test.
