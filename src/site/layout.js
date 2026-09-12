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
 * The tracking console.
 *
 * Shared, because it is the point of the site: it sits in the landing page hero
 * and again at the top of /track.
 *
 * `compact` leaves out the result container. The hero column is too narrow to
 * read a timeline and a map in, so the console there hands the number to
 * /track, which is also the page worth linking to from an email.
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
              Track <span class="arw">&rsaquo;</span>
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
        <button type="submit" class="btn" data-submit>Send enquiry <span class="arw">&rsaquo;</span></button>
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
  <meta name="theme-color" content="#04070f" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${images.og}" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
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

function nav(active = '') {
  const link = (href, label, key) =>
    `<a href="${href}"${key === active ? ' class="is-active"' : ''}>${label}</a>`;
  return `
  <header class="nav" id="nav">
    <a class="brand" href="/" aria-label="Paramount Logistics home">
      <img class="brand-logo on-dark" src="/assets/brand/paramount-wordmark.svg" alt="Paramount Logistics" width="520" height="96" />
      <img class="brand-logo on-light" src="/assets/brand/paramount-wordmark-dark.svg" alt="Paramount Logistics" width="520" height="96" />
    </a>
    <nav class="nav-links" id="navlinks">
      ${link('/track', 'Track', 'track')}
      ${link('/services', 'Services', 'services')}
      ${link('/network', 'Network', 'network')}
      ${link('/about', 'About', 'about')}
      ${link('/careers', 'Careers', 'careers')}
      ${link('/contact', 'Contact', 'contact')}
    </nav>
    <div class="nav-end">
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch between light and dark">
        <svg class="i-moon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        <svg class="i-sun" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
      <a href="/quote" class="btn sm nav-cta">Get a quote <span class="arw">&rsaquo;</span></a>
      <button class="nav-toggle" id="navtoggle" aria-label="Open menu" aria-expanded="false" aria-controls="navlinks">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>`;
}

function footer() {
  return `
  <footer class="footer">
    <div class="wrap footer-top">
      <div class="footer-brand">
        <img class="brand-logo on-dark" src="/assets/brand/paramount-wordmark.svg" alt="Paramount Logistics" width="520" height="96" />
        <img class="brand-logo on-light" src="/assets/brand/paramount-wordmark-dark.svg" alt="Paramount Logistics" width="520" height="96" />
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
        <a href="/track">Track a consignment</a>
        <a href="mailto:${esc(site.email)}" data-site="email">${esc(site.email)}</a>
        <a href="tel:${esc(site.support_phone).replace(/\s+/g, '')}" data-site="support_phone">${esc(site.support_phone)}</a>
        <span data-site="hours">${esc(site.hours)}</span>
      </div>
    </div>
    <div class="wrap footer-bottom">
      <span>&copy; ${YEAR} Paramount Logistics B.V. All rights reserved.</span>
      <span class="mono">Control tower staffed 24/7</span>
    </div>
  </footer>`;
}

function chatWidget() {
  return `
  <div class="chat" id="chat" aria-live="polite">
    <button class="chat-toggle" id="chat-toggle" aria-label="Open live chat" aria-expanded="false">
      <svg class="i-open" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg>
      <svg class="i-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <div class="chat-panel" id="chat-panel" hidden>
      <div class="chat-head">
        <div class="chat-head-id">
          <span class="dot"></span>
          <div>
            <strong data-chat-agent>Paramount Control</strong>
            <small>Quote a tracking number for a live answer</small>
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
    scripts(['/js/main.js', '/js/track.js', '/js/supabase-lite.js', '/js/chat.js', ...extraScripts]),
  ].join('\n');
}

module.exports = { page, nav, footer, chatWidget, head, contactForm, tracker, underlay, esc, YEAR };
