# Production interaction regression

## Cause and correction

`render()` sets `data-surface` on the persistent `#app` element for layout.
`bind()` previously selected every `[data-surface]` in the document, including
that container, and assigned each one a navigation `onclick` handler.
Clicks on a tab or any descendant therefore bubbled into a second navigation
render. A tab's selected surface was overwritten with the container's old
surface; opening a dialog was followed by replacement of that dialog's DOM.
Removing an open dialog this way also bypassed its normal interaction-release
path. Diagnostics outside the app container were unaffected.

Navigation binding now selects only `.tabs > button[data-surface]` within the
app. The root retains its layout metadata without owning clicks. Dialog
ownership, local-first startup, packet adoption, and rendering are unchanged.

## Repeatable regression checks

Run `npm ci`, `npx playwright install --with-deps chromium webkit`, then
`npm test` and `npm run test:browser`. CI builds and checks the production
bundle before running the same browser suite. Failed browser runs retain traces.

The browser server serves the actual Vite production output through
`createProductionApp`, with the actual semantic service and TripPacket
projection. Only authentication, repository persistence, and artifact storage
use isolated test seams. Browser IndexedDB, service worker, HTTP responses,
and application event handlers are real; the development fixture entry is not
used. Test-control routes exist only in this test server.

Both touch-enabled Chromium and WebKit phone configurations cover navigation,
Quick Actions across a pending sync, controls after packet adoption, a reload
with a controlling worker and usable IndexedDB packet/artifact, and
Details-to-Door ownership during deferred synchronization. Network gates, not
timing delays, coordinate the packet-adoption assertions.

These are browser-engine regressions, not proof of acceptance on an actual
iPhone or a new smoke test against production Supabase. After review and
deployment, repeat the reported navigation, Quick Actions, and reload sequence
on the real iPhone. No production deployment is part of this fix PR.
