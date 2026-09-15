# Image brief

Every photograph the site can use, what it is for, what to name the file, and a
prompt describing the image that belongs there.

**How to add one.** Drop the file into `public/assets/img/` under the name in the
**File name** column and run `npm run build` (Vercel runs it on deploy). Nothing
else changes — no code edit, no config. Until a file exists, the slot shows a
generated placeholder, and the build log says which real images it picked up.

**Formats.** `.webp` is preferred, then `.avif`, `.jpg`, `.png`. Save a WebP copy
beside a JPEG under the same name and the WebP is used automatically. Keep each
file under ~400 KB; the underlay is fetched on every page, so keep that one
under 250 KB.

**House style.** Navy, white and steel, with the oxide red from the logo as the
only warm accent. Real operations, not stock-photo handshakes: working light,
weather, wear on the steel. No visible third-party carrier branding, no faces
close enough to need a model release, nothing that dates quickly. Everything
sits behind a scrim with type over it, so leave calm space where headlines go —
usually the left third or the centre.

---

## 1. Hero slideshow

Three frames behind the tracking console. They cross-fade, so they should feel
like one sequence: the same hour of day, the same weather.

| Slot | File name | Size | Prompt |
| ---- | --------- | ---- | ------ |
| Hero 1 | `hero-1.webp` | 1920×1080 | A large container ship under way in open sea at first light, shot from a low angle just off the bow quarter. Stacked navy and rust-red containers, spray at the waterline, a long calm horizon behind. Cool blue-grey light, slight haze, no land. Calm sky in the upper left third where a headline sits. |
| Hero 2 | `hero-2.webp` | 1920×1080 | A container terminal at blue hour from a distance: gantry cranes in silhouette, stacks lit by sodium and LED work lights, reflections on wet quay concrete. Deep navy sky, no people identifiable, no carrier logos legible. |
| Hero 3 | `hero-3.webp` | 1920×1080 | The bridge wing of a cargo vessel at sea, looking forward along the deck over the container stacks. Radar mast and railing in the near frame, ocean ahead, overcast daylight. Documentary, not heroic. |

## 2. Page images

| Slot | Where it appears | File name | Size | Prompt |
| ---- | ---------------- | --------- | ---- | ------ |
| Underlay | Fixed behind every page | `paramount-underlay.webp` | 2400×1400 | A near-abstract sea surface from high above at dusk — deep navy water, faint swell texture, a single wake line crossing one corner. Very low contrast, nothing recognisable, no horizon. This sits behind all type at low opacity, so it must read as texture rather than as a picture. |
| About | `/about`, the company block | `paramount-about.webp` | 1600×1000 | Three colleagues at a shipping operations desk reviewing a vessel schedule on screen, seen from behind and to one side so no face is the subject. Monitors showing charts and timetables, daylight from a window, navy and grey interior. Working, not posing. |
| Network | `/network` header | `paramount-network.webp` | 1600×1000 | An aerial of a deep-sea container terminal at midday: rows of stacked containers in receding blocks, straddle carriers between them, a berthed ship along the quay. Geometric, top-down enough to read as a network rather than a single ship. |
| Control tower | Home page, "why Paramount" | `paramount-control.webp` | 1600×1000 | A logistics control room at night: a wall of screens showing vessel positions and lane maps, two operators at desks in the foreground, shot wide from behind. Screen glow on navy walls, no readable third-party software. |
| Leadership | `/about`, the portrait | `paramount-ceo.webp` | 1200×1400 (4:5) | A corporate portrait of a woman in her late forties, chief-executive presence, standing with arms unfolded in a modern office with a port visible softly out of focus behind. Navy blazer, natural window light, direct eye contact, no smile-for-the-camera. Shot at f/2 so the background falls away. |
| Careers | `/careers` | `paramount-careers.webp` | 1600×1000 | A terminal supervisor in hi-vis and hard hat talking with a colleague beside a container stack, both mid-conversation with a tablet between them. Daylight, genuine, not a stock handshake. Shot slightly wide so the workplace is legible. |
| Contact | `/contact` | `paramount-contact.webp` | 1600×1000 | The exterior of a modern port-side office at dusk — glass frontage lit from within, harbour cranes behind, wet pavement reflecting the light. Calm, welcoming, nobody in frame. |
| Warehouse | Warehousing service | `paramount-warehouse.webp` | 1600×1000 | The interior of a high-bay bonded warehouse: racking rising out of frame, a reach truck in the aisle, floor markings crisp, cool white light. Clean and orderly, shot down the aisle for depth. |
| Link card | Shared links, social previews | *(already generated)* | 1200×630 | Generated from the logo by `scripts/build-brand.py`. Replace only if you want a photographic card — if so, a container ship at sea with the logo lower-left and room for nothing else. |

## 3. Service cards

One per service, shown at roughly 4:3 in a card. Each needs to be readable at
about 380 px wide, so a single clear subject, no busy detail.

| Service | File name | Size | Prompt |
| ------- | --------- | ---- | ------ |
| Air freight | `service-air.webp` | 1200×900 | A freighter aircraft being loaded through the nose door at dusk, pallet on the main-deck loader, ground crew in silhouette. Blue hour, apron lights, no airline livery legible. |
| Ocean freight | `service-ocean.webp` | 1200×900 | A container ship berthed under gantry cranes seen from the quay, one container suspended mid-lift against an overcast sky. Emphasis on scale. |
| Road haulage | `service-road.webp` | 1200×900 | An unmarked curtain-side truck on a motorway at dawn, shot from a low three-quarter angle with motion in the road surface. Cool morning light, wet tarmac, no visible branding. |
| Rail freight | `service-rail.webp` | 1200×900 | A container train on a long straight through open country, shot from a low angle beside the track so the wagons recede to a point. Overcast, industrial, no graffiti legible. |
| Express courier | `service-express.webp` | 1200×900 | A courier's hands scanning a parcel label with a handheld terminal, shallow depth of field, van interior soft behind. Close, quick, unglamorous. |
| Warehousing | `service-warehousing.webp` | 1200×900 | Pick-and-pack stations in a fulfilment centre: cartons on a conveyor, an operator's hands taping a box, racking behind. Cool white light, tidy, no brand marks on the cartons. |

## 4. Brand assets — already in place

Generated from `public/assets/img/Logoshipping.png` by
`python3 scripts/build-brand.py`. Re-run it if the logo is ever replaced; do not
edit the outputs by hand.

| Asset | File | Used for |
| ----- | ---- | -------- |
| Full lockup | `assets/brand/paramount-logo.webp` / `.png` | Footer, menu drawer (light theme) |
| Full lockup, light ink | `assets/brand/paramount-logo-light.webp` / `.png` | Footer, drawer (dark theme) |
| Ship mark | `assets/brand/paramount-mark.webp` / `.png` | Header (light theme) |
| Ship mark, light ink | `assets/brand/paramount-mark-light.webp` / `.png` | Header (dark theme) |
| Favicons | `favicon-32.png`, `favicon.png`, `apple-touch-icon.png` | Browser tab, bookmarks, home screen |
| Link card | `assets/img/paramount-og.png` | Social and chat link previews |

## 5. Not photographs

These are drawn by the site and need no files:

- **The fleet chart** on the home page — real Natural Earth coastlines, built by
  `scripts/build-world-map.js` into `public/assets/map/world.js`.
- **The network schematic** on `/network` — drawn from hub coordinates in
  `src/data/network.json`.
- **Route maps** on a tracking result — drawn from the consignment's own
  recorded positions.
- **Icons** — an inline set in `src/site/layout.js`.

---

## Quick checklist

```
public/assets/img/
  hero-1.webp              1920x1080
  hero-2.webp              1920x1080
  hero-3.webp              1920x1080
  paramount-underlay.webp  2400x1400
  paramount-about.webp     1600x1000
  paramount-network.webp   1600x1000
  paramount-control.webp   1600x1000
  paramount-ceo.webp       1200x1400
  paramount-careers.webp   1600x1000
  paramount-contact.webp   1600x1000
  paramount-warehouse.webp 1600x1000
  service-air.webp         1200x900
  service-ocean.webp       1200x900
  service-road.webp        1200x900
  service-rail.webp        1200x900
  service-express.webp     1200x900
  service-warehousing.webp 1200x900
```

Seventeen files. The site works without any of them.
