'use strict';

/* =========================================================================
   The fleet tracker.

   A world chart with every Paramount vessel on it, drawn from /api/fleet:
   position, heading, class, and the voyage each one is on. Markers are
   colour-coded by vessel class — softly, because a chart with six saturated
   colours on it is a toy.

   Two clocks run here. The server recomputes positions from the voyage on
   every poll, and between polls the page dead-reckons each vessel forward from
   its own course and speed, so the markers move continuously rather than
   hopping once a minute.
   ========================================================================= */

(function () {
  const root = document.getElementById('fleet');
  const world = window.PARAMOUNT_WORLD;
  if (!root || !world) return;

  const $ = (sel, ctx = root) => ctx.querySelector(sel);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  const POLL_MS = 45000;
  const TICK_MS = 1000;
  const LAPSE_TICK_MS = 120;
  const KN_TO_DEG_LAT = 1 / 60; // one nautical mile of latitude is one minute
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    vessels: [],
    ports: {},
    types: [],
    selected: null,
    lastSync: 0,
    // Ships move about a thousandth of a pixel a second on a chart this size,
    // which is honest and completely invisible. The time-lapse winds the clock
    // forward so a visitor can watch the fleet actually travel, and it says so
    // on the button rather than pretending that is real time.
    lapse: 1,
  };

  const LAPSE = 26000;

  const elapsed = () => ((Date.now() - state.lastSync) / 1000) * state.lapse;

  /* ------------------------------------------------------------- maths --- */

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const KM_PER_NM = 1.852;

  /** Great-circle distance in nautical miles. */
  function distanceNm(a, b) {
    const dLat = (b.lat - a.lat) * RAD;
    const dLng = (b.lng - a.lng) * RAD;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return (2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))) / KM_PER_NM;
  }

  /** A point `t` of the way along the great circle from `a` to `b`. */
  function interpolate(a, b, t) {
    const y1 = a.lat * RAD;
    const x1 = a.lng * RAD;
    const y2 = b.lat * RAD;
    const x2 = b.lng * RAD;
    const h =
      Math.sin((y2 - y1) / 2) ** 2 + Math.cos(y1) * Math.cos(y2) * Math.sin((x2 - x1) / 2) ** 2;
    const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
    if (!d) return { lat: a.lat, lng: a.lng };
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(y1) * Math.cos(x1) + B * Math.cos(y2) * Math.cos(x2);
    const y = A * Math.cos(y1) * Math.sin(x1) + B * Math.cos(y2) * Math.sin(x2);
    const z = A * Math.sin(y1) + B * Math.sin(y2);
    return { lat: Math.atan2(z, Math.hypot(x, y)) * DEG, lng: Math.atan2(y, x) * DEG };
  }

  function bearing(a, b) {
    const y1 = a.lat * RAD;
    const y2 = b.lat * RAD;
    const dx = (b.lng - a.lng) * RAD;
    return (
      (Math.atan2(
        Math.sin(dx) * Math.cos(y2),
        Math.cos(y1) * Math.sin(y2) - Math.sin(y1) * Math.cos(y2) * Math.cos(dx)
      ) *
        DEG +
        360) %
      360
    );
  }

  /** The legs of a vessel's track, with the running distance to each. */
  function legsOf(vessel) {
    if (vessel._legs) return vessel._legs;
    const legs = [];
    let total = 0;
    const track = vessel.track || [];
    for (let i = 0; i < track.length - 1; i += 1) {
      const nm = distanceNm(track[i], track[i + 1]);
      legs.push({ from: track[i], to: track[i + 1], nm, start: total });
      total += nm;
    }
    vessel._legs = legs;
    vessel._routeNm = total || vessel.routeNm || 1;
    return legs;
  }

  /**
   * Where a vessel is `seconds` after the last sync, following its own route.
   *
   * The same walk the server does, repeated here so the markers move between
   * polls — and so the time-lapse has something to advance. Following the route
   * rather than dead-reckoning a straight line matters: a ship two hours from a
   * turn should round it, not sail through the headland.
   */
  function positionAt(vessel, seconds) {
    const legs = legsOf(vessel);
    if (!legs.length) return { lat: vessel.lat, lng: vessel.lng, course: vessel.course };

    const travelled = Math.min(
      vessel._routeNm,
      vessel.distanceRunNm + (vessel.inPort ? 0 : (vessel.speed * seconds) / 3600)
    );
    const leg = legs.find((l) => travelled <= l.start + l.nm) || legs[legs.length - 1];
    const along = leg.nm > 0 ? Math.max(0, Math.min(1, (travelled - leg.start) / leg.nm)) : 1;
    const here = interpolate(leg.from, leg.to, along);

    return {
      lat: here.lat,
      lng: here.lng,
      course: vessel.inPort ? vessel.course : Math.round(bearing(here, leg.to)),
      travelled,
      toGo: Math.max(0, Math.round(vessel._routeNm - travelled)),
    };
  }

  /**
   * A track as one or more polylines.
   *
   * A leg that crosses the 180th meridian would otherwise be drawn as a line
   * straight back across the whole chart, which is how you get a ship that
   * appears to sail through Africa on its way from Japan to California.
   */
  function polylines(points) {
    const lines = [];
    let current = [];
    points.forEach((point, i) => {
      if (i > 0 && Math.abs(point.lng - points[i - 1].lng) > 180) {
        lines.push(current);
        current = [];
      }
      current.push(point);
    });
    if (current.length) lines.push(current);
    return lines.filter((line) => line.length > 1);
  }

  const path = (points) =>
    points
      .map((p, i) => {
        const { x, y } = world.project(p.lng, p.lat);
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join('');

  /* ------------------------------------------------------------ format --- */

  const when = (value, withTime = true) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  };

  const num = (value, unit) => (value == null ? '—' : `${Number(value).toLocaleString('en-US')}${unit || ''}`);

  /** Latitude as a chart prints it, from a live dead-reckoned position. */
  function coordinate(value, axis) {
    const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    return `${deg}°${((abs - deg) * 60).toFixed(1)}'${hemisphere}`;
  }

  /* ------------------------------------------------------------- chart --- */

  function graticule() {
    const lines = [];
    for (let lat = -40; lat <= 60; lat += 20) {
      const a = world.project(-180, lat);
      const b = world.project(180, lat);
      lines.push(`M${a.x} ${a.y.toFixed(1)}L${b.x} ${b.y.toFixed(1)}`);
    }
    for (let lng = -150; lng <= 150; lng += 30) {
      const a = world.project(lng, world.latMax);
      const b = world.project(lng, world.latMin);
      lines.push(`M${a.x.toFixed(1)} ${a.y}L${b.x.toFixed(1)} ${b.y}`);
    }
    return lines.join('');
  }

  function drawChart() {
    $('[data-fleet-chart]').innerHTML = `
      <svg viewBox="0 0 ${world.width} ${world.height}" role="img"
           aria-label="Chart of the Paramount fleet at sea" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="fleet-sea" cx="0.5" cy="0.1" r="1.1">
            <stop offset="0" class="sea-lit" />
            <stop offset="1" class="sea-deep" />
          </radialGradient>
        </defs>
        <!-- Drawn well past the plate on purpose. The chart is letterboxed into
             whatever shape the panel is, and an oversized sea fills those bands
             with more ocean instead of a hard edge and a gap. -->
        <rect x="-600" y="-600" width="${world.width + 1200}" height="${world.height + 1200}" fill="url(#fleet-sea)" />
        <path class="fleet-graticule" d="${graticule()}" />
        <path class="fleet-land" d="${world.land}" />
        <g data-fleet-lanes></g>
        <g data-fleet-ports></g>
        <g data-fleet-track></g>
        <g data-fleet-vessels></g>
      </svg>`;
  }

  function drawPorts() {
    const seen = new Set();
    const marks = [];
    state.vessels.forEach((vessel) => {
      (vessel.track || []).forEach((point) => {
        if (point.kind !== 'port' || seen.has(point.code)) return;
        seen.add(point.code);
        const { x, y } = world.project(point.lng, point.lat);
        marks.push(
          `<g class="fleet-port"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" />` +
            `<title>${esc(point.name)}</title></g>`
        );
      });
    });
    $('[data-fleet-ports]').innerHTML = marks.join('');
  }

  /** Every vessel's route, faint, so the chart reads as a network. */
  function drawLanes() {
    $('[data-fleet-lanes]').innerHTML = state.vessels
      .map((vessel) =>
        polylines(vessel.track || [])
          .map((line) => `<path class="fleet-lane" d="${path(line)}" />`)
          .join('')
      )
      .join('');
  }

  /** The selected vessel's route, drawn over the rest. */
  function drawTrack() {
    const vessel = state.vessels.find((v) => v.id === state.selected);
    if (!vessel) {
      $('[data-fleet-track]').innerHTML = '';
      return;
    }
    const labels = (vessel.track || [])
      .filter((p) => p.kind === 'port')
      .map((p) => {
        const { x, y } = world.project(p.lng, p.lat);
        return (
          `<circle class="fleet-track-port" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" />` +
          `<text class="fleet-track-label" x="${(x + 7).toFixed(1)}" y="${(y + 3).toFixed(1)}">${esc(p.name)}</text>`
        );
      })
      .join('');

    $('[data-fleet-track]').innerHTML =
      polylines(vessel.track || [])
        .map((line) => `<path class="fleet-track" d="${path(line)}" />`)
        .join('') + labels;
  }

  function drawVessels(seconds) {
    $('[data-fleet-vessels]').innerHTML = state.vessels
      .map((vessel) => {
        const here = positionAt(vessel, seconds);
        const { x, y } = world.project(here.lng, here.lat);
        const on = vessel.id === state.selected;
        // A hull-shaped marker turned to the vessel's course, so a glance at
        // the chart says which way everything is heading.
        return `
          <g class="fleet-vessel tone-${esc(vessel.tone)}${on ? ' is-on' : ''}${vessel.inPort ? ' is-berthed' : ''}"
             transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"
             data-vessel="${esc(vessel.id)}" tabindex="0" role="button"
             aria-label="${esc(vessel.name)}, ${esc(vessel.typeLabel)}, ${esc(vessel.status)}">
            ${on ? '<circle class="fleet-halo" r="15" />' : ''}
            <circle class="fleet-hit" r="12" />
            <path class="fleet-hull" transform="rotate(${here.course})" d="M0 -8 L3.9 2.5 L0 6.5 L-3.9 2.5 Z" />
          </g>`;
      })
      .join('');
  }

  /* ------------------------------------------------------------- panel --- */

  function fact(label, value) {
    return `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  }

  function drawPanel(seconds) {
    const vessel = state.vessels.find((v) => v.id === state.selected);
    const panel = $('[data-fleet-panel]');
    if (!vessel) {
      panel.innerHTML = '<p class="muted">Pick a vessel on the chart.</p>';
      return;
    }

    const here = positionAt(vessel, seconds);

    panel.innerHTML = `
      <div class="fleet-panel-head">
        <div>
          <span class="fleet-class tone-${esc(vessel.tone)}">${esc(vessel.typeLabel)}</span>
          <h3>${esc(vessel.name)}</h3>
          <p class="mono fleet-voyage">${esc(vessel.voyage)} · ${esc(vessel.flag)}</p>
        </div>
        <span class="fleet-state ${vessel.inPort ? 'is-berthed' : 'is-underway'}">
          <span class="dot"></span>${vessel.inPort ? 'In port' : 'Under way'}
        </span>
      </div>

      <dl class="fleet-facts fleet-position">
        ${fact('Latitude', `<span class="mono">${esc(coordinate(here.lat, 'lat'))}</span>`)}
        ${fact('Longitude', `<span class="mono">${esc(coordinate(here.lng, 'lng'))}</span>`)}
        ${fact('Course', vessel.inPort ? '—' : `<span class="mono">${String(here.course).padStart(3, '0')}°</span>`)}
        ${fact('Speed', `<span class="mono">${vessel.speed.toFixed(1)}</span> kn`)}
      </dl>

      <div class="fleet-leg">
        <div class="fleet-leg-ends">
          <span>${esc(vessel.leg.from)}</span>
          <span>${esc(vessel.leg.to)}</span>
        </div>
        <div class="progress-rail"><span style="width:${Math.max(2, Math.round((here.travelled / vessel._routeNm) * 100))}%"></span></div>
        <div class="fleet-leg-meta">
          <span><b class="mono">${num(Math.round(here.travelled))}</b> nm run</span>
          <span><b class="mono">${num(here.toGo)}</b> nm to go</span>
        </div>
      </div>

      <dl class="fleet-facts">
        ${fact('Next call', esc(vessel.nextPort.name))}
        ${fact('Destination', esc(vessel.destination.name))}
        ${fact('ETA', when(vessel.eta))}
        ${fact('Sailed', when(vessel.departedAt, false))}
        ${fact('IMO', `<span class="mono">${esc(vessel.imo)}</span>`)}
        ${fact('MMSI', `<span class="mono">${esc(vessel.mmsi)}</span>`)}
        ${fact('Call sign', `<span class="mono">${esc(vessel.callsign)}</span>`)}
        ${fact('Built', esc(vessel.built))}
        ${fact('Class', esc(vessel.class))}
        ${fact(vessel.capacityTeu ? 'Capacity' : 'Deadweight', vessel.capacityTeu ? `${num(vessel.capacityTeu)} TEU` : `${num(vessel.dwt)} t`)}
        ${fact('LOA × beam', `<span class="mono">${vessel.loa} × ${vessel.beam}</span> m`)}
        ${fact('Draught', `<span class="mono">${vessel.draught}</span> m`)}
      </dl>

      <p class="fleet-cargo"><strong>On board</strong> ${esc(vessel.cargo)}</p>`;
  }

  /* --------------------------------------------------------------- list --- */

  function drawList() {
    $('[data-fleet-list]').innerHTML = state.vessels
      .map(
        (vessel) => `
        <button type="button" class="fleet-chip tone-${esc(vessel.tone)}${vessel.id === state.selected ? ' is-on' : ''}"
                data-vessel="${esc(vessel.id)}">
          <span class="fleet-chip-mark"></span>
          <span class="fleet-chip-body">
            <strong>${esc(vessel.name)}</strong>
            <span>${esc(vessel.typeLabel)} · ${vessel.inPort ? 'in port' : `${vessel.speed.toFixed(1)} kn`}</span>
          </span>
        </button>`
      )
      .join('');
  }

  function drawLegend() {
    const present = state.types.filter((type) => state.vessels.some((v) => v.type === type.id));
    $('[data-fleet-legend]').innerHTML = present
      .map((type) => `<span class="fleet-key tone-${esc(type.tone)}"><i></i>${esc(type.label)}</span>`)
      .join('');
  }

  function drawCount() {
    const underway = state.vessels.filter((v) => !v.inPort).length;
    $('[data-fleet-count]').innerHTML =
      `<b class="mono">${state.vessels.length}</b> vessels · <b class="mono">${underway}</b> under way`;
  }

  /* -------------------------------------------------------------- wire --- */

  function select(id) {
    state.selected = id;
    drawTrack();
    drawList();
    drawVessels(elapsed());
    drawPanel(elapsed());
  }

  function setLapse(on) {
    state.lapse = on ? LAPSE : 1;
    // Restart the clock from now, so switching does not jump the fleet.
    state.lastSync = Date.now();
    state.vessels.forEach((v) => {
      v.distanceRunNm = v._lastRun == null ? v.distanceRunNm : v._lastRun;
    });
    const button = $('[data-fleet-lapse]');
    if (button) {
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
      // The span, not lastChild: there is a whitespace text node after it, and
      // writing to that appends a second label instead of replacing the first.
      const word = button.querySelector('span');
      if (word) word.textContent = on ? ' Time-lapse' : ' Live';
    }
    root.classList.toggle('is-lapsing', on);
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-fleet-lapse]')) {
      setLapse(state.lapse === 1);
      return;
    }
    const hit = event.target.closest('[data-vessel]');
    if (hit) select(hit.getAttribute('data-vessel'));
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const hit = event.target.closest('[data-vessel]');
    if (!hit) return;
    event.preventDefault();
    select(hit.getAttribute('data-vessel'));
  });

  /* -------------------------------------------------------------- load --- */

  async function sync() {
    const res = await fetch('/api/fleet', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const carried = new Map(state.vessels.map((v) => [v.id, v._lastRun]));
    state.vessels = (data.vessels || []).map((v) => {
      const run = carried.get(v.id);
      return run == null || state.lapse === 1 ? v : { ...v, distanceRunNm: run, _lastRun: run };
    });
    state.ports = data.ports || {};
    state.types = data.types || [];
    state.lastSync = Date.now();
    if (!state.selected || !state.vessels.some((v) => v.id === state.selected)) {
      // Open on something moving: a berthed vessel is a dull first impression.
      state.selected = (state.vessels.find((v) => !v.inPort) || state.vessels[0] || {}).id || null;
    }

    drawLanes();
    drawPorts();
    drawTrack();
    drawVessels(0);
    drawPanel(0);
    drawList();
    drawLegend();
    drawCount();
    root.classList.add('is-ready');
  }

  function tick() {
    if (document.visibilityState !== 'visible') return;
    const seconds = elapsed();
    drawVessels(seconds);
    drawPanel(seconds);
    // Remember how far the time-lapse has carried each vessel, so a poll in
    // the middle of one does not snap the fleet back to where it really is.
    if (state.lapse > 1) {
      state.vessels.forEach((v) => {
        v._lastRun = positionAt(v, seconds).travelled;
      });
    }
  }

  drawChart();

  sync()
    .then(() => {
      // A slow tick is enough for real time; the time-lapse needs a smooth one.
      if (!reduceMotion) {
        setInterval(() => {
          if (state.lapse > 1) tick();
        }, LAPSE_TICK_MS);
        setInterval(() => {
          if (state.lapse === 1) tick();
        }, TICK_MS);
      }
      setInterval(() => {
        if (document.visibilityState === 'visible') sync().catch(() => {});
      }, POLL_MS);
    })
    .catch(() => {
      root.classList.add('is-failed');
      $('[data-fleet-panel]').innerHTML =
        '<p class="muted">The fleet feed is not answering. Tracking a consignment by number still works.</p>';
    });
})();
