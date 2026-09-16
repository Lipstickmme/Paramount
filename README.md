# Paramount Shipping

Shipment tracking, freight-forwarding website and operations desk for **Paramount
Logistics**. A dependency-light Node/Express backend serves a multi-page frontend,
a JSON API, and the consignment tracking that the whole thing exists for: the desk
books a consignment and mints its tracking number, records every movement against
it, and anyone holding that number can read the same timeline the control tower
works from.

## Stack

- **Backend:** Node.js + Express (one production dependency)
- **Frontend:** hand-written HTML / CSS / vanilla JS, assembled from shared
  partials by a small build step (no framework, no bundler)
- **Data:** flat JSON for editorial content; consignments, movements, rate
  requests, enquiries, chat and inbound mail persisted to Supabase (Postgres) in
  production, or `data/` locally
- **Auth:** Supabase anonymous sign-in for visitors, password sign-in for staff,
  with row level security deciding what each can see
- **Notifications:** bookings, movements, enquiries, rate requests and chat
  routed to an inbox via Resend email and/or a webhook (Slack, Discord, help desk)
- **Inbound mail:** a signed Resend webhook archives and forwards mail sent to
  your domain

## Pages

| URL             | Page                                                                |
| --------------- | ------------------------------------------------------------------- |
| `/`             | Landing page: banner, the tracking console, the fleet chart          |
| `/services`     | The six services, each linking to its own page                      |
| `/services/:id` | One service: how it runs, what it covers, the numbers behind it     |
| `/network`      | Hubs, trade lanes and the world map                                 |
| `/about`        | The company, its leadership and the four rules it works to          |
| `/quote`        | Rate request form                                                   |
| `/portal`       | Customer portal: every consignment on the signed-in account         |
| `/contact`      | Contact details, enquiry form and the FAQ                           |
| `/careers`      | Open roles                                                          |
| `/apply`        | Application form, with the role prefilled from the careers page     |
| `/admin`        | Operations desk (staff sign-in)                                     |
| `404`           | Styled not-found page                                               |

A live-chat widget is on every page except the desk.

Every page opens on the same thing: a slim photographic banner at one fixed
height, a navy scrim over it, and the page title on the scrim. Only the
photograph changes, and no two pages share one.

`/track` was a page of its own until the console — with its result panel, its
timeline and its route map — moved onto the landing page; two pages were saying
the same thing. The route still exists as a 301 to `/?number=…#track`, in both
`src/app.js` and `vercel.json`, so tracking links already emailed or printed on
a label keep working.

## The fleet tracker

The home page leads with a chart of every Paramount vessel: where each one is,
what class it is, what it is carrying and where it is going. Markers are
coloured softly by vessel class, the selected vessel's route is drawn over the
rest, and the panel beside it reads like a bridge report — position in degrees
and minutes, course, speed, IMO and MMSI, call sign, draught, next call, ETA.

**Where the positions come from.** `src/utils/fleet.js` computes them from the
wall clock: each vessel has a route through real sea lanes and a service speed,
so a voyage takes exactly as long as its distance and speed say it does, and the
marker travels at the speed the panel reports. Positions are never stored, so
the fleet is still sailing next year and no two page loads are identical.

This is **not** a live AIS feed — a real one needs a paid provider
(MarineTraffic, Spire, VesselFinder) and a key. `fleet.readFleet()` is the seam
built for that: return `{ vessels, ports, waypoints }` from your provider and
nothing downstream changes. The badge on the chart says "Live positions", not
"AIS", for that reason.

**The time-lapse.** A ship at 20 knots crosses about a thousandth of a pixel per
second on a world chart — honest, and completely invisible. So the chart opens
wound forward, and a segmented control in the header says which clock is
running: **Real time** or **Time-lapse**. Both speeds are on screen, and the
pressed one is the one you are watching, so what you are looking at is never in
doubt. A visitor who has asked their system for reduced motion gets real time.

The chart's coastlines are Natural Earth 110m land data (public domain), built
into `public/assets/map/world.js` by `scripts/build-world-map.js`.

## Tracking

The product, end to end:

1. **The desk books a consignment** at `/admin` and the server mints a tracking
   number — `PMT-2026-4F7K2QX9`. The alphabet is Crockford base32 without I, L, O
   and U, so a number read down a phone line cannot be mistyped into a different
   real consignment. The number is on the paperwork before the cargo moves.
2. **Movements are appended, never overwritten.** Each collection, gate-in,
   transhipment and clearance is a row in `shipment_events` with a time, a place
   and optional coordinates. A trigger rolls the newest public event up onto the
   consignment, so the desk list and the customer's timeline cannot disagree.
3. **Anyone holding the number can read it** at `/?number=…#track` or through
   `GET /api/track/:number`. No account, no sign-in. The response is a deliberate
   projection: no costs, no internal notes, no contact details for the other party.
4. **The desk can keep a note to itself.** An event marked internal is recorded
   for staff, is not published, does not move the consignment, and sends no email.

### Where it is between scans

A tracking event is a fact: somebody or a carrier feed wrote it, with a time and
a place. Between two of them there is nothing, and on an ocean leg "nothing" can
last a fortnight — which is exactly the stretch a customer spends wondering
whether their cargo is moving.

So the tracking result carries a chart: the same coastlines the fleet tracker
draws, framed on the one route, with the recorded scans on the line and a marker
that advances while the page is open.

**The route is water.** `src/utils/searoute.js` turns the fleet's own lane
network — 20 ports and 60 named waypoints from `src/data/fleet.json` — into a
graph and finds the shortest way through it, so a consignment follows Malacca,
Suez, Panama and the Cape like the ships do. The great circle from Shanghai to
Rotterdam crosses Siberia; the routed line comes out at 10,498 nm against a
published 10,500.

**The position is dead reckoning, and says so.** `src/utils/voyage.js` runs from
the last recorded fix along that route at the mode's planned speed. It will not
sail past the destination, and it will not contradict the delivery date the
customer was given: where an estimated delivery exists the marker is paced to
arrive on it, because that date is what they were told and the picture has to
agree with the words. Every real scan replaces the estimate. A consignment with
no coordinates gets no chart rather than an invented one.

The marker is the mode's own silhouette — a cargo ship in plan view, bow-up, so
rotating it to the course turns it rather than flipping it over when it heads
west.

### Statuses

`pending` → `picked_up` → `in_transit` → `at_facility` → `out_for_delivery` →
`delivered`, plus `customs`, `on_hold`, `exception` and `cancelled` off that path.
The public milestone rail is filled from the event history rather than the current
status, so a consignment held in customs still shows that it was collected and
did travel.

### Emails

When a consignment is booked, the shipper and consignee are emailed the tracking
number and a link to it. Every public movement emails the same people. Both are
settings the desk can switch off, and both are silent no-ops until `RESEND_API_KEY`
is set.

## The customer portal (`/portal`)

A customer signs in and sees every consignment of theirs in one place, each with
the same timeline `/track` shows. Two things put a consignment on an account,
and the difference is the whole security model:

- **Claimed.** The customer enters a tracking number and it is added to their
  account. Holding the number is already what public tracking accepts as proof,
  so this grants nothing `/track` did not.
- **Matched.** Consignments carrying the account's email address as shipper or
  consignee appear on their own, with nothing to add.

Matching is only ever applied to an address Supabase has **confirmed**. That is
not a detail:

> **Turn on "Confirm email"** under Authentication → Providers → Email in
> Supabase. With it off every sign-up is auto-confirmed, and anyone could
> register a customer's address to read that customer's consignments. The server
> refuses to match an unconfirmed address, so the portal still works without
> it — but only claiming does, which is the behaviour you want in that case.

The desk can turn the portal off entirely, or leave it on with matching off, in
Settings. Everything the portal returns goes through the same public projection
as `/track`, so it cannot show a field the tracking page would not.

Accounts are ordinary Supabase users. Being on the `admins` table is unrelated:
staff use `/admin`, customers use `/portal`, and neither grants the other.

## The operations desk (`/admin`)

Seven tabs, all behind Supabase password sign-in plus membership of the `admins`
table:

| Tab               | What it does                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| **Consignments**  | Search, book, correct, record movements, open the public page, delete    |
| **Rate requests** | Read a quote request and turn it straight into a booking                 |
| **Enquiries**     | The contact-form inbox, with triage                                      |
| **Applications**  | Job applications, with triage                                            |
| **Live chat**     | Read and answer visitor conversations                                    |
| **Email**         | Mail sent to the company mailbox, as threads, with replies               |
| **Settings**      | Public contact details, email delivery, and how the chat widget behaves  |

Most of the desk reads and writes Supabase directly as the signed-in user, so the
row level security policies decide what is visible. Consignments are the
exception: booking one mints a number and can email the customer, and neither may
happen in the browser, so those routes run on the server and re-check the
caller's session (`src/utils/adminAuth.js`).

Grant someone access by creating their login under Authentication → Users, then
running `supabase/grant-admin.sql` with their address. Revoking is a row delete
and takes effect on their next request.

## Live chat

Preferred path: the visitor signs in anonymously and writes their own rows, so
row level security grants them their own conversation and nothing else. If the
browser cannot reach Supabase, the widget posts to `/api/chat/message` and the
server writes both sides. Either way the conversation appears on the desk.

The widget answers tracking questions itself. Quote a number in a sentence —
"where is PMT-2026-4F7K2QX9?" — and it replies with the live status, the last
scan and the estimated delivery, read from the same public projection the
tracking page uses. Everything else gets a holding reply until a human takes
over, at which point the automatic responder steps aside.

## Project structure

```
public/                 static frontend (built pages + assets)
  css/styles.css        design system: tokens, components, motion
  css/admin.css         the desk
  js/main.js            shared runtime: nav, theme, reveals, tilt, counters, forms
  js/track-view.js      how a consignment is drawn, shared by the console and /portal
  js/track.js           the tracking console and its lookups
  js/portal.js          the customer portal
  js/fleet-map.js       the fleet chart on the home page
  js/consignment-map.js one consignment on the same chart, moving
  assets/map/world.js   coastlines, generated from Natural Earth data
  assets/img/           the uploaded originals, plus the SVG placeholders
  assets/photo/         web-sized crops, derived from the uploads
  assets/fonts/         the three faces, self-hosted
  js/chat.js            live chat, visitor side
  js/admin.js           the desk
  js/supabase-lite.js   a tiny Supabase client (auth + PostgREST over fetch)
src/
  app.js                Express app: pages + API
  api-app.js            API-only app, for the Vercel functions
  site/                 page shell and content, rendered at build time
  routes/               API routers
  controllers/          request handling
  utils/
    tracking.js         tracking numbers, statuses, modes
    fleet.js            where the fleet is, computed from the clock
    places.js           the gazetteer, and what a lane implies
    searoute.js         a way through the sea lanes, rather than over land
    voyage.js           where one consignment is between scans
    shipmentStore.js    consignments, movements and portal claims
    sessionAuth.js      server-side "who is this?" for staff and customers
    storage.js          enquiries, applications, rate requests
    chatStore.js        chat persistence
    siteSettings.js     the settings row, with the environment behind it
    notify.js           email and webhook delivery
supabase/migrations/    the schema, in order
scripts/
  build-pages.js        renders src/site into public/*.html
  make-placeholders.js  regenerates the placeholder artwork
  build-world-map.js    coastlines -> an SVG path the chart draws
  build-brand.py        every brand asset, derived from the one logo file
  build-photos.py       the uploads -> the sized crops the pages serve
  build-fonts.sh        refreshes the self-hosted webfonts
test/                   API, browser and fallback suites
```

## API

Public:

| Method | Route                  | Purpose                                     |
| ------ | ---------------------- | ------------------------------------------- |
| `GET`  | `/api/track/:number`   | Track a consignment                         |
| `POST` | `/api/track`           | The same, with the number in the body       |
| `GET`  | `/api/track/reference` | Statuses, milestones and modes, for labels  |
| `POST` | `/api/quotes`          | Rate request                                |
| `POST` | `/api/contact`         | Enquiry                                     |
| `POST` | `/api/applications`    | Job application                             |
| `GET`  | `/api/services`        | The six services                            |
| `GET`  | `/api/network`         | Hubs, lanes, headline figures, industries   |
| `GET`  | `/api/fleet`           | Every vessel, with its position right now   |
| `GET`  | `/api/places?q=`       | Ports, airports and hubs, for the typeahead |
| `GET`  | `/api/places/lane`     | What a lane implies: mode, distance, transit   |
| `GET`  | `/api/fleet/:id`       | One vessel                                  |
| `GET`  | `/api/careers`         | Open roles                                  |
| `GET`  | `/api/site`            | Public contact details (`?fresh=1` skips the cache) |
| `GET`  | `/api/health`          | What the running server can see (`?probe=1` also checks the schema) |
| `GET`  | `/api/public-config`   | Supabase URL and browser key                |
| `POST` | `/api/chat/message`    | Chat, fallback path                         |
| `POST` | `/api/inbound/resend`  | Signed inbound-mail webhook                 |

Customer, signed in (Bearer token from their own session):

| Method   | Route                            | Purpose                                  |
| -------- | -------------------------------- | ---------------------------------------- |
| `GET`    | `/api/portal/shipments`          | Every consignment on the account         |
| `GET`    | `/api/portal/shipments/:number`  | One of them, with its full timeline      |
| `POST`   | `/api/portal/claims`             | Add one by tracking number               |
| `DELETE` | `/api/portal/claims/:number`     | Take one off the account                 |

Desk only (Bearer token from the signed-in staff session):

| Method   | Route                          | Purpose                          |
| -------- | ------------------------------ | -------------------------------- |
| `GET`    | `/api/shipments`               | List, with `?q=` and `?status=`  |
| `POST`   | `/api/shipments`               | Book one; mints the number       |
| `GET`    | `/api/shipments/:id`           | The full row and its history     |
| `PATCH`  | `/api/shipments/:id`           | Correct the file                 |
| `DELETE` | `/api/shipments/:id`           | Delete it and its history        |
| `GET`    | `/api/shipments/:id/events`    | Every movement, internal included |
| `POST`   | `/api/shipments/:id/events`    | Record a movement                |
| `POST`   | `/api/emails/reply`            | Reply to a mail thread           |

Rate limiting: 240 requests a minute per address across the API, and a separate
30 a minute on `/api/track`, which is what stops the number space being walked.

## Getting started

```bash
npm install
npm run dev      # builds the pages, then runs the server with --watch
```

The site is at <http://localhost:3000>. Without Supabase configured, everything
still works: consignments, enquiries, rate requests and chat are written to
`data/` as JSON, so the whole tracking flow can be driven locally.

Run the suites:

```bash
npm test           # API and storage
npm run test:browser   # the site driven in a real browser (needs playwright-core)
```

## Database

Run the migrations in order, in the Supabase SQL editor. Every file is safe to
run more than once.

| File                  | Adds                                                        |
| --------------------- | ----------------------------------------------------------- |
| `0001_init.sql`       | Admins, enquiries, applications, live chat, site settings    |
| `0002_email.sql`      | The inbound-mail archive (optional)                          |
| `0003_shipments.sql`  | Consignments, movement history, rate requests, `track_shipment()` |
| `0004_settings.sql`   | Email and chat settings on the settings row                  |
| `0005_portal.sql`     | Customer portal: `shipment_claims` and its two settings      |
| `grant-admin.sql`     | Grants one address access to the desk                        |

`GET /api/health?probe=1` reads one row of every column the server uses and names
the migration to run for anything missing.

### Why tracking does not read the tables directly

`shipments` and `shipment_events` have no public read policy at all. A blanket
one would let anyone page through every consignment in the business. Public
lookups go through `GET /api/track/:number`, which matches the whole number
exactly and returns only customer-facing columns. `0003_shipments.sql` also
installs `track_shipment(text)`, a `security definer` function with the same
contract, for a client that would rather call Postgres directly.

## Booking a consignment

The desk types two city names and the form derives the rest.

`src/data/places.json` is a gazetteer of 208 ports, airports and inland hubs
with coordinates, country and LOCODE, served by `GET /api/places`. The origin
and destination boxes query it as they are typed; picking a row fills the
country and both coordinates. The movement form uses the same control, which
matters more than it looks — a movement with coordinates is one the customer can
see on the chart.

`GET /api/places/lane?from=…&to=…` then answers what the lane implies: the mode
this traffic usually books, the routed distance, the course, a transit time. A
strip above the Route section shows it with one button that fills every box
still blank. It never overwrites a box the desk has already filled, and it never
saves — everything it writes is a default in a form somebody still has to read.

Two fields make the mode suggestion trustworthy. `landmass` says what a lorry
can actually reach, so the form stops proposing a drive from Auckland to Sydney.
`coast` splits North America in two, because Shanghai to Los Angeles and
Shanghai to New York are the same crossing on a map and three weeks apart in
practice. Sea distances are factored per basin pair rather than by one number.
The transits that come out sit within a few days of published figures, and
`npm test` checks them against those figures rather than against the formula.

An unknown city answers 200 with `lane: null`. The desk typing a place the
gazetteer does not carry is the form working, not failing.

## Images

Uploads go into `public/assets/img/`, where they stay. They are 1-8 MB PNGs,
which is right for an archive and wrong for a web page, so:

```
python3 scripts/build-photos.py
```

derives every crop the layout asks for into `public/assets/photo/` — a 2400x820
banner per page, a 1200x900 card per service, 1600x1000 figures, the leadership
portrait, and the blurred plate behind every page. 46 MB of source becomes about
3 MB of WebP. The outputs are committed, because the Vercel build image has no
Pillow.

The originals are source files, not pages, so `.vercelignore` drops every `.png`
in `public/assets/img/` from the deploy. `npm run check:vercel` reads the built
HTML, CSS and JS and fails if any page points at a file the deploy would not
carry — so a slot that resolved to an original instead of its derivative is
caught here rather than as a 404 in production.

Which photograph goes where is `scripts/build-photos.py`'s three tables
(`BANNERS`, `CARDS`, `WIDES`) — one line each, and the naming is the slot, not
the subject, so re-pointing a page at a different picture is a one-word edit.

`src/data/images.json` then names the files each slot would rather have and the
placeholder it falls back to, and `src/site/images.js` resolves them at build
time against what is actually on disk. A loose file dropped straight into
`public/assets/img/` under one of the `prefer` names still wins, so the
file-drop workflow survives. The build log says which real files it picked up.

`docs/IMAGES.md` lists every slot with its size and a brief for the artwork.
The placeholders that ship with the site are generated:
`node scripts/make-placeholders.js`.

### Fonts

Archivo, Public Sans and Roboto Mono are served from `public/assets/fonts/` —
six variable-font files, 188 KB, latin and latin-ext. Self-hosted rather than
pulled from Google: a webfont from a third party is a render-blocking request
to a host we do not control. `bash scripts/build-fonts.sh` refreshes the
binaries; the `@font-face` rules are hand-written in `fonts.css`.

## Configuration

Copy `.env.example` to `.env`. Everything is server-side; the browser is handed
the Supabase URL and anon key at runtime from `/api/public-config`, so no value
needs a public prefix and nothing needs rebuilding when a key changes.

The email and chat settings in the database shadow the environment rather than
replacing it: a blank in the settings row means "use `FORM_TO` / `FORM_FROM` /
`MAILBOX_ADDRESS`", so a fresh deployment works before anyone opens the settings
tab, and a value set at the desk wins once it is there.

## Deploying

Vercel: the pages build to `public/` and are served from the CDN; `/api/*` runs
`src/api-app.js` as a function. `vercel.json` carries the rewrite for
`/services/:id`. See `docs/DEPLOYMENT.md`.
