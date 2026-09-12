'use strict';

/**
 * Every page's content, as data.
 *
 * One module per site rather than one file per page: the pages share so much
 * furniture (section heads, card grids, the tracking console) that keeping them
 * together is what stops them drifting apart. scripts/build-pages.js renders
 * each entry through src/site/layout.js into public/*.html.
 */

const { contactForm, tracker, esc, YEAR } = require('./layout');
const images = require('./images');

const site = require('../data/site.json');
const services = require('../data/services.json');
const network = require('../data/network.json');
const industries = require('../data/industries.json');
const careers = require('../data/careers.json');
const leadership = require('../data/leadership.json');

const BRAND = 'Paramount Logistics';

/**
 * A headline figure, written into the HTML as its final value.
 *
 * The counters animate from zero, but the number has to be right before any
 * script runs — for a reader without JavaScript, and for anything reading the
 * page rather than viewing it. main.js zeroes them only when it is about to
 * animate, and lands on this same string.
 */
const figure = (value, suffix = '') => Number(value).toLocaleString('en-US') + suffix;

/* ------------------------------------------------------------- fragments --- */

const icon = {
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  flask: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3h6M10 3v6L4.5 18A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 9V3"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4h2l2.4 11.2A2 2 0 0 0 9.4 17h7.7a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20c8 2 16-4 16-16-10 0-16 4-16 12 0 2 0 3 0 4zM9 15l7-7"/></svg>',
  chip: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/></svg>',
};

const check = (text) => `<li>${icon.check}<span>${text}</span></li>`;

/** A section head: eyebrow, title, and an optional line of standfirst. */
function head({ kicker, title, lede, aside, split = false }) {
  return `
      <div class="section-head${split ? ' split' : ''}" data-reveal>
        <div>
          ${kicker ? `<span class="eyebrow">${kicker}</span>` : ''}
          <h2${kicker ? ' style="margin-top:14px"' : ''}>${title}</h2>
          ${lede ? `<p class="lede" style="margin-top:16px">${lede}</p>` : ''}
        </div>
        ${aside ? `<div>${aside}</div>` : ''}
      </div>`;
}

/** A service card, used on the home page and on /services. */
function serviceCard(svc, i) {
  return `
        <article class="card tilt svc-card" data-tilt data-reveal style="--delay:${i * 70}ms">
          <div class="svc-media">
            <img src="${images.forService(svc.id)}" alt="" loading="lazy" width="1200" height="900" />
          </div>
          <span class="code">${svc.code}</span>
          <h3>${esc(svc.title)}</h3>
          <p class="tagline">${esc(svc.tagline)}</p>
          <p>${esc(svc.summary)}</p>
          <ul>${svc.capabilities.slice(0, 4).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          <a class="link" href="/services/${svc.id}">Explore ${esc(svc.title.toLowerCase())} <span class="arw">&rsaquo;</span></a>
        </article>`;
}

/** The world map on /network and the home page, drawn from hub coordinates. */
function worldMap() {
  // Equirectangular, cropped to the band the hubs actually occupy. A full
  // -180..180 / -90..90 plate would leave them huddled in the middle of an
  // empty rectangle; fitting the extent spreads them across the plate and
  // keeps the relative geography honest.
  const W = 1000;
  const H = 460;
  const pad = 64;
  const lats = network.hubs.map((h) => Number(h.lat));
  const lngs = network.hubs.map((h) => Number(h.lng));
  const minLng = Math.min(...lngs) - 12;
  const maxLng = Math.max(...lngs) + 12;
  const minLat = Math.min(...lats) - 10;
  const maxLat = Math.max(...lats) + 10;
  const x = (lng) => pad + ((Number(lng) - minLng) / (maxLng - minLng)) * (W - pad * 2);
  const y = (lat) => pad + ((maxLat - Number(lat)) / (maxLat - minLat)) * (H - pad * 2);
  const byId = Object.fromEntries(network.hubs.map((h) => [h.id, h]));

  // A graticule at whole tens of degrees, so the plate reads as a map.
  const graticule = [];
  for (let lat = Math.ceil(minLat / 20) * 20; lat <= maxLat; lat += 20) {
    graticule.push(`<line x1="${pad}" y1="${y(lat).toFixed(1)}" x2="${W - pad}" y2="${y(lat).toFixed(1)}" stroke="var(--line)" stroke-width="1" />`);
  }
  for (let lng = Math.ceil(minLng / 30) * 30; lng <= maxLng; lng += 30) {
    graticule.push(`<line x1="${x(lng).toFixed(1)}" y1="${pad}" x2="${x(lng).toFixed(1)}" y2="${H - pad}" stroke="var(--line)" stroke-width="1" />`);
  }

  const lanes = network.lanes
    .map((lane) => {
      const a = byId[lane.from];
      const b = byId[lane.to];
      if (!a || !b) return '';
      const x1 = x(a.lng);
      const y1 = y(a.lat);
      const x2 = x(b.lng);
      const y2 = y(b.lat);
      // Bow every lane the same way so crossing routes stay readable.
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.22 - 18;
      return `<path class="dash" d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"
        fill="none" stroke="url(#lane)" stroke-width="1.6" opacity=".85"><title>${esc(lane.label)} · ${esc(lane.transit)}</title></path>`;
    })
    .join('\n        ');

  // Hubs in the same neighbourhood would print their codes on top of each
  // other — Rotterdam and Hamburg are 500km apart and all but touching at this
  // scale — so a label is placed below its dot unless something already sits
  // there, in which case it goes above.
  const placed = [];
  const labelOffset = (cx, cy) => {
    for (const side of [19, -13]) {
      const ly = cy + side;
      const clash = placed.some((p) => Math.abs(p.x - cx) < 54 && Math.abs(p.y - ly) < 26);
      if (!clash) {
        placed.push({ x: cx, y: ly });
        return side;
      }
    }
    // Both sides are taken: stack further out rather than printing on top.
    const ly = cy + 40;
    placed.push({ x: cx, y: ly });
    return 40;
  };

  const dots = network.hubs
    .map((h) => {
      const cx = x(h.lng);
      const cy = y(h.lat);
      const dy = labelOffset(cx, cy);
      return `<g><circle class="hub-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="var(--accent-2)">
          <title>${esc(h.city)} (${esc(h.code)}) — ${esc(h.role)}</title>
        </circle>
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="none" stroke="var(--accent-2)" stroke-width="1.2" opacity=".5">
          <animate attributeName="r" values="5.5;16" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values=".5;0" dur="2.6s" repeatCount="indefinite" />
        </circle>
        <text x="${cx.toFixed(1)}" y="${(cy + dy).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="var(--ink-3)">${esc(h.code)}</text>
        <text x="${cx.toFixed(1)}" y="${(cy + dy + (dy < 0 ? -13 : 13)).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10.5" fill="var(--ink-3)" opacity=".62">${esc(h.city)}</text></g>`;
    })
    .join('\n        ');

  return `
      <div class="network-map" data-reveal>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Paramount hubs and trade lanes">
          <defs>
            <linearGradient id="lane" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="var(--accent)" />
              <stop offset="1" stop-color="var(--accent-3)" />
            </linearGradient>
            <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1.4" cy="1.4" r="1.1" fill="currentColor" opacity=".13" />
            </pattern>
          </defs>
          <rect width="${W}" height="${H}" fill="url(#dots)" color="var(--ink-2)" />
          <g opacity=".55">${graticule.join('')}</g>
          ${lanes}
          ${dots}
        </svg>
        <div class="map-legend">
          <span><i style="background:var(--accent-2)"></i>Hub</span>
          <span><i style="background:var(--accent-3)"></i>Active lane</span>
        </div>
      </div>`;
}

/* ------------------------------------------------------------------ home --- */

const homeContent = `
  <main id="main">
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <span class="eyebrow" data-reveal>Freight forwarding &amp; contract logistics</span>
          <h1>
            <span class="line"><span>Every consignment,</span></span>
            <span class="line"><span class="grad-text">accounted for.</span></span>
          </h1>
          <p class="lede" data-reveal>${esc(site.tagline)} Air, ocean, road, rail and warehousing on one file, one number and one honest timeline.</p>
          <div class="hero-actions" data-reveal>
            <a class="btn" href="/quote">Get a rate <span class="arw">&rsaquo;</span></a>
            <a class="btn ghost" href="/services">See what we move</a>
          </div>
          <div class="hero-proof" data-reveal>
            ${network.stats
              .slice(0, 3)
              .map(
                (s) => `<div><strong data-count="${s.value}" data-suffix="${s.suffix}">${figure(s.value, s.suffix)}</strong><span>${esc(s.label)}</span></div>`
              )
              .join('\n            ')}
          </div>
        </div>

        <div class="hero-side">
          <div class="hero-media" data-reveal>
            ${images.heroSlides
              .map((src, i) => `<div class="hero-slide${i === 0 ? ' on' : ''}" style="background-image:url('${src}')"></div>`)
              .join('\n            ')}
            <span class="pill hero-media-tag"><span class="dot"></span>Live network</span>
          </div>
          ${tracker({ id: 'hero-tracker', compact: true })}
        </div>
      </div>
    </section>

    <div class="marquee" aria-hidden="true">
      <div class="marquee-track">
        ${[0, 1]
          .map(() =>
            network.hubs
              .map((h) => `<span>${esc(h.city)} ${esc(h.code)}</span>`)
              .join('')
          )
          .join('')}
      </div>
    </div>

    <section class="section" id="services">
      <div class="wrap">
        ${head({
          kicker: 'What we move',
          title: 'Six services, one consignment file.',
          lede: 'Mode is a routing decision, not a separate company. A booking can change mode mid-journey and keep the same tracking number, the same paperwork and the same person answering the phone.',
          split: true,
          aside: '<a class="btn ghost" href="/services">All services <span class="arw">&rsaquo;</span></a>',
        })}
        <div class="grid three">
          ${services.map(serviceCard).join('\n')}
        </div>
      </div>
    </section>

    <section class="section" id="how">
      <div class="wrap">
        ${head({
          kicker: 'How tracking works',
          title: 'A timeline you can argue with.',
          lede: 'Every status on this site is an event a person or a carrier feed actually wrote, with a time and a place attached. Nothing is inferred, and nothing is set by an overnight batch job.',
        })}
        <div class="grid four">
          ${[
            ['01', 'A number is minted', 'The desk registers the booking and the system mints a tracking number. It is on the paperwork before the cargo moves.'],
            ['02', 'Movements are appended', 'Each collection, gate-in, transhipment and clearance is appended to the consignment. Nothing is overwritten.'],
            ['03', 'You read the same row', 'The timeline you see is the record the control tower works from — not a customer-facing summary of it.'],
            ['04', 'Exceptions surface early', 'A consignment that stops moving longer than its lane allows raises an alert here before you have to ask.'],
          ]
            .map(
              ([n, t, p], i) => `
          <article class="card tilt step" data-tilt data-reveal style="--delay:${i * 70}ms">
            <span class="n">${n}</span>
            <h3>${t}</h3>
            <p>${p}</p>
          </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section" id="network">
      <div class="wrap">
        ${head({
          kicker: 'Global network',
          title: 'Eight control hubs. One hundred and seventy-two countries.',
          lede: 'Our own people at the gateways that matter, and vetted partners everywhere else — with the same event standard applied to both.',
          split: true,
          aside: '<a class="btn ghost" href="/network">Explore the network <span class="arw">&rsaquo;</span></a>',
        })}
        ${worldMap()}
        <div class="stats" data-reveal style="margin-top:26px">
          ${network.stats
            .map(
              (s) => `<div class="stat"><b data-count="${s.value}" data-suffix="${s.suffix}">${figure(s.value, s.suffix)}</b><span>${esc(s.label)}</span></div>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap split">
        <div class="split-media" data-reveal>
          <img src="${images.control}" alt="Paramount control tower" loading="lazy" width="1600" height="1000" />
          <div class="badge"><b>24/7</b><span>Control tower</span></div>
        </div>
        <div>
          ${head({
            kicker: 'Why Paramount',
            title: 'We would rather tell you early than look good late.',
            lede: 'Most freight failures are not the delay. They are finding out about the delay from the person waiting for the pallet.',
          })}
          <ul class="checks">
            ${check('One named lane specialist per account — not a queue.')}
            ${check('Customs brokerage in-house at every gateway we sell.')}
            ${check('Event-level visibility, published to the customer unedited.')}
            ${check('Carbon reported per consignment, not per invoice.')}
            ${check('Cargo insurance arranged and claims handled on your behalf.')}
          </ul>
          <div class="hero-actions"><a class="btn" href="/about">About Paramount <span class="arw">&rsaquo;</span></a></div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        ${head({ kicker: 'Industries', title: 'Cargo with opinions of its own.' })}
        <div class="grid three">
          ${industries
            .map(
              (ind, i) => `
          <article class="card tilt ind-card" data-tilt data-reveal style="--delay:${i * 60}ms">
            <span class="glyph">${icon[ind.icon] || icon.bolt}</span>
            <h3>${esc(ind.title)}</h3>
            <p>${esc(ind.blurb)}</p>
          </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="cta" data-reveal>
          <span class="eyebrow">Ready when you are</span>
          <h2>Tell us the lane. We will tell you the truth about it.</h2>
          <p>Rates, transit times and the constraints nobody mentions until week three — from a specialist who actually runs the corridor.</p>
          <div class="cta-actions">
            <a class="btn" href="/quote">Request a quote <span class="arw">&rsaquo;</span></a>
            <a class="btn ghost" href="/contact">Talk to the desk</a>
          </div>
        </div>
      </div>
    </section>
  </main>`;

/* ----------------------------------------------------------------- track --- */

const trackContent = `
  <main id="main">
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <span>Track</span></div>
        <h1>Where is it?</h1>
        <p class="lede">Enter the tracking number from your booking confirmation, waybill or label. Every movement we have recorded is shown, newest first — including the ones we would rather not have had.</p>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="wrap" style="display:grid;gap:26px">
        ${tracker({ id: 'page-tracker', autofocus: true })}

        <div class="grid three" data-reveal>
          ${[
            ['Lost the number?', 'The desk can find a consignment from the booking reference, the container number or the consignee address. Call the support line or start a chat.'],
            ['Nothing has moved?', "Between long-haul legs a consignment can sit legitimately — an ocean leg posts one event every few days. The estimated delivery is the number to watch."],
            ['Held in customs?', 'Clearance holds show as their own status with the reason attached. If paperwork is missing, the note says which document is outstanding.'],
          ]
            .map(
              ([t, p], i) => `
          <article class="card tilt step" data-tilt style="--delay:${i * 60}ms">
            <h3>${t}</h3>
            <p>${p}</p>
          </article>`
            )
            .join('')}
        </div>
      </div>
    </section>
  </main>`;

/* -------------------------------------------------------------- services --- */

const servicesContent = `
  <main id="main">
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <span>Services</span></div>
        <h1>Freight, moved <span class="grad-text">deliberately.</span></h1>
        <p class="lede">Six services that share one operating system: one file, one tracking number, one specialist who knows the lane and answers the phone.</p>
      </div>
    </section>

    <section class="section" style="padding-top:clamp(20px,3vw,40px)">
      <div class="wrap">
        <div class="grid three" id="service-grid">
          ${services.map(serviceCard).join('\n')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        ${head({ kicker: 'Alongside every mode', title: 'The parts nobody quotes for.' })}
        <div class="grid three">
          ${[
            ['Customs &amp; compliance', 'Licensed brokerage in-house at every gateway we sell, with classification, valuation and partner-agency filings handled on the same file as the freight.'],
            ['Cargo insurance', 'All-risk cover arranged at booking, and claims documented and pursued by us rather than handed back to you with a form.'],
            ['Project &amp; heavy lift', 'Route surveys, lift plans, permits and escorts for out-of-gauge cargo, run by engineers who have moved it before.'],
            ['Trade advisory', 'Incoterms that match who actually controls the cargo, origin planning and duty relief where the numbers justify the paperwork.'],
            ['Control tower', 'A staffed desk watching live exceptions across every mode, with escalation paths agreed before they are needed.'],
            ['Sustainability reporting', 'GLEC-aligned CO₂e per consignment, reported per lane so decisions can be made on evidence.'],
          ]
            .map(
              ([t, p], i) => `
          <article class="card tilt step" data-tilt data-reveal style="--delay:${i * 50}ms">
            <h3>${t}</h3>
            <p>${p}</p>
          </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap"><div class="cta" data-reveal>
        <h2>Not sure which mode the cargo wants?</h2>
        <p>Give us the weight, the lane and the date it has to land. We will tell you what it costs by air, by sea and by rail, and which one we would actually book.</p>
        <div class="cta-actions"><a class="btn" href="/quote">Request a quote <span class="arw">&rsaquo;</span></a></div>
      </div></div>
    </section>
  </main>`;

/* --------------------------------------------------------- service detail --- */

const serviceDetailContent = `
  <main id="main" data-service-detail>
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <a href="/services">Services</a> <span>/</span> <span data-svc="title">Service</span></div>
        <span class="eyebrow" data-svc="code"></span>
        <h1 data-svc="heading">Loading service&hellip;</h1>
        <p class="lede" data-svc="summary"></p>
        <div class="hero-actions">
          <a class="btn" href="/quote">Get a rate for this lane <span class="arw">&rsaquo;</span></a>
          <a class="btn ghost" href="/track">Track a consignment</a>
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap split">
        <div class="split-media"><img data-svc="image" src="${images.network}" alt="" width="1200" height="900" /></div>
        <div>
          <h2 style="font-size:clamp(1.6rem,3vw,2.3rem)">How it runs</h2>
          <p class="lede" data-svc="detail" style="margin-top:16px"></p>
          <ul class="checks" data-svc="capabilities"></ul>
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="wrap">
        <div class="stats" data-svc="metrics"></div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        ${head({ kicker: 'Other services', title: 'The rest of the network.' })}
        <div class="grid three" data-svc="others"></div>
      </div>
    </section>
  </main>`;

/* --------------------------------------------------------------- network --- */

const networkContent = `
  <main id="main">
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <span>Network</span></div>
        <h1>A network you can <span class="grad-text">point at.</span></h1>
        <p class="lede">Eight control hubs of our own, vetted partners in 172 countries, and one event standard applied to every one of them so a consignment reads the same wherever it is.</p>
      </div>
    </section>

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap">
        ${worldMap()}
        <div class="hub-list">
          ${network.hubs
            .map(
              (h) => `
          <article class="hub" data-reveal>
            <span class="code">${esc(h.code)} · ${esc(h.country)}</span>
            <h4>${esc(h.city)}</h4>
            <p>${esc(h.role)} — ${esc(h.note)}</p>
          </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        ${head({ kicker: 'Live lanes', title: 'Corridors we hold allocation on.', lede: 'Transit times are door-to-door medians from the last four quarters, not carrier marketing figures.' })}
        <div class="grid three">
          ${network.lanes
            .map(
              (lane, i) => `
          <article class="card tilt step" data-tilt data-reveal style="--delay:${i * 55}ms">
            <span class="n">${esc(lane.transit)}</span>
            <h3>${esc(lane.label)}</h3>
            <p>${esc(lane.mode.replace(/_/g, ' '))} · allocation contracted ahead of peak</p>
          </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap"><div class="cta" data-reveal>
        <h2>Need a lane we have not listed?</h2>
        <p>We open corridors for customers, not brochures. Tell us where the cargo starts and ends and we will tell you honestly whether we are the right forwarder for it.</p>
        <div class="cta-actions"><a class="btn" href="/contact">Talk to the desk <span class="arw">&rsaquo;</span></a></div>
      </div></div>
    </section>
  </main>`;

/* ----------------------------------------------------------------- about --- */

const aboutContent = `
  <main id="main">
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <span>About</span></div>
        <h1>Freight is a <span class="grad-text">promise business.</span></h1>
        <p class="lede">Paramount was built by people who got tired of finding out about a delay from the customer. So we built the company around the event trail first and the sales pitch second.</p>
      </div>
    </section>

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap split">
        <div class="split-media" data-reveal>
          <img src="${images.about}" alt="Paramount operations" loading="lazy" width="1600" height="1000" />
          <div class="badge"><b>2009</b><span>Founded, Rotterdam</span></div>
        </div>
        <div>
          ${head({ kicker: 'Who we are', title: 'Three thousand people, one operating standard.' })}
          <p class="lede">We move 2.4 million consignments a year across six modes, from a single pallet of spares to 12,000-tonne project cargo. What holds it together is not the fleet — most of it is not ours — but the rule that every handover is written down and published to the customer unedited.</p>
          <ul class="checks" style="margin-top:24px">
            ${check('Independent and privately held — no carrier owns our routing decisions.')}
            ${check('ISO 9001, ISO 14001 and AEO-F certified across our own gateways.')}
            ${check('GDP-compliant pharma lanes audited annually by a third party.')}
            ${check('IATA CASS, FIATA and BIFA member.')}
          </ul>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap split">
        <div>
          ${head({ kicker: 'Leadership', title: esc(leadership.name) })}
          <p class="eyebrow">${esc(leadership.role)}</p>
          <blockquote class="lede" style="margin-top:20px;border-left:2px solid var(--accent-2);padding-left:22px">“${esc(leadership.quote)}”</blockquote>
          <p class="lede" style="margin-top:22px">${esc(leadership.bio)}</p>
        </div>
        <div class="split-media" data-reveal>
          <img src="${images.leadership}" alt="${esc(leadership.name)}" loading="lazy" width="1200" height="1400" />
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        ${head({ kicker: 'How we work', title: 'Four rules we do not bend.' })}
        <div class="grid four">
          ${[
            ['01', 'Write it down', 'If it happened to the cargo, it is an event with a time and a place. No status is set by inference.'],
            ['02', 'Publish it unedited', 'The customer sees the same timeline the control tower works from, including the ugly parts.'],
            ['03', 'Own the handover', 'A partner carrier does not become an excuse. The file stays ours until it is signed for.'],
            ['04', 'Say it early', 'A delay told on the day it becomes likely costs a fraction of one discovered at the door.'],
          ]
            .map(
              ([n, t, p], i) => `
          <article class="card tilt step" data-tilt data-reveal style="--delay:${i * 60}ms">
            <span class="n">${n}</span><h3>${t}</h3><p>${p}</p>
          </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap"><div class="cta" data-reveal>
        <h2>Come and work on it.</h2>
        <p>We hire people who would rather make the bad call visible than let it stay quiet. Open roles across operations, compliance, commercial and technology.</p>
        <div class="cta-actions"><a class="btn" href="/careers">See open roles <span class="arw">&rsaquo;</span></a></div>
      </div></div>
    </section>
  </main>`;

/* ----------------------------------------------------------------- quote --- */

const quoteContent = `
  <main id="main">
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <span>Quote</span></div>
        <h1>Get a rate.</h1>
        <p class="lede">Tell us what moves and when. A lane specialist — not a form robot — comes back with rates, transit times and anything about the corridor you should know before you commit.</p>
      </div>
    </section>

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap contact-grid">
        <div>
          ${head({ kicker: 'What happens next', title: 'Three steps, no runaround.' })}
          <ul class="checks">
            ${check('We acknowledge within one working hour during desk cover.')}
            ${check('A specialist for that corridor prices it — not a shared inbox.')}
            ${check('You get rates, transit times and the constraints, in writing.')}
          </ul>
          <dl class="contact-lines">
            <div class="contact-line"><dt>Rate desk</dt><dd><a href="mailto:${esc(site.email)}" data-site="email">${esc(site.email)}</a></dd></div>
            <div class="contact-line"><dt>Support line</dt><dd><a href="tel:${esc(site.support_phone).replace(/\s+/g, '')}" data-site="support_phone">${esc(site.support_phone)}</a></dd></div>
            <div class="contact-line"><dt>Desk hours</dt><dd data-site="hours">${esc(site.hours)}</dd></div>
          </dl>
        </div>

        <div class="card" data-reveal>
          <form id="quote-form" data-quote-form novalidate>
            <div class="field two">
              <div class="field"><label for="q-name">Name</label><input type="text" id="q-name" name="name" autocomplete="name" required /><div class="err" data-err="name"></div></div>
              <div class="field"><label for="q-email">Email</label><input type="email" id="q-email" name="email" autocomplete="email" required /><div class="err" data-err="email"></div></div>
            </div>
            <div class="field two">
              <div class="field"><label for="q-company">Company <span class="opt">(optional)</span></label><input type="text" id="q-company" name="company" autocomplete="organization" /></div>
              <div class="field"><label for="q-phone">Phone <span class="opt">(optional)</span></label><input type="tel" id="q-phone" name="phone" autocomplete="tel" /></div>
            </div>
            <div class="field"><label for="q-mode">Service</label>
              <select id="q-mode" name="mode" required>
                <option value="">Select a service</option>
                <option value="air_freight">Air freight</option>
                <option value="ocean_freight">Ocean freight</option>
                <option value="road_haulage">Road haulage</option>
                <option value="rail_freight">Rail freight</option>
                <option value="express_courier">Express courier</option>
                <option value="warehousing">Warehousing &amp; fulfilment</option>
              </select><div class="err" data-err="mode"></div>
            </div>
            <div class="field two">
              <div class="field"><label for="q-origin">Origin</label><input type="text" id="q-origin" name="origin" placeholder="City, country or port" required /><div class="err" data-err="origin"></div></div>
              <div class="field"><label for="q-destination">Destination</label><input type="text" id="q-destination" name="destination" placeholder="City, country or port" required /><div class="err" data-err="destination"></div></div>
            </div>
            <div class="field three">
              <div class="field"><label for="q-weight">Weight (kg)</label><input type="number" id="q-weight" name="weightKg" min="0" step="0.1" /></div>
              <div class="field"><label for="q-pieces">Pieces</label><input type="number" id="q-pieces" name="pieces" min="1" step="1" /></div>
              <div class="field"><label for="q-ready">Ready on</label><input type="date" id="q-ready" name="readyDate" /></div>
            </div>
            <div class="field two">
              <div class="field"><label for="q-cargo">Cargo type</label><input type="text" id="q-cargo" name="cargoType" placeholder="e.g. palletised machine parts" /></div>
              <div class="field"><label for="q-incoterms">Incoterms <span class="opt">(optional)</span></label><input type="text" id="q-incoterms" name="incoterms" placeholder="EXW, FOB, DAP&hellip;" /></div>
            </div>
            <div class="field"><label for="q-dimensions">Dimensions <span class="opt">(optional)</span></label><input type="text" id="q-dimensions" name="dimensions" placeholder="e.g. 4 pallets at 120 x 80 x 150 cm" /></div>
            <div class="field"><label for="q-message">Anything else</label><textarea id="q-message" name="message" placeholder="Temperature range, deadlines, permits, hazardous class&hellip;"></textarea></div>
            <div class="honeypot" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
            <div class="form-status" data-form-status role="status" aria-live="polite"></div>
            <button type="submit" class="btn block" data-submit>Request rates <span class="arw">&rsaquo;</span></button>
          </form>
        </div>
      </div>
    </section>
  </main>`;

/* --------------------------------------------------------------- contact --- */

const contactContent = `
  <main id="main">
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <span>Contact</span></div>
        <h1>Talk to a person.</h1>
        <p class="lede">The control tower is staffed around the clock. Anything about a live consignment gets picked up immediately; everything else within one working day.</p>
      </div>
    </section>

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap contact-grid">
        <div>
          ${head({ kicker: 'Paramount Logistics', title: 'Rotterdam, and wherever your cargo is.' })}
          <dl class="contact-lines">
            <div class="contact-line"><dt>Head office</dt><dd data-site="address">${esc(site.address)}</dd></div>
            <div class="contact-line"><dt>General</dt><dd><a href="mailto:${esc(site.email)}" data-site="email">${esc(site.email)}</a></dd></div>
            <div class="contact-line"><dt>Switchboard</dt><dd><a href="tel:${esc(site.phone).replace(/\s+/g, '')}" data-site="phone">${esc(site.phone)}</a></dd></div>
            <div class="contact-line"><dt>24/7 support</dt><dd><a href="tel:${esc(site.support_phone).replace(/\s+/g, '')}" data-site="support_phone">${esc(site.support_phone)}</a></dd></div>
            <div class="contact-line"><dt>Cargo emergency</dt><dd><a href="tel:${esc(site.emergency_phone).replace(/\s+/g, '')}" data-site="emergency_phone">${esc(site.emergency_phone)}</a></dd></div>
            <div class="contact-line"><dt>Hours</dt><dd data-site="hours">${esc(site.hours)}</dd></div>
          </dl>
          <div class="hero-actions"><a class="btn ghost" href="/track">Track a consignment <span class="arw">&rsaquo;</span></a></div>
        </div>
        <div class="card" data-reveal>
          <h3 style="margin-bottom:18px">Send us a message</h3>
          ${contactForm('contact-form')}
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="wrap">
        ${head({ kicker: 'Common questions', title: 'Before you write.' })}
        <div class="faq">
          ${[
            ['Where do I find my tracking number?', `It is on your booking confirmation and on the label, and it looks like <code class="mono">PMT-${YEAR}-4F7K2QX9</code>. If you cannot find it, the desk can trace a consignment from the booking reference, container number or consignee address.`],
            ['My consignment has not moved for days. Is it lost?', 'Usually not. Long-haul ocean and rail legs post events days apart by design. The estimated delivery on the tracking page is the number to watch — if that moves, we will have said why.'],
            ['Can you clear customs for me?', 'Yes, at every gateway we sell. Brokerage runs on the same file as the freight, so a clearance hold shows on your timeline with the outstanding document named.'],
            ['Do you insure cargo?', 'All-risk cover can be arranged at booking. We document and pursue claims ourselves rather than handing you a form.'],
            ['What if something goes wrong?', 'You get told. A consignment that stops moving longer than its lane allows raises an exception here, and a named person owns it until it is resolved.'],
          ]
            .map(
              ([q, a]) => `
          <details>
            <summary>${q}</summary>
            <div class="answer">${a}</div>
          </details>`
            )
            .join('')}
        </div>
      </div>
    </section>
  </main>`;

/* --------------------------------------------------------------- careers --- */

const careersContent = `
  <main id="main">
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <span>Careers</span></div>
        <h1>Work where the <span class="grad-text">detail matters.</span></h1>
        <p class="lede">Three thousand people across six control hubs. We hire for judgement under pressure and a low tolerance for a status nobody can explain.</p>
      </div>
    </section>

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap">
        ${head({ kicker: 'Open roles', title: 'Where we are hiring.', split: true, aside: '<a class="btn ghost" href="/apply">Speculative application <span class="arw">&rsaquo;</span></a>' })}
        <div class="grid" id="role-list" style="gap:14px">
          ${careers
            .map(
              (role) => `
          <article class="role" data-reveal>
            <div>
              <div class="meta"><span>${esc(role.team)}</span><span>${esc(role.location)}</span><span>${esc(role.type)}</span></div>
              <h3>${esc(role.title)}</h3>
              <p>${esc(role.summary)}</p>
            </div>
            <a class="btn sm" href="/apply?role=${encodeURIComponent(role.id)}">Apply <span class="arw">&rsaquo;</span></a>
          </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap split">
        <div class="split-media" data-reveal><img src="${images.careers}" alt="Working at Paramount" loading="lazy" width="1600" height="1000" /></div>
        <div>
          ${head({ kicker: 'What you get', title: 'The terms, plainly.' })}
          <ul class="checks">
            ${check('Salary banded and published internally — no negotiation lottery.')}
            ${check('Hybrid where the role allows; shift premiums where it does not.')}
            ${check('Professional certification funded (broker licence, CILT, IATA DGR).')}
            ${check('Six control hubs, and real internal moves between them.')}
          </ul>
        </div>
      </div>
    </section>
  </main>`;

/* ----------------------------------------------------------------- apply --- */

const applyContent = `
  <main id="main">
    <section class="page-hero">
      <div class="wrap inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <a href="/careers">Careers</a> <span>/</span> <span>Apply</span></div>
        <h1>Apply.</h1>
        <p class="lede" id="apply-lede">Tell us what you have run and where it got hard. A person on the team reads every application.</p>
      </div>
    </section>

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap" style="max-width:820px">
        <div class="card" data-reveal>
          <form id="apply-form" novalidate>
            <div class="field"><label for="a-role">Role</label>
              <select id="a-role" name="roleId">
                <option value="">Speculative application</option>
                ${careers.map((r) => `<option value="${esc(r.id)}">${esc(r.title)} — ${esc(r.location)}</option>`).join('')}
              </select>
            </div>
            <div class="field two">
              <div class="field"><label for="a-name">Name</label><input type="text" id="a-name" name="name" autocomplete="name" required /><div class="err" data-err="name"></div></div>
              <div class="field"><label for="a-email">Email</label><input type="email" id="a-email" name="email" autocomplete="email" required /><div class="err" data-err="email"></div></div>
            </div>
            <div class="field two">
              <div class="field"><label for="a-phone">Phone <span class="opt">(optional)</span></label><input type="tel" id="a-phone" name="phone" autocomplete="tel" /></div>
              <div class="field"><label for="a-experience">Years in the industry</label><input type="text" id="a-experience" name="experience" placeholder="e.g. 6" /></div>
            </div>
            <div class="field"><label for="a-portfolio">LinkedIn or CV link <span class="opt">(optional)</span></label><input type="url" id="a-portfolio" name="portfolio" placeholder="https://" /></div>
            <div class="field"><label for="a-message">Tell us about your work</label><textarea id="a-message" name="message" placeholder="What have you run, and what went wrong that you fixed?" required></textarea><div class="err" data-err="message"></div></div>
            <div class="honeypot" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
            <div class="form-status" data-form-status role="status" aria-live="polite"></div>
            <button type="submit" class="btn block" data-submit>Send application <span class="arw">&rsaquo;</span></button>
          </form>
        </div>
      </div>
    </section>
  </main>`;

/* ------------------------------------------------------------------- 404 --- */

const notFoundContent = `
  <main id="main">
    <section class="section">
      <div class="wrap oops">
        <span class="code">404</span>
        <h1>That page has been rerouted.</h1>
        <p class="lede">The link is wrong or the page has moved. If you were looking for a consignment, the tracking console will find it.</p>
        <div class="hero-actions">
          <a class="btn" href="/track">Track a consignment <span class="arw">&rsaquo;</span></a>
          <a class="btn ghost" href="/">Back to the home page</a>
        </div>
      </div>
    </section>
  </main>`;

/* ----------------------------------------------------------------- pages --- */

module.exports = [
  {
    file: 'index.html',
    title: `${BRAND} — track every consignment, end to end`,
    description:
      'Global freight forwarding and contract logistics. Air, ocean, road, rail, express and warehousing, with live consignment tracking on one number.',
    active: 'home',
    bodyClass: 'page-home',
    content: homeContent,
  },
  {
    file: 'track.html',
    title: `Track a consignment | ${BRAND}`,
    description: 'Enter a Paramount tracking number to see every recorded movement, the current location and the estimated delivery.',
    active: 'track',
    bodyClass: 'page-track',
    content: trackContent,
  },
  {
    file: 'services.html',
    title: `Services | ${BRAND}`,
    description: 'Air freight, ocean freight, road haulage, rail freight, express courier and contract warehousing from one operating standard.',
    active: 'services',
    bodyClass: 'page-services',
    content: servicesContent,
  },
  {
    file: 'service.html',
    title: `Service | ${BRAND}`,
    description: 'How this Paramount Logistics service runs, what it covers and where it operates.',
    active: 'services',
    bodyClass: 'page-service',
    content: serviceDetailContent,
    extraScripts: ['/js/service.js'],
  },
  {
    file: 'network.html',
    title: `Global network | ${BRAND}`,
    description: 'Eight control hubs, 172 countries and the trade lanes Paramount holds allocation on.',
    active: 'network',
    bodyClass: 'page-network',
    content: networkContent,
  },
  {
    file: 'about.html',
    title: `About | ${BRAND}`,
    description: 'Independent freight forwarder built around an event trail published to the customer unedited.',
    active: 'about',
    bodyClass: 'page-about',
    content: aboutContent,
  },
  {
    file: 'quote.html',
    title: `Request a quote | ${BRAND}`,
    description: 'Tell us the lane, the cargo and the date. A lane specialist comes back with rates and transit times.',
    active: 'quote',
    bodyClass: 'page-quote',
    content: quoteContent,
    extraScripts: ['/js/quote.js'],
  },
  {
    file: 'contact.html',
    title: `Contact | ${BRAND}`,
    description: 'Reach the Paramount control tower, the rate desk or the cargo emergency line.',
    active: 'contact',
    bodyClass: 'page-contact',
    content: contactContent,
  },
  {
    file: 'careers.html',
    title: `Careers | ${BRAND}`,
    description: 'Open roles across operations, compliance, commercial and technology at Paramount Logistics.',
    active: 'careers',
    bodyClass: 'page-careers',
    content: careersContent,
  },
  {
    file: 'apply.html',
    title: `Apply | ${BRAND}`,
    description: 'Apply for an open role, or send a speculative application.',
    active: 'careers',
    bodyClass: 'page-apply',
    content: applyContent,
    extraScripts: ['/js/apply.js'],
  },
  {
    file: '404.html',
    title: `Page not found | ${BRAND}`,
    description: 'That page could not be found.',
    noindex: true,
    bodyClass: 'page-404',
    content: notFoundContent,
  },
];
