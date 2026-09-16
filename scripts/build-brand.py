#!/usr/bin/env python3
"""Derive every brand asset from the one supplied logo.

Run by hand when the logo changes; the outputs are committed, so nothing is
generated at request time:

    python3 scripts/build-brand.py

Source: public/assets/img/Logoshipping.png — a navy-and-red container-ship
emblem on a white ground. What the site needs from it:

  * the lockup with the white ground knocked out, so it sits on any panel
  * a white cut of the same artwork, because navy on a dark theme is invisible
  * the ship mark alone, for the favicon and anywhere too small for the words
  * a link-card image, which needs its own framing rather than a squeezed logo
"""

import os
from collections import deque

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'assets', 'img', 'Logoshipping.png')
BRAND = os.path.join(ROOT, 'public', 'assets', 'brand')
PUBLIC = os.path.join(ROOT, 'public')

NAVY = (12, 31, 61)
PAPER = (244, 246, 250)
LIGHT_INK = (233, 239, 249)


def knock_out_ground(img, tolerance=26):
    """Make the white *surround* transparent, leaving white inside the art.

    A plain "every white pixel becomes transparent" would punch holes through
    the ship's hull and superstructure, which are white too. Flooding inwards
    from the border only reaches the ground.
    """
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()

    def is_ground(x, y):
        r, g, b, _ = px[x, y]
        return r >= 255 - tolerance and g >= 255 - tolerance and b >= 255 - tolerance

    seen = bytearray(w * h)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_ground(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_ground(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        px[x, y] = (255, 255, 255, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_ground(nx, ny):
                seen[ny * w + nx] = 1
                queue.append((nx, ny))

    return img


def trim(img, padding=0):
    """Crop to the artwork, with optional breathing room."""
    box = img.getbbox()
    if not box:
        return img
    left, top, right, bottom = box
    return img.crop((
        max(0, left - padding),
        max(0, top - padding),
        min(img.size[0], right + padding),
        min(img.size[1], bottom + padding),
    ))


def to_white(img, gain=1.3, floor=0.12):
    """A one-colour white cut of the same artwork, for dark backgrounds.

    Not a recolour and not a silhouette. Ink coverage becomes opacity: the
    darker a pixel was, the more opaque the white that replaces it. The navy
    line-work and the lettering come back solid white, the ship's white
    superstructure drops away to the background, and the drawing keeps its
    structure — so it reads as the same logo rather than a second one.

    A flat inversion was the alternative, and it hollowed the wordmark out into
    outlines. `gain` steepens the ramp so mid-tones commit to white; `floor`
    keeps the palest ink from vanishing entirely.
    """
    img = img.convert('RGBA')
    px = img.load()
    w, h = img.size
    out = Image.new('RGBA', img.size, (255, 255, 255, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            cover = min(1.0, max(0.0, (1.0 - luma) * gain + floor))
            op[x, y] = (255, 255, 255, int(a * cover))
    return out


def rounded_plate(size, radius, colour):
    plate = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=colour + (255,))
    return plate


def fit(img, box):
    """Scale to fit inside a box, keeping the aspect ratio."""
    scale = min(box[0] / img.size[0], box[1] / img.size[1])
    return img.resize((max(1, int(img.size[0] * scale)), max(1, int(img.size[1] * scale))), Image.LANCZOS)


def centre(base, img, dy=0):
    base.alpha_composite(img, ((base.size[0] - img.size[0]) // 2, (base.size[1] - img.size[1]) // 2 + dy))
    return base


os.makedirs(BRAND, exist_ok=True)
source = Image.open(SRC)

# --- the lockup, on any ground ---------------------------------------------
# 560px wide: the header shows it about 46px tall and the footer a little
# larger, so this covers both at 2x. The emblem is full of soft shading, which
# PNG stores badly, so WebP is written beside it and the markup prefers it —
# 40 KB against 200, on every page load.
lockup = trim(knock_out_ground(source), padding=6)
DISPLAY_W = 560


def save_pair(img, name):
    sized = img.resize((DISPLAY_W, int(DISPLAY_W * img.size[1] / img.size[0])), Image.LANCZOS)
    sized.save(os.path.join(BRAND, f'{name}.png'), optimize=True)
    sized.save(os.path.join(BRAND, f'{name}.webp'), quality=88, method=6)
    return sized


save_pair(lockup, 'paramount-logo')
save_pair(to_white(lockup), 'paramount-logo-light')

# --- the ship alone ---------------------------------------------------------
# The emblem is ship, then wordmark, then compass. Everything above the words
# is the mark, and it is what survives being shown at 32 pixels.
w, h = lockup.size
mark = trim(lockup.crop((0, 0, w, int(h * 0.46))))
mark_sized = mark.resize((360, int(360 * mark.size[1] / mark.size[0])), Image.LANCZOS)
mark_sized.save(os.path.join(BRAND, 'paramount-mark.png'), optimize=True)
mark_sized.save(os.path.join(BRAND, 'paramount-mark.webp'), quality=88, method=6)

light_mark = to_white(mark).resize(mark_sized.size, Image.LANCZOS)
light_mark.save(os.path.join(BRAND, 'paramount-mark-light.png'), optimize=True)
light_mark.save(os.path.join(BRAND, 'paramount-mark-light.webp'), quality=88, method=6)

# --- favicons ---------------------------------------------------------------
# On a navy plate: the mark is mostly white line-work, which vanishes against a
# browser's light tab strip on its own.
for size, name in ((180, 'apple-touch-icon.png'), (64, 'favicon.png'), (32, 'favicon-32.png')):
    plate = rounded_plate((size, size), int(size * 0.22), NAVY)
    centre(plate, fit(to_white(mark), (int(size * 0.84), int(size * 0.62))))
    plate.save(os.path.join(PUBLIC, name), optimize=True)

# --- link card --------------------------------------------------------------
# Framed for the 1200x630 slot rather than the logo letterboxed into it.
card = Image.new('RGBA', (1200, 630), NAVY + (255,))
draw = ImageDraw.Draw(card)
for i in range(180):  # a soft horizon, so the card is not a flat rectangle
    alpha = int(26 * (1 - i / 180))
    draw.line((0, 630 - i, 1200, 630 - i), fill=(255, 255, 255, alpha))
centre(card, fit(to_white(lockup), (760, 430)), dy=-6)
card.convert('RGB').save(os.path.join(BRAND, 'paramount-og.png'), quality=92, optimize=True)

for name in ('paramount-logo.png', 'paramount-logo.webp', 'paramount-logo-light.png',
             'paramount-logo-light.webp', 'paramount-mark.png', 'paramount-mark.webp',
             'paramount-mark-light.png', 'paramount-mark-light.webp'):
    p = os.path.join(BRAND, name)
    print(f'  {name:28} {Image.open(p).size}  {os.path.getsize(p) / 1024:.0f} KB')
for name in ('favicon.png', 'favicon-32.png', 'apple-touch-icon.png'):
    p = os.path.join(PUBLIC, name)
    print(f'  {name:28} {Image.open(p).size}  {os.path.getsize(p) / 1024:.0f} KB')
p = os.path.join(BRAND, 'paramount-og.png')
print(f'  paramount-og.png             {Image.open(p).size}  {os.path.getsize(p) / 1024:.0f} KB')
