# V0 real-device follow-up

## Parking

Clear parking lives on the current Parking card. It removes only `current` from
the targeted parking Knowledge; history remains ordinary Knowledge. New captures
carry a stable capture ID in `sources` so a pending capture can be cleared before
its server Knowledge ID exists. Replaying the same capture does not resurrect a
cleared/superseded state. Clearing an old state cannot clear a newer one.

Both actions first commit to the existing local mutation store. The display-only
parking overlay applies them in capture order, including after cold startup.
IndexedDB queue entries now have a transactional sequence (random primary IDs
were not chronological). Replay is serialized, stops on failure to preserve
dependencies, and acknowledges individual entries without dropping newly queued
work. Reconnect or Sync replays the queue through the semantic API. No new table,
domain primitive, RLS policy, or location-tracking inference is introduced.

## V0 actions and V1 Diary decision

Add note is deliberately absent from V0 Quick Actions. Knowledge remains in the
domain/API, including contextual Knowledge and saved locations. Calendar derives
its empty state from having no scheduled projected Events; Add Event stays visible.

Diary belongs to **V1**, as a chronological, searchable projection over Events +
Knowledge, **not a DiaryEntry primal type**. It will mix actual/retrospective
Events, notes, and eventually photos. Notes are Knowledge and should not require
titles in that future UX. Capture should be one focused sheet/editor, not sequential
browser prompts: automatic timestamp, opportunistic location that never blocks
capture. Search should cover note text, Events and places; structured filters can
follow later. Arbitrary notes must not enter the operational Active Journey timeline.
This PR does not implement Diary or change V0 Knowledge validation.

## Safe build updates

The worker is checked on startup, foreground/pageshow, reconnect, and every five
minutes while visible and online. An installed
waiting worker produces **Porter update ready · Update** outside the Trip render
root. Merely becoming ready does not activate or reload. Explicit Update queues
consent; any owned interaction must release before activation, and ownership is
checked again before the single reload. Quick → Add Event must retain ownership
even when an old close event arrives on the reused dialog. Local mutation writes
complete before the dialog is released. No IndexedDB data is deleted by updating.

Activation conservatively requires just one Porter window on this origin. Close
other tabs/PWA windows and retry; they may have tickets or unsaved edits open.
Old shell/art caches retire on activation as before. Diagnostics includes running
revision/build, waiting build, consent/application state and update errors. This
does not retrofit the update button into a pre-fix cached bundle: an initial
close/reopen may still be needed to reach this release. No periodic forced reloads.

## Rich production acceptance Journey

After review/merge and deploying the new main release, run this exact command on
the existing VPS. It prompts for the ordinary Porter owner account email and a
hidden password; credentials are not printed, written to disk, or passed as arguments.

```bash
sudo -u porter /usr/bin/node --env-file=/etc/porter/runtime.env /opt/porter/current/scripts/seed-acceptance.mjs
```

For noninteractive operation only, `PORTER_SEED_TOKEN` can supply a short-lived
owner JWT through a securely provided environment. No service-role key is used.
The seeder loads the existing production configuration, validates the owner,
uses `PersistentPorterService` and its authenticated Storage adapter, and checks
the resulting packet through the real loopback `/client` HTTP boundary. Public
HTTPS and actual-iPhone testing are still separate checks.

The default anchor is the current **Australia/Darwin** calendar day. The 21-day
range is anchor minus 10 through anchor plus 10. For an October 5, 2026 run that
is **September 25–October 15**, with **October 5** in the middle. To inspect without
credentials or writes: `node scripts/seed-acceptance.mjs --plan --date=2026-10-05`.
The same `--date=YYYY-MM-DD` option pins a deliberate repeat run.

Reruns find the Trip by a reserved description marker, Events by provenance,
Knowledge by sources, and originals by stable artifact IDs. IDs are retained;
the scenario dates are rebased to the supplied/current anchor. Seed-owned fields
are reset, so do not use this disposable Trip for real travel. Unmarked Trips and
user-added Events/Knowledge are not deleted. A conflicting unmarked title or
duplicate markers fails closed. A per-owner VPS lock prevents concurrent local
seeders; do not run seeders simultaneously from different hosts. Interrupted
uploads can be recovered through checksum-verified semantic metadata attachment.

The command prints the real **Trip ID, URL, date range, anchor day, counts,
TripPacket revision, and important Event IDs**. No production Trip ID is
invented when credentials are unavailable. No production seeding was performed
from this development workspace.

### What to exercise

- Three named participants: Wes, Skye, Tor; 3 daily plans on each of 21 days,
  morning/afternoon/evening, individual and family perspectives.
- Past first stay; current South Bank apartment with check-in Knowledge;
  current London hire car; future Rome stay and hire; accommodation change.
- Arrival near the beginning; London → Rome flight on day +1 (two time zones);
  Rome → London return on day +10.
- Today's architecture walk and science play overlap afternoon plans.
- Ostia excursion on day +3 is a composite with train and picnic children.
- Three unscheduled choices, optional sunrise photography, cancelled rooftop
  tasting, plus completed, planned and confirmed Events.
- Today's family theatre: 3 offline admissions, Wes QR, Skye Code128,
  Tor cached SVG original. All originals and encoded values say INVALID / NOT
  VALID FOR ADMISSION. No generated code represents a real ticket.
- Planetarium on day +2 intentionally lacks Tor's admission artifact (no broken
  required manifest entry); day +4 concert requires an external-app URL pointing
  to an intentionally invalid example domain; day +5 voucher has only an original.
- Global guide/meeting-point Knowledge and Event-specific check-in, car, flight,
  and theatre Knowledge; substantial Past and Later sections.

Open the printed Trip URL, let artifact sync finish, then test on the iPhone.
Cache each perspective online before testing that perspective offline. The seed
verifies storage bytes and semantic projection, not browser offline readiness.

## Automated evidence boundary

Browser tests serve the production build, not the development fixture harness.
Waiting-worker/owned-interaction cases run in both Chromium and WebKit. Parking
uses fully offline fresh documents in Chromium; the available Linux WebKit runner
reported internal navigation errors for both offline reload and new-tab navigation,
so its parking case uses fresh documents with the client API unavailable instead.
That is not a claim that WebKit offline shell navigation passed. Both exercise
real IndexedDB, the semantic HTTP boundary after reconnect, and cleared state in
source truth. The normal Sync control completes replay after reconnect. Unit tests
also cover mutation ordering, dependency failure, idempotence and superseded clears.
