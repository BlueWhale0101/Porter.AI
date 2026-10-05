# Real-iPhone acceptance tuning

The first acceptance build's speed is a constraint: Calendar opening, paging,
color rendering and Event tapping use the already-local TripPacket. No new
request, schema, domain concept or synchronization path is introduced.

Current State's fallback previously applied to parking alone, rather than the
whole strip. It now appears only when accommodation, hire and parking are empty.
Intrinsic grid tracks now shrink within their containers (including the Next
card and current-state cards), rather than forcing the document wider. The page
does not hide overflow to mask it. Current State and Schedule own their bounded
scrolling; document vertical scrolling is retained.

Itinerary dates use prominent ruled, uppercase diary headings, e.g.
FRIDAY · SEP 25. Their source remains the Event's local date.

## Calendar

Week Overview is the default. Monday–Sunday fit the phone width simultaneously;
previous/next buttons page discretely across the Trip. It initially chooses the
week containing the Event-local current date, or the first scheduled week when
today is outside the Trip. Empty days remain visible. A stable 06:00–23:00 scale
covers the acceptance Journey's waking plans. Earlier/later Events remain
tappable in compact edge rows; a crossing Event is clipped to the waking range
and also appears in its edge row. Short block labels are intentionally partial;
their accessible names retain the full title, and taps open existing Details.

Schedule retains the detailed, Event-local time grid. Its bounded two-axis
scroller owns sticky date headers, sticky time labels and a corner fixed in both
axes. Existing departure-local placement, overlap lanes, sparse/Unscheduled and
composite-leaf semantics remain unchanged. It is not a new itinerary engine.

`Event.visual.color` is an optional presentation token: terracotta, olive, sky,
ochre, lavender, rose or slate. Default stores null. The normal Event editor,
mutation queue and TripPacket preserve it alongside other visual fields. Unknown
tokens render as default; tokens never become CSS supplied by the source. No
color is inferred from structural flags, participants or titles.

There is no `tentative` commitment in the existing domain. The discretionary
`optional` commitment is represented with dashed outlines and hatching in both
Calendar views, with an explicit optional label. Planned is not silently
reclassified; no parallel status is added. Manual color and optional treatment
compose independently. **Batch Event coloring is deferred to V1.**

## Regression boundaries

Unit coverage checks paging, Event-local date headings, waking-range clipping,
out-of-range visibility, presentation-only colors and semantic persistence.
Production-bundle browser tests run Chromium and WebKit phone contexts including
a 320px viewport, populated/empty Current State, bounded horizontal overflow,
seven headings, paging, shared Details, sticky Schedule axes, cached reload and
pending color edits. Local interactions are checked with the API unavailable and
zero `/client` requests; Calendar opening has a coarse 1.5s end-to-end automation
guard, not a device performance claim. Timezone formatters are reused and Events
are grouped once instead of formatting every Event for every Calendar day.
Only the selected Calendar representation is rendered.

Actual iPhone rubber-band gestures, visual approval and perceived speed remain
real-device acceptance checks; Linux WebKit emulation is not an iPhone result.
