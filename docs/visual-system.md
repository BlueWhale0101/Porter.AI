# Porter visual system

Porter uses a weathered travel-diary and practical-document visual language: warm paper, navy ink, terracotta emphasis, olive and sky accents, strong rules, and restrained print texture. The CSS tokens in `client/porter.css` are the single presentation vocabulary for the Journey, Planning, Library, dialogs, and Door Mode. Functional state remains text and semantic controls; artwork, stamps, frames, and marginalia only reinforce it.

## Artwork audit and delivery

`assets/artwork/` holds the original production pack. The checked-in audit in `docs/artwork-audit.json` records each file's family, dimensions, format, transparency, source size, delivery size, and intended role. Run `python scripts/artwork.py` after adding source art to regenerate its WebP delivery derivative under `public/artwork/` and the audit. This keeps originals intact while keeping routine browser delivery small.

`client/artwork.js` is the only artwork manifest and resolver. Resolution is presentation-only and deterministic:

1. an explicit supplied visual asset (`thumbnail_asset` or `hero_asset`)
2. an existing visual role, then structural hints (`accommodation`, `hire`, movement) and conservative title/description hints
3. no art

It never writes inferred categories into Event source truth. Trip artwork intentionally has no generic fallback: a typographic journal cover is the normal fallback. Failed images reserve their layout and either use the generic fallback or become invisible; functional UI is unaffected.

The opaque JPEG operational icon family is deliberately not used as tiny toolbar icons. Current-state scenes, event art, system-state art, and a small Next stamp are used where their crop and scale remain useful. Frames and marginalia remain available for future compositions but are intentionally unused in this first visual pass because they would add decoration without improving travel-time utility.

## Fixture harness

Run `npm run dev`, then open `/?porter-fixture=ready`. It is compiled only in Vite development mode and uses a real-shape in-memory TripPacket, artifact cache, and semantic API seam. It never calls a production endpoint or weakens authentication.

Choose a deterministic state from the fixture strip: `ready`, `partial`, `missing`, `dynamic`, `pending`, `conflict`, `failed`, `syncing`, or `empty`. The fixture covers lifecycle states, participant perspectives, current accommodation/hire/parking, movement, composite and sparse Events, commitment variations, ticket variants, planning/calendar states, and local-first failure states. Its source is `client/dev/fixtures.js`.

## Offline, accessibility, and performance

The service worker precaches the Vite shell only. Generic artwork is cache-on-use with a 24-entry bound and has no bearing on IndexedDB packets, ticket artifacts, or semantic API calls. A missing decorative asset therefore cannot block a local packet, Door Mode, or a normal render.

Decorative artwork is `aria-hidden` with empty image alt text. Status copy, ticket readiness, conflict state, and controls remain visible text. Door Mode keeps a clean high-contrast ticket surface with no art behind machine-readable codes.

Rendering marks `visual_enhancement_start`, `critical_visuals_ready`, and `visual_enhancement_complete` after the local packet is already available; they complement existing utility timing marks rather than redefining readiness. Visual image decoding is lazy and dimensions are reserved to avoid artwork-induced layout shifts.
