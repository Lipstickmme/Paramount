'use strict';

/**
 * Shared page shell. Pages supply their own <main>; this module wraps it with
 * the head, nav, footer and chat widget so every page stays consistent.
 *
 * Rendered at build time (scripts/build-pages.js) into static HTML, so the site
 * is correct before a single byte of JavaScript runs: the pages carry their own
 * content, and the scripts only add motion, the tracking console and the live
 * values the desk can change.
 */

const images = require('./images');
const site = require('../data/site.json');

const YEAR = new Date().getFullYear();

/**
 * The icon set.
 *
 * Drawn on a 24-unit grid in a single stroke weight so they sit together, and
 * chosen from the trade rather than from a generic UI kit: a container, an
 * anchor, a life ring, a radar sweep. They inherit colour, so a theme swap
 * needs nothing here.
 */
const icons = {
  search:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  compass:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2 5.2-5.2 2 2-5.2z"/></svg>',
  radar:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/><path d="M12 12l6-4.4"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>',
  container:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="1.2"/><path d="M7.5 7v10M12 7v10M16.5 7v10"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  anchor:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21M8 11h8M4 15a8 8 0 0 0 16 0"/></svg>',
  crew:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  buoy:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M6 6l3.6 3.6M18 6l-3.6 3.6M6 18l3.6-3.6M18 18l-3.6-3.6"/></svg>',
  clipboard:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M9 4h6v3H9z"/><path d="M15 5.5h2.5A1.5 1.5 0 0 1 19 7v12.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V7a1.5 1.5 0 0 1 1.5-1.5H9"/><path d="M8.5 12h7M8.5 16h4.5"/></svg>',
  tag:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12.6 3H21v8.4L11.4 21 3 12.6z"/><circle cx="17" cy="7" r="1.4"/></svg>',
  /* The chat launcher: a headset, because the person behind it is the point. */
  support:
    '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><path d="M4 13h1.8A1.2 1.2 0 0 1 7 14.2v3.6A1.2 1.2 0 0 1 5.8 19H5a1 1 0 0 1-1-1z"/><path d="M20 13h-1.8a1.2 1.2 0 0 0-1.2 1.2v3.6a1.2 1.2 0 0 0 1.2 1.2H19a1 1 0 0 0 1-1z"/><path d="M18 19v.4a2.6 2.6 0 0 1-2.6 2.6H13"/></svg>',
  ship:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 17l1.6-5.2a1 1 0 0 1 .96-.7H18.4a1 1 0 0 1 .96.7L21 17"/><path d="M6 11V7h6l2 4"/><path d="M12 4v3"/><path d="M2.6 17.4c1.6 0 1.6 1.6 3.2 1.6s1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6"/></svg>',
};


const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

/**
 * The plate behind every page, fixed to the viewport so the whole site reads as
 * one continuous surface rather than a stack of separate screens.
 */
function underlay() {
  return `
  <div class="underlay" aria-hidden="true">
    <div class="underlay-img" style="background-image:url('${images.underlay}')"></div>
    <div class="underlay-grid"></div>
    <div class="underlay-scrim"></div>
  </div>`;
}

/**
 * The slim photographic band every page opens on.
 *
 * One height across the whole site (set in CSS, not here), one scrim, one
 * picture per page. `slot` picks the photograph — src/data/images.json maps the
 * slots, so swapping a page's picture is a file drop, not an edit here.
 *
 * The picture is a background rather than an <img> because it is decoration: it
 * carries no information a screen reader needs, and a background can be
 * cropped by the box rather than by a wrapper.
 */
function banner({ slot, crumbs = '', kicker = '', title, lede = '', actions = '', aside = '', className = '' }) {
  const words = `
        ${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}
        ${kicker ? `<span class="eyebrow">${kicker}</span>` : ''}
        <h1>${title}</h1>
        ${lede ? `<p class="lede">${lede}</p>` : ''}
        ${actions ? `<div class="hero-actions">${actions}</div>` : ''}`;

  return `
    <section class="banner on-photo${className ? ` ${className}` : ''}">
      <div class="banner-img" aria-hidden="true" style="background-image:url('${images.forBanner(slot)}')"></div>
      <div class="banner-scrim" aria-hidden="true"></div>
      <div class="wrap banner-inner">
        ${aside
          ? `<div class="banner-home-grid"><div class="banner-words">${words}</div>${aside}</div>`
          : words}
      </div>
    </section>`;
}

/**
 * The tracking console.
 *
 * Shared, because it is the point of the site: the landing page carries it
 * with its result panel, and the header carries a cut-down copy on every page.
 *
 * `compact` leaves out the result container. A console with nowhere to show a
 * result — the one in the header — hands the number to the landing page, which
 * is also the link worth putting in an email.
 */
function tracker({ id = 'tracker', autofocus = false, compact = false } = {}) {
  return `
      <div class="tracker" id="${id}" data-tracker data-reveal>
        <div class="tracker-head">
          <h2>Track a consignment</h2>
          <span class="pill"><span class="dot"></span>Live</span>
        </div>
        <form class="tracker-form" data-track-form novalidate>
          <div class="tracker-input">
            <label class="sr-only" for="${id}-number">Tracking number</label>
            <input
              type="text"
              id="${id}-number"
              name="number"
              inputmode="latin"
              autocomplete="off"
              spellcheck="false"
              maxlength="32"
              placeholder="e.g. PMT-${YEAR}-4F7K2QX9"
              ${autofocus ? 'autofocus' : ''}
              required />
            <button type="submit" class="btn" data-track-submit>
              Track ${icons.arrow}
            </button>
          </div>
          <div class="tracker-hint">
            <span>Air, ocean, road, rail and express all share one number.</span>
            <span class="tracker-recent" data-track-recent hidden></span>
          </div>
          <div class="err" data-track-error role="alert"></div>
        </form>
      </div>
      ${compact ? '' : '<div class="result" id="track-result" data-track-result hidden></div>'}`;
}

/**
 * The enquiry form. Shared so the landing page and /contact behave identically:
 * both POST to /api/contact, which writes the enquiry and raises it with the
 * desk, and both appear at /admin.
 */
function contactForm(id = 'contact-form') {
  return `
      <form id="${id}" data-contact-form novalidate data-reveal>
        <div class="field two">
          <div class="field"><label for="${id}-name">Name</label><input type="text" id="${id}-name" name="name" autocomplete="name" required /><div class="err" data-err="name"></div></div>
          <div class="field"><label for="${id}-email">Email</label><input type="email" id="${id}-email" name="email" autocomplete="email" required /><div class="err" data-err="email"></div></div>
        </div>
        <div class="field two">
          <div class="field"><label for="${id}-company">Company <span class="opt">(optional)</span></label><input type="text" id="${id}-company" name="company" autocomplete="organization" /><div class="err" data-err="company"></div></div>
          <div class="field"><label for="${id}-service">What do you need?</label>
            <select id="${id}-service" name="service">
              <option value="">Select</option>
              <option>Air freight</option>
              <option>Ocean freight</option>
              <option>Road haulage</option>
              <option>Rail freight</option>
              <option>Express courier</option>
              <option>Warehousing &amp; fulfilment</option>
              <option>Customs &amp; compliance</option>
              <option>An existing consignment</option>
            </select><div class="err" data-err="service"></div>
          </div>
        </div>
        <div class="field"><label for="${id}-message">How can we help?</label><textarea id="${id}-message" name="message" placeholder="Tell us the lane, the cargo and when it needs to land." required></textarea><div class="err" data-err="message"></div></div>
        <div class="honeypot" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
        <div class="form-status" data-form-status role="status" aria-live="polite"></div>
        <button type="submit" class="btn" data-submit>Send enquiry ${icons.arrow}</button>
      </form>`;
}

function head({ title, description, noindex = false, styles = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />${noindex ? '\n  <meta name="robots" content="noindex, nofollow" />' : ''}
  <meta name="theme-color" content="#0c1f3d" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Paramount Shipping" />
  <meta property="og:image" content="/assets/brand/paramount-og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="/assets/brand/paramount-og.png" />
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
  <link rel="icon" href="/favicon.png" sizes="64x64" type="image/png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="preload" href="/assets/fonts/public-sans.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/assets/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="/assets/fonts/fonts.css" />
  <link rel="stylesheet" href="/css/styles.css" />
  ${styles.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n  ')}
  <script>
    /* Applied before first paint so a reload never flashes the wrong theme. */
    (function () {
      try {
        var t = localStorage.getItem('pm-theme');
        if (t) document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    })();
  </script>
  <noscript>
    <!-- Reveals are opacity:0 until the observer reaches them. Without a
         script there is no observer, and the page would be blank. -->
    <style>[data-reveal] { opacity: 1 !important; transform: none !important; }</style>
  </noscript>
</head>`;
}

/**
 * The wordmark, in whichever colourway the theme calls for.
 *
 * The emblem is navy line-work on transparency, so it needs a light-ink twin
 * for the dark theme. WebP first: the artwork is full of soft shading, which
 * PNG stores at three times the size.
 */
function mark(className = 'brand-logo') {
  return `
      <picture class="${className} on-dark">
        <source srcset="/assets/brand/paramount-mark-light.webp" type="image/webp" />
        <img src="/assets/brand/paramount-mark-light.png" alt="" width="360" height="124" />
      </picture>
      <picture class="${className} on-light">
        <source srcset="/assets/brand/paramount-mark.webp" type="image/webp" />
        <img src="/assets/brand/paramount-mark.png" alt="" width="360" height="124" />
      </picture>`;
}

function logo(className = 'brand-logo') {
  return `
      <picture class="${className} on-dark">
        <source srcset="/assets/brand/paramount-logo-light.webp" type="image/webp" />
        <img src="/assets/brand/paramount-logo-light.png" alt="Paramount Shipping" width="560" height="383" />
      </picture>
      <picture class="${className} on-light">
        <source srcset="/assets/brand/paramount-logo.webp" type="image/webp" />
        <img src="/assets/brand/paramount-logo.png" alt="Paramount Shipping" width="560" height="383" />
      </picture>`;
}

/**
 * The header, and the drawer it opens.
 *
 * The menu is a left-hand drawer rather than a row of links, which leaves the
 * header to do the one thing visitors come here for: the tracking box sits in
 * it, on every page, lit just enough to find without shouting.
 */
function nav(active = '') {
  const link = (href, label, key, icon) => `
        <a href="${href}"${key === active ? ' class="is-active" aria-current="page"' : ''}>
          <span class="drawer-icon">${icon}</span>${label}
        </a>`;

  return `
  <header class="nav" id="nav">
    <button class="nav-menu" id="navtoggle" aria-label="Open the menu" aria-expanded="false" aria-controls="drawer">
      <span class="nav-menu-bars" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="nav-menu-word">Menu</span>
    </button>

    <a class="brand" href="/" aria-label="Paramount Shipping home">${mark()}
      <span class="brand-name"><b>PARAMOUNT</b><span>SHIPPING</span></span>
    </a>

    <form class="nav-track" data-track-form role="search" novalidate>
      <span class="nav-track-icon">${icons.search}</span>
      <label class="sr-only" for="nav-track-number">Tracking number</label>
      <input type="text" id="nav-track-number" name="number" autocomplete="off" spellcheck="false"
             maxlength="32" placeholder="Track a consignment — PMT-${YEAR}-4F7K2QX9" />
      <button type="submit" class="nav-track-go" data-track-submit aria-label="Track">
        ${icons.arrow}
      </button>
      <span class="err sr-only" data-track-error role="alert"></span>
      <span class="sr-only" data-track-recent hidden></span>
    </form>

    <div class="nav-end">
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch between light and dark">
        <svg class="i-moon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        <svg class="i-sun" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
      <a href="/portal" class="nav-portal${active === 'portal' ? ' is-active' : ''}">Sign in</a>
      <a href="/quote" class="btn sm nav-cta">Get a quote</a>
    </div>
  </header>

  <div class="drawer-scrim" id="drawer-scrim" hidden></div>
  <aside class="drawer" id="drawer" aria-label="Site menu" aria-hidden="true">
    <div class="drawer-head">
      <a class="brand" href="/" aria-label="Paramount Shipping home">${logo('brand-logo drawer-logo')}
      </a>
      <button class="drawer-close" id="drawer-close" type="button" aria-label="Close the menu">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>

    <nav class="drawer-links">
      ${link('/', 'Home', 'home', icons.compass)}
      ${link('/#track', 'Track a consignment', 'track', icons.radar)}
      ${link('/services', 'Services', 'services', icons.container)}
      ${link('/network', 'Global network', 'network', icons.globe)}
      ${link('/about', 'About us', 'about', icons.anchor)}
      ${link('/careers', 'Careers', 'careers', icons.crew)}
      ${link('/contact', 'Contact', 'contact', icons.buoy)}
    </nav>

    <div class="drawer-split"></div>

    <nav class="drawer-links secondary">
      ${link('/portal', 'My consignments', 'portal', icons.clipboard)}
      ${link('/quote', 'Request a quote', 'quote', icons.tag)}
    </nav>

    <div class="drawer-foot">
      <span class="eyebrow">Control tower</span>
      <a class="drawer-call" href="mailto:${esc(site.email)}" data-site="email">${esc(site.email)}</a>
      <p class="muted">Staffed 24/7, every day of the year.</p>
    </div>
  </aside>`;
}

function footer() {
  return `
  <footer class="footer">
    <div class="wrap footer-top">
      <div class="footer-brand">${logo('brand-logo footer-logo')}
        <p>${esc(site.tagline)}</p>
      </div>
      <div class="col">
        <h5>Move freight</h5>
        <a href="/services/air-freight">Air freight</a>
        <a href="/services/ocean-freight">Ocean freight</a>
        <a href="/services/road-haulage">Road haulage</a>
        <a href="/services/rail-freight">Rail freight</a>
        <a href="/services/warehousing">Warehousing</a>
      </div>
      <div class="col">
        <h5>Company</h5>
        <a href="/about">About us</a>
        <a href="/network">Global network</a>
        <a href="/careers">Careers</a>
        <a href="/quote">Request a quote</a>
        <a href="/contact">Contact</a>
      </div>
      <div class="col">
        <h5>Support</h5>
        <a href="/#track">Track a consignment</a>
        <a href="/portal">Customer portal</a>
        <a href="mailto:${esc(site.email)}" data-site="email">${esc(site.email)}</a>
        <span data-site="hours">${esc(site.hours)}</span>
      </div>
    </div>
    <div class="wrap footer-bottom">
      <span>&copy; ${YEAR} Paramount Shipping B.V. All rights reserved.</span>
      <span class="mono">Control tower staffed 24/7</span>
    </div>
  </footer>`;
}

function chatWidget() {
  return `
  <div class="chat" id="chat" aria-live="polite">
    <button class="chat-toggle" id="chat-toggle" aria-label="Talk to customer care" aria-expanded="false">
      <span class="i-open">${icons.support}</span>
      <svg class="i-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
      <span class="chat-ping" aria-hidden="true"></span>
    </button>
    <span class="chat-label" aria-hidden="true">Customer care</span>
    <div class="chat-panel" id="chat-panel" hidden>
      <div class="chat-head">
        <div class="chat-head-id">
          <span class="chat-avatar">${icons.support}</span>
          <div>
            <strong data-chat-agent>Customer care</strong>
            <small><span class="dot"></span>Quote a tracking number for a live answer</small>
          </div>
        </div>
        <button class="chat-min" id="chat-min" aria-label="Minimise chat">&minus;</button>
      </div>
      <div class="chat-log" id="chat-log"></div>
      <form class="chat-form" id="chat-form">
        <input type="text" id="chat-input" name="text" placeholder="Ask about a shipment, lane or rate" autocomplete="off" maxlength="2000" />
        <button type="submit" aria-label="Send message">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </form>
    </div>
  </div>`;
}

/**
 * Script tags. An entry may be a path, or `{ src, type }` when it needs to load
 * as a module (the admin dashboard imports a client).
 */
function scripts(list) {
  const tags = list
    .map((s) => (typeof s === 'string' ? { src: s } : s))
    .map(({ src, type }) => `<script${type ? ` type="${type}"` : ''} src="${src}"></script>`)
    .join('\n  ');
  return `  ${tags}\n</body>\n</html>`;
}

/**
 * Compose a full page.
 *
 * `bare` pages get the same shell styling but none of the site furniture: no
 * nav, no footer, no chat widget. The desk dashboard is one, since a member of
 * staff answering the chat should not also be offered it.
 */
function page(opts) {
  const { active = '', bodyClass = '', content = '', extraScripts = [], bare = false } = opts;
  if (bare) {
    return [head(opts), `<body class="${bodyClass}">`, content, scripts(extraScripts)].join('\n');
  }
  return [
    head(opts),
    `<body class="${bodyClass}">`,
    '  <a class="skip" href="#main">Skip to content</a>',
    '  <div class="scroll-progress" id="progress"></div>',
    underlay(),
    nav(active),
    content,
    footer(),
    chatWidget(),
    scripts([
      '/js/main.js',
      '/js/track-view.js',
      '/js/track.js',
      '/js/supabase-lite.js',
      '/js/chat.js',
      ...extraScripts,
    ]),
  ].join('\n');
}

module.exports = { page, nav, footer, chatWidget, head, contactForm, tracker, banner, underlay, logo, mark, icons, esc, YEAR };
