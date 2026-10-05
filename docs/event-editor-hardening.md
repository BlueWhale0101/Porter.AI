# V0 Event editor integrity and timezone controls

## Investigation and root cause boundary

The original Add/Edit form used a submit button and treated every `submit` event
as permission to persist. It did not distinguish an explicit Save activation
from implicit form submission (such as Enter/Done from a text field). Its success
path then called `dialog.close()`. That is a source-backed accidental-commit path
which also explains the disappearing modal after a submission.

No inspected `visibilitychange`, `pagehide`, focus, resume, service-worker or owner
release handler submitted Event drafts. The exact physical trigger on the reported
iPhone was not captured; it would be incorrect to claim app switching itself was
proven to submit the form. A separate asynchronous render gap could replace a
dialog opened while IndexedDB reads were pending. Rendering now checks ownership
both before and after those reads; surface navigation also respects the owner.

Save is now a separate `type=button` with one trusted activation handler and an
in-flight guard. All form submissions are cancelled. Enter from ordinary fields,
synthetic clicks and lifecycle notifications cannot commit. A living document
keeps its editor DOM/draft through background/resume. No draft is stored as a source
Event or mutation before Save. Document eviction may lose the draft; it cannot
save it. Dismissal discards it.

## Temporal integrity

The old converter used coercive Date.UTC components and returned its iterative
guess without requiring an exact wall-time round trip. Domain validation merely
checked Date.parse. Neither was sufficient to reject normalized impossible dates.
The reported year 2407 is technically parseable; it cannot honestly be described
as an impossible Gregorian date. V0 now explicitly accepts Event years **1900–2100**
at UI and semantic boundaries, so accidental multi-century dates fail visibly.

Shared validation requires complete date/time syntax, real Gregorian components,
explicit offsets on source instants, valid supplied timezone IDs and non-reversed
start/end instants. Local-to-instant conversion requires exactly one round-trip
match. DST gaps and repeated hours are rejected with an explanation, never guessed.
Existing offset-qualified source instants remain accepted; missing zones on legacy
source records remain representable. No migration or source-data rewrite occurs.

Validation errors stay inline with the editor open. HTTP 400 semantic rejection
is no longer swallowed into an offline mutation. A successful mutation followed
by a failed packet refresh is not queued again. The existing Event revision is
included in TripPacket descriptors for normal optimistic Edit operations.

## Local timezone UX

The picker searches friendly city labels using browser-bundled timezone IDs.
No geocoder, server lookup or new Trip timezone property is introduced. Inference
uses Event-local dates: a covering accommodation first, other same-date/spanning
Events next, then nearest start/arrival context, with device timezone fallback.
Cancelled Events do not supply context. Ties are deterministic.

Automatic choices follow date changes. An explicit choice, including an existing
Event's stored zone, is retained. Ordinary Events share one timezone control and
start/end zone; Movement reveals a separate arrival timezone. Both editors use
the same controls. Batch or unrelated Event editing is outside this change.

Production-browser regressions simulate lifecycle notifications and implicit
submission, inspect source Events plus IndexedDB mutations, and cover normal
Save/Edit, rejection, offline inference, manual overrides and movement zones.
They do not claim to reproduce an actual iOS process suspension or date wheel.
