#!/usr/bin/env python3
"""
Derive every photographic asset the site serves from the originals in media/.

The originals are 1-8 MB PNGs — right for an archive, wrong for a web page. This
turns each one into the handful of crops the layout actually asks for, at the
sizes it asks for, in WebP with a JPEG twin for anything that still wants one:

    banner    2400x820   the slim page banner behind a page title
    card      1200x900   a service card
    wide      1600x1000  an in-page figure
    portrait  1200x1500  the leadership portrait
    underlay  2400x1400  the fixed plate behind every page, darkened and blurred

Nothing here is destructive: media/ is never written to, and the outputs land in
public/assets/photo/ under predictable names, so re-running after a new upload
is safe. media/ is excluded from the deploy (.vercelignore); the derivatives are
committed, because the Vercel build image has no Pillow.

    python3 scripts/build-photos.py
"""

import os
import sys
from PIL import Image, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'media')
OUT = os.path.join(ROOT, 'public', 'assets', 'photo')

# Slot -> (source file, variant). One source may serve several slots: the same
# photograph makes a good banner and a good card at different crops.
BANNER = (2400, 820)
CARD = (1200, 900)
WIDE = (1600, 1000)
PORTRAIT = (1200, 1500)

# Each page gets its own banner, so no two pages open on the same picture.
BANNERS = {
    'home': 'landinghero',
    'services': 'cargoloading',
    'network': 'shipyard',
    'about': 'collage',
    'careers': 'careers',
    'contact': 'shipsailing',
    'quote': 'freight',
    'portal': 'ship',
    'apply': 'warehouse',
    'notfound': 'trainlogistics',
}

CARDS = {
    'service-air': 'freight',
    'service-ocean': 'ship',
    'service-road': 'landinghero',
    'service-rail': 'trainlogistics',
    'service-express': 'cargoloading',
    'service-warehousing': 'warehouse',
}

WIDES = {
    'paramount-about': 'collage',
    'paramount-network': 'shipyard',
    'paramount-control': 'shipyard',
    'paramount-careers': 'careers',
    'paramount-contact': 'shipsailing',
    'paramount-warehouse': 'warehouse',
}

PORTRAITS = {'paramount-ceo': 'newceoimage'}

# Every photograph carries a little more contrast and saturation than the model
# gives back; the site is navy and steel, and flat originals read as grey on it.
def polish(im):
    im = ImageEnhance.Color(im).enhance(1.06)
    im = ImageEnhance.Contrast(im).enhance(1.05)
    return im


def cover(im, size, focus=0.5):
    """Scale to fill `size` and crop the overflow, keeping `focus` of the height.

    Banners crop hard, and a centre crop beheads people standing on a quay, so
    the caller can pull the window up. 0 is the top edge, 1 the bottom.
    """
    tw, th = size
    sw, sh = im.size
    scale = max(tw / sw, th / sh)
    nw, nh = max(tw, round(sw * scale)), max(th, round(sh * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    left = round((nw - tw) / 2)
    top = round((nh - th) * focus)
    return im.crop((left, top, left + tw, top + th))


def save(im, name, quality=82, jpeg=False):
    os.makedirs(OUT, exist_ok=True)
    im.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=quality, method=6)
    written = [name + '.webp']
    if jpeg:
        im.save(os.path.join(OUT, name + '.jpg'), 'JPEG', quality=quality,
                optimize=True, progressive=True)
        written.append(name + '.jpg')
    return written


def load(stem):
    for ext in ('.png', '.jpg', '.jpeg', '.webp'):
        p = os.path.join(SRC, stem + ext)
        if os.path.exists(p):
            return polish(Image.open(p).convert('RGB'))
    raise SystemExit(f'media/{stem}.* is missing — nothing to derive from.')


def main():
    if not os.path.isdir(SRC):
        raise SystemExit('media/ does not exist; put the original photographs there.')
    made = 0

    for slot, stem in BANNERS.items():
        # Banners crop to a letterbox, so favour the upper-middle of the frame:
        # horizons, cranes and faces live there, empty tarmac lives at the foot.
        save(cover(load(stem), BANNER, focus=0.42), f'banner-{slot}', quality=80)
        made += 1

    for slot, stem in CARDS.items():
        save(cover(load(stem), CARD), slot, quality=80)
        made += 1

    for slot, stem in WIDES.items():
        save(cover(load(stem), WIDE), slot, quality=80)
        made += 1

    for slot, stem in PORTRAITS.items():
        # A portrait crops from the top: the sitter's head, not their desk.
        save(cover(load(stem), PORTRAIT, focus=0.18), slot, quality=84)
        made += 1

    # The plate behind every page: one photograph pushed so far back it reads as
    # texture. Blurred, darkened and desaturated so type sits on it cleanly.
    plate = cover(load('shipsailing'), (2400, 1400), focus=0.45)
    plate = plate.filter(ImageFilter.GaussianBlur(26))
    plate = ImageEnhance.Color(plate).enhance(0.55)
    plate = ImageEnhance.Brightness(plate).enhance(0.62)
    save(plate, 'paramount-underlay', quality=68)
    made += 1

    total = sum(
        os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)
    )
    print(f'photos: {made} slots -> {OUT.replace(ROOT + os.sep, "")} '
          f'({total / 1048576:.1f} MB total)')


if __name__ == '__main__':
    main()
