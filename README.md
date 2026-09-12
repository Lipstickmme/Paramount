# Paramount Logistics

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
| `/`             | Landing page, with the tracking console in the hero                 |
| `/track`        | Full tracking: timeline, route map, milestones and consignment facts |
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
3. **Anyone holding the number can read it** at `/track?number=…` or through
   `GET /api/track/:number`. No account, no sign-in. The response is a deliberate
   projection: no costs, no internal notes, no contact details for the other party.
4. **The desk can keep a note to itself.** An event marked internal is recorded
   for staff, is not published, does not move the consignment, and sends no email.

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
  js/track-view.js      how a consignment is drawn, shared by /track and /portal
  js/track.js           the tracking console and its lookups
  js/portal.js          the customer portal
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

## Images

Every image is a slot. `src/data/images.json` names the files each slot would
rather have and the placeholder it uses until one exists, so adding real
photography is a file drop rather than a code change: put `hero-1.jpg`,
`service-air.jpg`, `paramount-about.webp` and so on into `public/assets/img/` and
rebuild. The build log says which real files it picked up.

The placeholders that ship with the site are generated:
`node scripts/make-placeholders.js`.

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
