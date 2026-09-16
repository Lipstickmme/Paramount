'use strict';

/**
 * Every page's content, as data.
 *
 * One module per site rather than one file per page: the pages share so much
 * furniture (section heads, card grids, the tracking console) that keeping them
 * together is what stops them drifting apart. scripts/build-pages.js renders
 * each entry through src/site/layout.js into public/*.html.
 */

const { contactForm, tracker, banner, icons, esc, YEAR } = require('./layout');
const images = require('./images');

const site = require('../data/site.json');
const services = require('../data/services.json');
const network = require('../data/network.json');
const industries = require('../data/industries.json');
const careers = require('../data/careers.json');
const atlas = require('../data/world-map.json');
const leadership = require('../data/leadership.json');

const BRAND = 'Paramount Shipping';

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
          <a class="link" href="/services/${svc.id}">Explore ${esc(svc.title.toLowerCase())} ${icons.arrow}</a>
        </article>`;
}

/**
 * The network chart on /network.
 *
 * The same coastlines the live tracker draws, rendered at build time from
 * src/data/world-map.json: hubs, the lanes between them, and nothing moving.
 * The home page has the vessels; this one is the shape of the network.
 */
function worldMap() {
  const project = (lng, lat) => ({
    x: ((Number(lng) + 180) / 360) * atlas.width,
    y:
      ((atlas.latMax - Math.max(atlas.latMin, Math.min(atlas.latMax, Number(lat)))) /
        (atlas.latMax - atlas.latMin)) *
      atlas.height,
  });

  const byId = Object.fromEntries(network.hubs.map((h) => [h.id, h]));

  const lanes = network.lanes
    .map((lane) => {
      const a = byId[lane.from];
      const b = byId[lane.to];
      if (!a || !b) return '';
      const p1 = project(a.lng, a.lat);
      const p2 = project(b.lng, b.lat);
      // Bowed the same way for every lane, so crossing routes stay readable.
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2 - Math.abs(p2.x - p1.x) * 0.2 - 14;
      return `<path class="net-lane" d="M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}">
          <title>${esc(lane.label)} · ${esc(lane.transit)}</title>
        </path>`;
    })
    .join('');

  // Labels alternate above and below, because Rotterdam and Hamburg are 500 km
  // apart and all but touching at this scale.
  const placed = [];
  const offsetFor = (x, y) => {
    for (const side of [15, -11]) {
      const ly = y + side;
      if (!placed.some((q) => Math.abs(q.x - x) < 52 && Math.abs(q.y - ly) < 22)) {
        placed.push({ x, y: ly });
        return side;
      }
    }
    placed.push({ x, y: y + 34 });
    return 34;
  };

  const hubs = network.hubs
    .map((hub) => {
      const { x, y } = project(hub.lng, hub.lat);
      const dy = offsetFor(x, y);
      return `<g class="net-hub">
          <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.4"><title>${esc(hub.city)} (${esc(hub.code)}) — ${esc(hub.role)}</title></circle>
          <circle class="net-hub-ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.4">
            <animate attributeName="r" values="4.4;13" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values=".5;0" dur="3s" repeatCount="indefinite" />
          </circle>
          <text class="net-label" x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="middle">${esc(hub.code)}</text>
        </g>`;
    })
    .join('');

  return `
      <div class="network-map" data-reveal>
        <svg viewBox="0 0 ${atlas.width} ${atlas.height}" role="img"
             aria-label="Paramount control hubs and the lanes between them"
             preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="net-sea" cx="0.5" cy="0.1" r="1.1">
              <stop offset="0" class="sea-lit" />
              <stop offset="1" class="sea-deep" />
            </radialGradient>
          </defs>
          <rect x="-600" y="-600" width="${atlas.width + 1200}" height="${atlas.height + 1200}" fill="url(#net-sea)" />
          <path class="fleet-land" d="${atlas.land}" />
          ${lanes}
          ${hubs}
        </svg>
        <div class="map-legend">
          <span><i style="background:var(--accent-2)"></i>Control hub</span>
          <span><i style="background:var(--ink-3)"></i>Contracted lane</span>
        </div>
      </div>`;
}

/**
 * The fleet tracker.
 *
 * The chart used to sit two thirds of the way down the network page, where
 * almost nobody scrolled to it. It is the most persuasive thing the business
 * has — twelve vessels, where each one is, what it is carrying — so it leads.
 * The markup is the frame; public/js/fleet-map.js draws into it from
 * /api/fleet, and without the script the frame simply stays empty rather than
 * leaving a broken half-chart behind.
 */
function fleetTracker() {
  return `
      <section class="fleet" id="fleet" aria-label="Live fleet tracker">
        <header class="fleet-head">
          <div class="fleet-head-copy">
            <span class="eyebrow">Fleet operations</span>
            <h2>Every vessel, where it actually is.</h2>
            <p class="fleet-note">
              Each position is computed from the vessel's route, service speed and
              voyage clock, so a ship moves at exactly the speed it reports. Real
              time is honest and almost invisible &mdash; a ship crosses a pixel in
              about a quarter of an hour &mdash; so the chart opens wound forward.
            </p>
          </div>

          <div class="fleet-head-end">
            <div class="fleet-mode" role="group" aria-label="Chart speed">
              <button type="button" data-fleet-lapse="off" aria-pressed="false">Real time</button>
              <button type="button" data-fleet-lapse="on" aria-pressed="true">Time-lapse</button>
            </div>
            <div class="fleet-status">
              <span class="fleet-live"><span class="dot"></span><span data-fleet-count>Loading&hellip;</span></span>
              <span class="fleet-stamp mono" data-fleet-stamp></span>
            </div>
          </div>
        </header>

        <div class="fleet-body">
          <div class="fleet-chart" data-fleet-chart></div>
          <aside class="fleet-panel" data-fleet-panel>
            <p class="muted">Loading the fleet&hellip;</p>
          </aside>
        </div>

        <div class="fleet-foot">
          <div class="fleet-legend" data-fleet-legend></div>
          <div class="fleet-list" data-fleet-list></div>
        </div>
      </section>`;
}

/* ------------------------------------------------------------------ home --- */

const homeContent = `
  <main id="main">
    ${banner({
      slot: 'home',
      className: 'banner-home',
      kicker: 'Freight forwarding &amp; contract logistics',
      title: `
              <span class="line"><span>Every consignment,</span></span>
              <span class="line"><span>accounted for.</span></span>`,
      lede: `${esc(site.tagline)} Air, ocean, road, rail and warehousing on one file, one number and one honest timeline.`,
      actions: `
              <a class="btn" href="#track">Track a consignment ${icons.arrow}</a>
              <a class="btn ghost" href="/quote">Get a rate</a>`,
      aside: `
            <div class="banner-proof">
              <div class="banner-proof-head">${icons.radar}<span>The record</span></div>
              ${network.stats
                .slice(0, 3)
                .map(
                  (s) => `<div class="banner-proof-row">
                <strong data-count="${s.value}" data-suffix="${s.suffix}">${figure(s.value, s.suffix)}</strong>
                <span>${esc(s.label)}</span>
              </div>`
                )
                .join('\n              ')}
            </div>`,
    })}

    <!-- The tracking console sits directly under the banner, on its own ground.
         It is the reason most people open this site, so nothing is above it but
         the headline, and nothing about it needs a second page. -->
    <section class="section track-band" id="track">
      <div class="wrap track-band-inner">
        ${tracker({ id: 'tracker', autofocus: false })}
      </div>
    </section>

    <section class="section" id="fleet-section" style="padding-top:0">
      <div class="wrap">
        ${fleetTracker()}
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
          aside: `<a class="btn ghost" href="/services">All services ${icons.arrow}</a>`,
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
          aside: `<a class="btn ghost" href="/network">Explore the network ${icons.arrow}</a>`,
        })}
        <div class="stats" data-reveal>
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
          <div class="hero-actions"><a class="btn" href="/about">About Paramount ${icons.arrow}</a></div>
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
            <a class="btn" href="/quote">Request a quote ${icons.arrow}</a>
            <a class="btn ghost" href="/contact">Talk to the desk</a>
          </div>
        </div>
      </div>
    </section>
  </main>`;

/* -------------------------------------------------------------- services --- */

const servicesContent = `
  <main id="main">
    ${banner({
      slot: 'services',
      crumbs: '<a href="/">Home</a> <span>/</span> <span>Services</span>',
      kicker: 'What we move',
      title: 'Freight, moved deliberately.',
      lede: 'Six services that share one operating system: one file, one tracking number, one specialist who knows the lane and answers the phone.',
    })}

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
        <div class="cta-actions"><a class="btn" href="/quote">Request a quote ${icons.arrow}</a></div>
      </div></div>
    </section>
  </main>`;

/* --------------------------------------------------------- service detail --- */

const serviceDetailContent = `
  <main id="main" data-service-detail>
    <!-- Which photograph belongs to which service is resolved at build time,
         from the files that actually exist; the page is rendered once for all
         six, so the map rides along and service.js picks its row. -->
    <script type="application/json" id="svc-images">${JSON.stringify(images.services)}</script>

    <section class="banner on-photo">
      <div class="banner-img" aria-hidden="true" data-svc="banner"
           style="background-image:url('${images.forBanner('services')}')"></div>
      <div class="banner-scrim" aria-hidden="true"></div>
      <div class="wrap banner-inner">
        <div class="crumbs"><a href="/">Home</a> <span>/</span> <a href="/services">Services</a> <span>/</span> <span data-svc="title">Service</span></div>
        <span class="eyebrow" data-svc="code"></span>
        <h1 data-svc="heading">Loading service&hellip;</h1>
        <p class="lede" data-svc="summary"></p>
        <div class="hero-actions">
          <a class="btn" href="/quote">Get a rate for this lane ${icons.arrow}</a>
          <a class="btn ghost" href="/#track">Track a consignment</a>
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
    ${banner({
      slot: 'network',
      crumbs: `<a href="/">Home</a> <span>/</span> <span>Network</span>`,
      kicker: 'Global network',
      title: 'A network you can point at.',
      lede: 'Eight control hubs of our own, vetted partners in 172 countries, and one event standard applied to every one of them so a consignment reads the same wherever it is.',
    })}

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap">
        ${head({
          kicker: 'Control hubs',
          title: 'Our own people at the gateways that matter.',
          split: true,
          aside: '<a class="btn ghost" href="/#fleet">Watch the fleet ' + icons.arrow + '</a>',
        })}
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
        <div class="cta-actions"><a class="btn" href="/contact">Talk to the desk ${icons.arrow}</a></div>
      </div></div>
    </section>
  </main>`;

/* ----------------------------------------------------------------- about --- */

const aboutContent = `
  <main id="main">
    ${banner({
      slot: 'about',
      crumbs: '<a href="/">Home</a> <span>/</span> <span>About</span>',
      kicker: 'About Paramount',
      title: 'Freight is a promise business.',
      lede: 'Paramount was built by people who got tired of finding out about a delay from the customer. So we built the company around the event trail first and the sales pitch second.',
    })}

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
        <div class="cta-actions"><a class="btn" href="/careers">See open roles ${icons.arrow}</a></div>
      </div></div>
    </section>
  </main>`;

/* ----------------------------------------------------------------- quote --- */

const quoteContent = `
  <main id="main">
    ${banner({
      slot: 'quote',
      crumbs: '<a href="/">Home</a> <span>/</span> <span>Quote</span>',
      kicker: 'Request a rate',
      title: 'Get a rate.',
      lede: 'Tell us what moves and when. A lane specialist — not a form robot — comes back with rates, transit times and anything about the corridor you should know before you commit.',
    })}

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
            <button type="submit" class="btn block" data-submit>Request rates ${icons.arrow}</button>
          </form>
        </div>
      </div>
    </section>
  </main>`;

/* --------------------------------------------------------------- contact --- */

const contactContent = `
  <main id="main">
    ${banner({
      slot: 'contact',
      crumbs: '<a href="/">Home</a> <span>/</span> <span>Contact</span>',
      kicker: 'Contact',
      title: 'Talk to a person.',
      lede: 'The control tower is staffed around the clock. Anything about a live consignment gets picked up immediately; everything else within one working day.',
    })}

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap contact-grid">
        <div>
          ${head({ kicker: 'Paramount Shipping', title: 'Rotterdam, and wherever your cargo is.' })}
          <dl class="contact-lines">
            <div class="contact-line"><dt>Head office</dt><dd data-site="address">${esc(site.address)}</dd></div>
            <div class="contact-line"><dt>Email</dt><dd><a href="mailto:${esc(site.email)}" data-site="email">${esc(site.email)}</a></dd></div>
            <div class="contact-line"><dt>A live consignment</dt><dd>Open the chat, bottom right &mdash; a tracking number gets an answer from the record.</dd></div>
            <div class="contact-line"><dt>Hours</dt><dd data-site="hours">${esc(site.hours)}</dd></div>
          </dl>
          <div class="hero-actions"><a class="btn ghost" href="/#track">Track a consignment ${icons.arrow}</a></div>
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
    ${banner({
      slot: 'careers',
      crumbs: '<a href="/">Home</a> <span>/</span> <span>Careers</span>',
      kicker: 'Careers',
      title: 'Work where the detail matters.',
      lede: 'Three thousand people across six control hubs. We hire for judgement under pressure and a low tolerance for a status nobody can explain.',
    })}

    <section class="section" style="padding-top:clamp(18px,3vw,36px)">
      <div class="wrap">
        ${head({ kicker: 'Open roles', title: 'Where we are hiring.', split: true, aside: `<a class="btn ghost" href="/apply">Speculative application ${icons.arrow}</a>` })}
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
            <a class="btn sm" href="/apply?role=${encodeURIComponent(role.id)}">Apply ${icons.arrow}</a>
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
    ${banner({
      slot: 'apply',
      crumbs: '<a href="/">Home</a> <span>/</span> <a href="/careers">Careers</a> <span>/</span> <span>Apply</span>',
      kicker: 'Join the crew',
      title: 'Apply.',
      lede: '<span id="apply-lede">Tell us what you have run and where it got hard. A person on the team reads every application.</span>',
    })}

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
            <button type="submit" class="btn block" data-submit>Send application ${icons.arrow}</button>
          </form>
        </div>
      </div>
    </section>
  </main>`;

/* ---------------------------------------------------------------- portal --- */

const portalContent = `
  <main id="main">
    <!-- The gate is the page.
         Signed out, this is a sign-in screen with a reason to sign in beside
         it: the card sits in the right column, level with the copy, so the
         password field and the button are on screen the moment the page opens
         rather than a scroll below the fold. Signed in, the right column
         empties, the section collapses to the same slim band every other page
         opens on, and the consignments take over underneath. -->
    <div id="portal">
    <section class="banner on-photo pm-hero">
      <div class="banner-img" aria-hidden="true" style="background-image:url('${images.forBanner('portal')}')"></div>
      <div class="banner-scrim" aria-hidden="true"></div>

      <div class="wrap banner-inner pm-hero-grid">
        <div class="pm-hero-copy">
          <div class="crumbs"><a href="/">Home</a> <span>/</span> <span>My consignments</span></div>
          <span class="eyebrow">Customer portal</span>
          <h1>Your shipments, all of them.</h1>
          <p class="lede">One account, every consignment booked to or from your address — plus anything you add by tracking number. The same timeline the control tower reads.</p>
          <ul class="pm-hero-points">
            <li>${icons.radar}<span>Every movement, as the desk recorded it</span></li>
            <li>${icons.container}<span>Air, ocean, road, rail and express on one list</span></li>
            <li>${icons.clipboard}<span>Documents and delivery evidence on the file</span></li>
          </ul>
        </div>

        <div class="pm-hero-panel">
          <div class="pm-gate" id="portal-boot">
            <div class="card"><p class="muted">Checking your session&hellip;</p></div>
          </div>

          <div class="pm-gate" id="portal-unavailable" hidden>
            <div class="card">
              <span class="eyebrow">Customer portal</span>
              <h2 style="margin-top:14px">Accounts are not available here yet.</h2>
              <p class="muted" style="margin-top:12px">This deployment has no account service connected, so there is nothing to sign in to. You can still track any consignment with its number.</p>
              <div class="hero-actions"><a class="btn" href="/#track">Track a consignment ${icons.arrow}</a></div>
            </div>
          </div>

          <div class="pm-gate" id="portal-auth" hidden>
            <form class="card pm-auth" id="portal-auth-form" novalidate>
              <span class="eyebrow">Sign in</span>
              <h2 id="portal-auth-title">Your consignments, in one place.</h2>
              <p class="muted" id="portal-auth-note"></p>
              <div class="field">
                <label for="portal-email">Email</label>
                <input type="email" id="portal-email" name="email" autocomplete="email" required />
              </div>
              <div class="field" id="portal-password-field">
                <label for="portal-password">Password</label>
                <input type="password" id="portal-password" name="password" autocomplete="current-password" minlength="8" />
              </div>
              <div class="err" id="portal-auth-error" role="alert"></div>
              <div class="form-status" id="portal-auth-note-out" role="status" aria-live="polite"></div>
              <button type="submit" class="btn block" id="portal-auth-submit">Sign in</button>
              <div class="pm-auth-links">
                <button type="button" class="link" id="portal-auth-alt">Create an account</button>
                <button type="button" class="link" id="portal-auth-forgot">Forgot password?</button>
              </div>
              <p class="muted" style="font-size:.84rem">Tracking a single consignment needs no account at all — <a class="link" href="/#track">use the console on the home page</a>.</p>
            </form>
          </div>
        </div>
      </div>
    </section>

    <section class="section pm-section" style="padding-top:clamp(18px,3vw,40px)">
      <div class="wrap">

        <div id="portal-shell" hidden>
          <div class="pm-bar">
            <div>
              <span class="eyebrow">Signed in</span>
              <strong class="pm-who" id="portal-who"></strong>
            </div>
            <button type="button" class="btn ghost sm" id="portal-signout">Sign out</button>
          </div>

          <p class="result-note" id="portal-unconfirmed" hidden></p>

          <div class="stats" id="portal-counts"></div>

          <form class="tracker pm-claim" id="portal-claim-form" novalidate>
            <div class="tracker-head"><h2>Add a consignment</h2></div>
            <div class="tracker-input">
              <label class="sr-only" for="portal-claim-number">Tracking number</label>
              <input type="text" id="portal-claim-number" name="number" placeholder="e.g. PMT-${YEAR}-4F7K2QX9"
                     autocomplete="off" spellcheck="false" maxlength="32" />
              <button type="submit" class="btn" id="portal-claim-submit">Add ${icons.arrow}</button>
            </div>
            <div class="form-status" id="portal-claim-status" role="status" aria-live="polite"></div>
          </form>

          <div class="pm-tabs" id="portal-tabs"></div>
          <div id="portal-list"></div>
          <div class="pm-detail" id="portal-detail" hidden></div>
        </div>

      </div>
    </section>
    </div>
  </main>`;

/* ------------------------------------------------------------------- 404 --- */

const notFoundContent = `
  <main id="main">
    ${banner({
      slot: 'notfound',
      kicker: '404',
      title: 'That page has been rerouted.',
      lede: 'The link is wrong or the page has moved. If you were looking for a consignment, the tracking console on the home page will find it.',
      actions: `
              <a class="btn" href="/#track">Track a consignment ${icons.arrow}</a>
              <a class="btn ghost" href="/">Back to the home page</a>`,
    })}
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
    // The chart data is 29 KB of coastline; only the page that draws it pays.
    extraScripts: ['/assets/map/world.js', '/js/fleet-map.js'],
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
    description: 'How this Paramount Shipping service runs, what it covers and where it operates.',
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
    description: 'Reach the Paramount control tower or the rate desk.',
    active: 'contact',
    bodyClass: 'page-contact',
    content: contactContent,
  },
  {
    file: 'careers.html',
    title: `Careers | ${BRAND}`,
    description: 'Open roles across operations, compliance, commercial and technology at Paramount Shipping.',
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
    file: 'portal.html',
    title: `My consignments | ${BRAND}`,
    description: 'Sign in to see every Paramount consignment on your account, with its live timeline.',
    active: 'portal',
    bodyClass: 'page-portal',
    content: portalContent,
    // Nothing here should be indexed: it is one account's consignments.
    noindex: true,
    extraScripts: ['/js/portal.js'],
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
