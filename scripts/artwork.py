"""Audit originals and create delivery derivatives, including shell-cached Event icons. Requires Pillow.

Run python scripts/artwork.py. Originals are never rewritten.
"""
from pathlib import Path
import json
from PIL import Image
import sys

root = Path(__file__).resolve().parent.parent
source = root / 'assets/artwork'
delivery = root / 'public/artwork'
rows = []
icons = []
roles = {
    'brand': 'Original production identity; contain wordmark/icon, shallow wide Journey hero.',
    'event-illustrations': 'Centred subject; square or modest landscape crop; use at 96px+.',
    'current-state': 'Square scene; preserve full subject; compact 80px+ card inset.',
    'system-states': 'Square composition; contain at 160px+; explanatory text separate.',
    'operational-icons': 'Opaque white tile; contain at 64px+; unsuitable for tiny toolbar icons.',
    'textures': 'Low contrast surface; crop/tile; keep dense text on clean stock.',
    'frames': 'Contain, never crop; decorative only. Postcard includes two panels.',
    'marginalia': 'Contain; several files are motif sheets, unsuitable at small sizes.',
    'status-stamps': 'Contain at 72px+; redundant accessible text always required.',
}
for path in sorted(source.glob('*/*')):
    if path.suffix not in ('.png', '.jpeg', '.jpg'):
        continue
    if '--event-icons-only' in sys.argv and path.parent.name != 'event-illustrations':
        continue
    with Image.open(path) as image:
        image.load()
        if path.parent.name == 'event-illustrations':
            icon = image.copy()
            icon.thumbnail((96, 96), Image.Resampling.LANCZOS)
            icon_path = delivery / 'event-icons' / (path.stem + '.webp')
            icon_path.parent.mkdir(parents=True, exist_ok=True)
            icon.save(icon_path, 'WEBP', quality=78, method=6)
            icons.append(icon_path)
        if '--event-icons-only' in sys.argv:
            continue
        width, height = image.size
        alpha = 'A' in image.getbands() and image.getextrema()[-1][0] < 255
        output = delivery / path.parent.name / (path.stem + '.webp')
        output.parent.mkdir(parents=True, exist_ok=True)
        image.thumbnail((1280, 1280) if path.parent.name == 'brand' else (640, 640))
        image.save(output, 'WEBP', quality=82, method=6)
        if path.stem == 'porter-app-icon':
            for size in (180, 192, 512):
                with Image.open(path) as icon:
                    icon.resize((size, size), Image.Resampling.LANCZOS).save(delivery / 'brand' / f'porter-app-icon-{size}.png')
    rows.append({'file': str(path.relative_to(source)), 'family': path.parent.name,
                 'width': width, 'height': height, 'format': path.suffix[1:],
                 'transparent': alpha, 'bytes': path.stat().st_size,
                 'deliveryBytes': output.stat().st_size, 'use': roles[path.parent.name]})
if '--event-icons-only' not in sys.argv:
    (root / 'docs/artwork-audit.json').write_text(json.dumps(rows, indent=2) + '\n')
if rows:
    print(f'{len(rows)} originals decoded; {sum(x["bytes"] for x in rows):,} source bytes; '
          f'{sum(x["deliveryBytes"] for x in rows):,} delivery bytes')

print(f'{len(icons)} Event icons; {sum(path.stat().st_size for path in icons):,} icon bytes')
