# Porter.AI production artwork

## Use rules

- **Event illustrations** are square (`1254 × 1254`) opaque fallback images. Keep the key subject centred when a card crops them.
- **System states** are square opaque illustrations. Application copy is supplied separately; do not rely on the picture to communicate the state.
- **Textures** are opaque, low-contrast surfaces intended for CSS background cropping or tiling. Use an opacity overlay when live text needs stronger contrast.
- **Stamps, marginalia, and frames** are RGBA PNGs. They are decorative/container layers, never sources of essential information.
- Use the `porter-<family>-<role>.png` names directly; custom trip artwork always takes precedence over the generic `porter-event-*` fallback.

## Family inventory

| Folder | Purpose | Background |
| --- | --- | --- |
| `event-illustrations` | Generic Event-role fallbacks | Opaque square |
| `system-states` | Empty, missing, offline, and sync system states | Opaque square |
| `textures` | Paper/card material surfaces | Opaque crop/tile |
| `frames` | Dynamic-content containers | Transparent RGBA |
| `marginalia` | Decorative map/travel motifs | Transparent RGBA |
| `status-stamps` | Reusable operational state labels | Transparent RGBA |

## Palette

Keep new Porter assets within the established family: navy/ink blue, warm cream, terracotta red, olive green, muted sky blue, and natural leather brown. Prefer restrained print wear and paper texture over heavy grunge.
