# Merkel Constructions

Corporate website and API server for **Merkel Constructions**, a multidisciplinary
construction and engineering practice. A dependency-light Node/Express backend serves a
multi-page frontend and a small JSON API that powers the content, plus a working
live-chat endpoint.

## Stack

- **Backend:** Node.js + Express (single production dependency)
- **Frontend:** hand-written HTML / CSS / vanilla JS, assembled from shared
  partials by a tiny build step (no framework)
- **Data:** flat JSON files for content; enquiries, chat and inbound mail persisted to
  Supabase (Postgres) in production, or `data/` locally
- **Auth:** Supabase anonymous sign-in for visitors, password sign-in for staff, with
  row level security deciding what each can see
- **Notifications:** enquiries and chat messages routed to an inbox via Resend email
  and/or a webhook (Slack, Discord, help desk)
- **Inbound mail:** a signed Resend webhook archives and forwards mail sent to your domain

## Pages

| URL              | Page                                                    |
| ---------------- | ------------------------------------------------------- |
| `/`              | Landing: six full-height chapters, ending in the enquiry form |
| `/projects`      | Filterable project listing with images                  |
| `/projects/:id`  | Full project page with image, overview and key facts    |
| `/services`      | The eight disciplines, each linking to its own page      |
| `/services/:id`  | One discipline: what it covers, what you get, where it shows |
| `/careers`       | Open roles and studio culture                           |
| `/apply`         | Recruitment form, with the role prefilled from the careers page |
| `/contact`       | Dedicated contact page with image, form and live chat   |
| `/admin`         | Studio desk: enquiries, live chat and studio mail (staff sign-in) |
| `404`            | Styled not-found page                                   |

A live-chat widget is available on every page except the studio desk.

## The landing page

Six chapters, each a full viewport tall with its own photograph, read as one
continuous surface: a single image is fixed behind the whole site and drifts as
you scroll, and every section lays its own artwork and scrim over it. A rail on
the right marks where you are. Section artwork settles into place as its chapter
arrives, reveals inside a chapter arrive in sequence rather than together, and
all of it stops under `prefers-reduced-motion`.

| # | Chapter | Carries |
| - | ------- | ------- |
| 1 | Hero | Slideshow, the two calls to action, and the practice readout |
| 2 | Capabilities | The four disciplines, from `/api/services` |
| 3 | Practice | Counters for the numbers the studio is held to |
| 4 | Leadership | The founding principal |
| 5 | Selected work | Three featured projects, from `/api/projects` |
| 6 | Contact | The enquiry form itself, not a link to one |

The form in chapter 6 is the same component as the one on `/contact`: both post
to `/api/contact`, so both land in `enquiries` and appear on the studio desk.

## Careers and applications

The apply link on `/careers` opens `/apply` with the role already selected, and the
form posts to `/api/applications`. Applications land in the `applications` table and
appear on the studio desk under their own tab, with the same triage states as an
enquiry. A speculative application, with no role chosen, is accepted the same way; a
role that has since closed is refused with a message rather than silently accepted.

## Contact details

The studio address, email, telephone and opening hours live in
`src/data/site.json`, so the pages are built with the right values and are
correct with no JavaScript at all. The studio desk can then change them under
**Settings**, which writes to `site_settings`, and every page picks the change
up on its next load through `/api/site`. No rebuild, no deploy. Anything
carrying `data-site="email"` and friends is hydrated, including the `mailto:`
and `tel:` hrefs, and a database with no `site_settings` table simply keeps the
values the site was built with.

## Live chat

Two halves of one conversation:

- **Visitor.** The widget signs in anonymously and writes its own rows, so row level
  security grants each visitor their own thread and nothing else. Where Supabase is
  not configured or anonymous sign-ins are off, it falls back to `POST /api/chat/message`,
  where the server holds the service role. Either way the conversation persists.
- **Studio.** `/admin` lists every conversation and replies into it. The first human
  reply sets `handled_by_agent`, which takes the thread off the automatic responder so
  the canned answer never talks over a person.

## Project structure

```
.
├── server.js                 # local HTTP server + graceful shutdown
├── vercel.json               # Vercel build, clean URLs, rewrites
├── api/
│   └── [...path].js          # Vercel serverless entry (whole API in one function)
├── scripts/
│   └── build-pages.js        # assembles public/*.html from shared partials
├── docs/
│   └── DEPLOYMENT.md         # fork -> images -> Vercel -> database -> desk -> inbox
├── test/
│   ├── mock-supabase.js      # strict stand-in: PostgREST + GoTrue + the RLS rules
│   ├── api.test.js           # chat, enquiries and the schema probe (no dependencies)
│   ├── browser.test.js       # visitor and staff, end to end in Chromium
│   └── fallback.test.js      # chat with anonymous sign-ins off, and with no database
├── RECIPE.md                 # how to rebuild this stack on another site
├── supabase/
│   ├── migrations/           # 0001_init.sql, 0002_email.sql
│   └── grant-admin.sql       # one-off: make yourself an admin
├── src/
│   ├── app.js                # local Express app: pages + API + static
│   ├── api-app.js            # API-only Express app (used on Vercel)
│   ├── routes/               # API routers, mounted under /api
│   ├── controllers/          # projects, careers, leadership, contact, chat
│   ├── middleware/           # error handling + in-memory rate limiter
│   ├── utils/
│   │   ├── config.js         # env resolution + own-address / loop detection
│   │   ├── supabase.js       # Supabase (PostgREST) client over fetch
│   │   ├── paths.js          # where local file storage writes
│   │   ├── storage.js        # contact-enquiry persistence
│   │   ├── chatStore.js      # per-session chat persistence
│   │   ├── notify.js         # email (Resend) + webhook notifications
│   │   └── webhookSignature.js # Svix-style signature verification
│   ├── data/                 # services / projects / careers / leadership / images
│   └── site/                 # build-time page source (layout.js, pages.js, images.js)
├── public/                   # served frontend (HTML generated by the build)
│   ├── css/                  # styles.css (site) + admin.css (studio desk)
│   ├── js/                   # main, supabase-lite, chat, admin, per-page scripts
│   └── assets/               # brand logos, hero slides, section imagery
└── data/                     # local runtime storage (git-ignored)
```

## API

| Method | Route                     | Description                                   |
| ------ | ------------------------- | --------------------------------------------- |
| GET    | `/api/health`             | Which config the server sees, plus warnings   |
| GET    | `/api/health?probe=1`     | The same, plus one read of every column the server uses |
| GET    | `/api/public-config`      | Supabase URL + anon key for the browser       |
| GET    | `/api/services`           | List engineering disciplines                  |
| GET    | `/api/projects?sector=`   | Project listing, optional sector filter       |
| GET    | `/api/projects/:id`       | Single project + the next project             |
| GET    | `/api/careers?team=`      | Open roles, optional team filter              |
| GET    | `/api/leadership`         | Studio leadership (CEO)                        |
| GET    | `/api/team`               | Studio principals                             |
| POST   | `/api/contact`            | Submit an enquiry (validated + rate-limited)  |
| GET    | `/api/site`               | The studio's contact details, editable from the desk |
| POST   | `/api/applications`       | Submit a job application (validated + rate-limited) |
| POST   | `/api/chat/message`       | Send a chat message, get an auto-reply (fallback path) |
| POST   | `/api/chat/notify`        | Flag a browser-written message and post the holding reply |
| GET    | `/api/chat/:sessionId`    | Fetch a chat conversation                     |
| POST   | `/api/inbound/resend`     | Signed inbound-email webhook (archive + forward) |

`POST /api/contact` accepts `{ name, email, company?, service?, message, website? }`
(`website` is a honeypot); it returns `201`, `422` with a `fields` map, or `429`.

`POST /api/chat/message` accepts `{ sessionId, text }`, stores the message and a reply,
and returns both. `POST /api/chat/notify` is its companion for conversations the browser
writes itself: the message is already in the database, so it only raises the flag by
email and posts the holding reply. The responder in `src/controllers/chatController.js`
is rule-based and stands down the moment a person answers from `/admin`; it is the seam
where a third-party desk would take over instead.

## Getting started

```bash
npm install
cp .env.example .env   # optional: adjust PORT, rate limits, notify email
npm run build          # generate public/*.html from src/site (also runs on start)
npm start              # http://localhost:3000
npm run dev            # build + watch mode
npm test               # API, chat and schema checks against a mock Supabase
```

`npm test` needs nothing beyond Node: `test/mock-supabase.js` stands in for PostgREST,
GoTrue and the row level security rules, and rejects a column that is not in the
schema, so code and migrations cannot drift apart unnoticed.

The end-to-end suites drive a real browser and need Playwright's Chromium:

```bash
npm install --no-save playwright-core   # plus a Chromium build
npm run test:browser                    # CHROME_PATH=... if it is not on the default path
```

## Frontend notes

- Pages share one layout (`src/site/layout.js`) rendered to static HTML at build
  time, so the nav, footer and chat widget stay consistent with no client-side flash.
- The site is light: off-white ground, ink type, one signal blue. Photography runs
  at full strength, and where words sit over a picture the ground fades in behind
  them rather than a dark sheet being laid over the picture. `--bg-rgb` is the one
  token every one of those washes reads from, so the whole site's brightness is a
  single edit.
- The home hero runs a **photographic slideshow** (crossfade plus a slow Ken Burns
  zoom) with clickable indicators; motion drops under `prefers-reduced-motion`.
- Projects, careers and leadership content are rendered from the API, with embedded
  seed data as a fallback so pages never render empty.
- The brand wordmark is a transparent PNG keyed from the supplied logo card, with
  the navy in the mark preserved by un-premultiplying it off the paper colour
  rather than flattening every ink pixel to black.
- Headings reveal with transform and opacity, never a `clip-path` wipe: clipping a
  heading to nothing leaves it with no rendered area, and IntersectionObserver then
  never reports it visible, so the reveal never fires. A browser test asserts every
  `[data-reveal]` on the landing page ends up visible.
- Section and project imagery lives in `public/assets/img/` as blueprint-style SVGs;
  swap these for real photography when available.

## Deploying

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full walkthrough: replacing the
placeholder imagery, forking, deploying to Vercel, connecting a free Supabase database,
and routing enquiries and chat to your inbox.

The repo is Vercel-ready: `vercel.json` builds the static pages into `public/` and
`api/[...path].js` runs the Express API as a single serverless function.

## Notifications

Contact enquiries and live-chat messages are both routed to a human inbox by
`src/utils/notify.js`. Two independent channels, each a no-op until configured:

- **Email** via [Resend](https://resend.com): set `RESEND_API_KEY`, `FORM_TO` and `FORM_FROM`.
  Enquiry mail sets `reply_to` to the sender so replies reach the client directly.
- **Webhook** for a desk provider: set `NOTIFY_WEBHOOK_URL` (Slack, Discord, Zapier, help desk).

Inbound mail is handled by `POST /api/inbound/resend`. Requests must carry a valid
Svix-style signature (`RESEND_WEBHOOK_SECRET`); unsigned, tampered or replayed requests
get a `401`. Verified mail addressed to `MAILBOX_ADDRESS` is filed onto a thread in
`email_threads` / `email_messages` and forwarded to `FORWARD_TO`, unless that address
(or the sender) is one of this site's own, which would loop mail back into the webhook.

Delivery is best effort and is awaited before responding, so a serverless invocation
never exits early. A notification failure is logged and never fails the visitor's
request. Set `CHAT_NOTIFY=off` to silence chat notifications while keeping enquiries.

## Storage

**Supabase** when `SUPABASE_URL` (or `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`)
and `SUPABASE_SERVICE_ROLE_KEY` are set; **local JSON files** under `DATA_DIR`
otherwise, so development works offline with no setup.

Tables are `admins`, `enquiries`, `applications`, `chat_sessions`, `chat_messages`
and, optionally, `email_threads` / `email_messages`. Create them by running
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) (and
[`0002_email.sql`](supabase/migrations/0002_email.sql)) in the Supabase SQL Editor.
Both are guarded, so re-running one after an edit updates what changed.

Row level security is on everywhere. `enquiries` has no anon policy at all: writes
arrive through `POST /api/contact` using the `service_role` key. Chat is the one thing
the browser writes directly, under the visitor's anonymous `auth.uid()`, and staff read
and answer under their own login checked against `admins`. Keep the `service_role` key
server side and never behind a `VITE_` or `NEXT_PUBLIC_` prefix, which are inlined into
browser bundles; the `anon` key is meant to be public.

`GET /api/health?probe=1` reads one row of every column the server uses and names
anything missing, which is the quickest way to catch tables built from an older copy of
a migration.

Vercel is serverless with a read-only filesystem, so production needs the database:
without it, writes go to `/tmp` and do not survive between requests.

## Images

Page-level artwork is a file drop, not a code change: put `merkel1` to `merkel5`
into `public/assets/img/` (any of `.webp`, `.avif`, `.jpg`, `.jpeg`, `.png`) and the
next build uses them. Names are matched without regard to case, and `.webp` wins
when both a PNG and a WebP of the same name are present, so adding an optimised
copy beside a heavy original is enough to serve it. `merkel1` becomes the underlay behind every page; the rest
take a chapter each.

`src/data/images.json` holds the mapping, where every slot names the file it prefers
and the placeholder it falls back on, and `src/site/images.js` resolves them at build
time. So the site never shows a broken image while artwork is still being collected,
and the build prints which real files it picked up. Per-project images live in
`src/data/projects.json` and the CEO portrait in `src/data/leadership.json`. See the
table in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#step-1-add-your-images).

## Configuration

| Variable                | Default | Purpose                                     |
| ----------------------- | ------- | ------------------------------------------- |
| `PORT`                  | `3000`  | HTTP port                                   |
| `NODE_ENV`              | none    | `production` tightens error output          |
| `CONTACT_NOTIFY_EMAIL`  | none    | Integration point for enquiry notifications |
| `RATE_LIMIT_WINDOW_MS`  | `60000` | Rate-limit window                           |
| `RATE_LIMIT_MAX`        | `30`    | Max requests per window per IP              |
| `SUPABASE_URL`          | none    | Supabase project URL                        |
| `SUPABASE_ANON_KEY`     | none    | Public key handed to the browser for chat and `/admin` |
| `SUPABASE_SERVICE_ROLE_KEY` | none | Secret key, server side only                |
