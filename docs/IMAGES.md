# Images

Every photograph on the site, where it came from, and where it goes.

## How it works

```
public/assets/img/*.png      the originals you upload. Kept, but never served.
  ↓  python3 scripts/build-photos.py
public/assets/photo/         the sized WebP crops the pages serve. Committed.
  ↓  npm run build
public/*.html                the built pages, with the right file in the right slot.
```

Upload wherever you like in `public/assets/img/` — that is where the images
already are and where the next one should go. They stay in the repo; they are
simply not what the browser asks for. `.vercelignore` drops every `.png` in that
directory from the deploy, because each one is a source file with a web-sized
twin next door, and `npm run check:vercel` fails the build if any page ever
points at one of them.

Three tables at the top of `scripts/build-photos.py` decide what goes where —
`BANNERS`, `CARDS`, `WIDES` — one line each. To point a page at a different
photograph, change the name on the right of that line and re-run the script.
Nothing else needs editing.

**Adding a photograph.** Drop it into `public/assets/img/` with a plain
lower-case name, add or change the line that uses it, then:

```
python3 scripts/build-photos.py && npm run build
```

Any common format works; the script converts. Originals can be as large as you
like — 46 MB of PNG comes out as about 3 MB of WebP, and none of the 46 MB is
deployed.

**The escape hatch.** A `.webp`, `.jpg` or `.svg` dropped into
`public/assets/img/` under one of the `prefer` names in `src/data/images.json` is
served as-is, with no script run — the exclusion rule only covers `.png`, which
is the format the uploads arrive in. Keep it web-sized if you use this.

---

## What is in place

Twelve photographs, supplied. Each page opens on its own banner, so no two
pages share an opening picture.

### Page banners — 2400×820

| Page | Source | What it shows |
| --- | --- | --- |
| `/` | `landinghero.png` | A Paramount container on a truck, forklift working alongside |
| `/services` | `cargoloading.png` | A branded container being loaded, crew in hi-vis |
| `/network` | `shipyard.png` | Container yard, reach stackers, crew in conversation |
| `/about` | `collage.png` | Operations collage — crew, containers, a truck on the quay |
| `/careers` | `careers.png` | Crew on the quay at sunset, ship berthed behind |
| `/contact` | `shipsailing.png` | A container ship under way in open sea |
| `/quote` | `freight.png` | A freighter aircraft nose-loading, ground crew on the apron |
| `/portal` | `ship.png` | A laden container ship at sea |
| `/apply` | `warehouse.png` | Bonded warehouse, forklifts, a container on the dock |
| `404` | `trainlogistics.png` | A container train and a reach stacker |

Banners crop to a letterbox from the upper-middle of the frame — horizons,
cranes and faces live there; empty tarmac lives at the foot.

### Service cards — 1200×900

| Service | Source |
| --- | --- |
| Air freight | `freight.png` |
| Ocean freight | `ship.png` |
| Road haulage | `landinghero.png` |
| Rail freight | `trainlogistics.png` |
| Express courier | `cargoloading.png` |
| Warehousing | `warehouse.png` |

Each service page also uses its card photograph in its banner, picked up from a
build-time map in the page (`#svc-images`).

### In-page figures — 1600×1000

| Slot | Where | Source |
| --- | --- | --- |
| About | `/about`, the company block | `collage.png` |
| Network | `/services/:id`, before its own artwork loads | `shipyard.png` |
| Control | Home, "why Paramount" | `shipyard.png` |
| Careers | `/careers`, beside the open roles | `careers.png` |

Every other page carries its photograph in the banner and nowhere else —
repeating the same picture further down a page reads as padding, not design.

### Portrait — 1200×1500

`/about`, the leadership portrait: `newceoimage.png`, cropped from the top so
the sitter's head is the subject rather than their desk. The earlier
`ceo.png` is kept in `public/assets/img/` but is not used anywhere — change the
`PORTRAITS` line in `scripts/build-photos.py` to bring it back.

### The plate behind every page — 2400×1400

Derived from `shipsailing.png`: blurred 26px, desaturated, darkened to 62%. It
sits behind all type at low opacity, so it has to read as texture rather than as
a picture.

---

## Brand assets

Generated from `public/assets/img/Logoshipping.png` by
`python3 scripts/build-brand.py`.
Re-run it if the logo is ever replaced; do not edit the outputs by hand.

| Asset | File | Used for |
| --- | --- | --- |
| Full lockup | `assets/brand/paramount-logo.{webp,png}` | Footer, menu drawer (light) |
| Full lockup, white | `assets/brand/paramount-logo-light.{webp,png}` | Footer, drawer (dark) |
| Ship mark | `assets/brand/paramount-mark.{webp,png}` | Header (light) |
| Ship mark, white | `assets/brand/paramount-mark-light.{webp,png}` | Header (dark) |
| Favicons | `favicon-32.png`, `favicon.png`, `apple-touch-icon.png` | Tab, bookmarks, home screen |
| Link card | `assets/brand/paramount-og.png` | Social and chat previews |

The white versions are a one-colour cut of the same artwork, not a recolour: ink
coverage becomes opacity, so the line-work and the lettering come back solid
white and the ship keeps its structure. A flat inversion was the alternative and
it hollowed the wordmark out into outlines.

---

## If you want to replace something

House style: navy, white and steel, with the oxide red from the logo as the only
warm accent. Real operations, not stock-photo handshakes — working light,
weather, wear on the steel. No visible third-party carrier branding, no faces
close enough to need a model release. Everything sits behind a scrim with type
over it, so leave calm space where the headline goes, usually the left third.

Prompts, if you are generating replacements:

| Slot | Prompt |
| --- | --- |
| Landing banner | A Paramount-branded container on a truck being loaded at a terminal door, forklift alongside, crew in hi-vis. Cool overcast daylight, wet concrete. Wide enough to crop to a 3:1 band with calm space on the left. |
| Services | A branded shipping container open on the quay, cartons being loaded by forklift, two crew directing. Daylight, no other carrier marks legible. |
| Network | Aerial of a deep-sea container terminal at midday: stacked containers in receding blocks, straddle carriers between them, a ship berthed along the quay. |
| About | Colleagues at a shipping operations desk reviewing a vessel schedule, from behind and to one side so no face is the subject. |
| Careers | Terminal crew in hi-vis and hard hats mid-conversation beside a container stack at golden hour, a ship berthed behind. |
| Contact | A container ship under way in open sea, shot from the beam, long calm horizon. Deep blue, no land. |
| Quote | A freighter aircraft loading through the nose door, pallet on the main-deck loader, ground crew in silhouette. No airline livery legible. |
| Portal | A laden container ship at sea from the bow quarter, stacks reading clearly against the water. |
| Apply | High-bay bonded warehouse: racking rising out of frame, reach truck in the aisle, crisp floor markings, cool white light. |
| 404 | A container train on a long straight, low angle beside the track so the wagons recede to a point. Overcast, industrial. |
| Leadership | Corporate portrait, chief-executive presence, in a modern office with a port softly out of focus behind. Natural window light, direct eye contact. Shot at f/2. |
| Underlay | Near-abstract sea surface from high above at dusk — deep navy water, faint swell, one wake line crossing a corner. Very low contrast, no horizon. |
