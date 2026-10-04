# Porter.AI production artwork

## Use rules

- **Event illustrations** are square (`1254 × 1254`) opaque fallback images. Keep the key subject centred when a card crops them.
- **Current state** illustrations are opaque, square travel scenes for current accommodation, hire vehicle, and parked location.
- **Operational icons** are opaque JPEG artwork with white backgrounds; use as a source/visual reference or over a matching light UI surface, rather than assuming transparency.
- **System states** are square opaque illustrations. Application copy is supplied separately; do not rely on the picture to communicate the state.
- **Textures** are opaque, low-contrast surfaces intended for CSS background cropping or tiling. Use an opacity overlay when live text needs stronger contrast.
- **Stamps, marginalia, and frames** are RGBA PNGs. They are decorative/container layers, never sources of essential information.
- Custom trip artwork always takes precedence over the generic `porter-event-*` fallback.

## Family inventory

| Folder | Purpose | Background |
| --- | --- | --- |
| `operational-icons` | Travel actions and object categories | Opaque JPEG |
| `current-state` | Accommodation, hire, and parked-state art | Opaque JPEG |
| `event-illustrations` | Generic Event-role fallbacks | Opaque square PNG |
| `system-states` | Empty, missing, offline, and sync system states | Opaque square PNG |
| `textures` | Paper/card material surfaces | Opaque crop/tile PNG |
| `frames` | Dynamic-content containers | Transparent RGBA PNG |
| `marginalia` | Decorative map/travel motifs | Transparent RGBA PNG |
| `status-stamps` | Reusable operational state labels | Transparent RGBA PNG |

## Palette

Keep new Porter assets within the established family: navy/ink blue, warm cream, terracotta red, olive green, muted sky blue, and natural leather brown. Prefer restrained print wear and paper texture over heavy grunge.

## Delivery strategy

The files in this directory are the unchanged production originals. `python scripts/artwork.py` audits those originals, writes the exact audit to `docs/artwork-audit.json`, and creates the browser delivery derivatives in `public/artwork/`. The delivery files are bounded to a 640px longest edge and WebP quality 82; source art is never replaced by the optimization step.

The service worker precaches only the application shell. Generic art is cached on use (with a small bounded cache), so it can improve later offline renders without delaying first useful render or making artwork a requirement for utility.
