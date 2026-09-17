'use strict';

/* =========================================================================
   A consignment on the world chart.

   The tracking result used to carry a schematic: two dots and a dashed line on
   a dotted field, squeezed into a column. It told you nothing a sentence did
   not already say, and at that size the dots were two pixels across.

   This is the chart the fleet tracker draws — real coastlines, the same
   projection — with one consignment on it: the lane it follows, the scans
   recorded against it, and a marker that moves while the page is open.

   The marker is an estimate between scans, and it never pretends otherwise:
   the panel says which clock it is running on, and a recorded scan always
   wins. src/utils/voyage.js is where that discipline lives.
   ========================================================================= */

(function (global) {
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const TICK_MS = 1000;

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  /* ------------------------------------------------------------ maths --- */

  const EARTH_KM = 6371.0088;
  const KM_PER_NM = 1.852;

  function distanceNm(a, b) {
    const dLat = (b.lat - a.lat) * RAD;
    const dLng = (b.lng - a.lng) * RAD;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return (2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))) / KM_PER_NM;
  }

  function interpolate(a, b, t) {
    const p1 = a.lat * RAD;
    const l1 = a.lng * RAD;
    const p2 = b.lat * RAD;
    const l2 = b.lng * RAD;
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
    const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
    if (d === 0) return { lat: a.lat, lng: a.lng };
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG, lng: Math.atan2(y, x) * DEG };
  }

  function bearing(a, b) {
    const p1 = a.lat * RAD;
    const p2 = b.lat * RAD;
    const dl = (b.lng - a.lng) * RAD;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * DEG + 360) % 360;
  }

  const measure = (points) => {
    const marks = [0];
    for (let i = 1; i < points.length; i += 1) marks.push(marks[i - 1] + distanceNm(points[i - 1], points[i]));
    return marks;
  };

  function pointAt(points, marks, nm) {
    const total = marks[marks.length - 1];
    const want = Math.max(0, Math.min(total, nm));
    let i = 1;
    while (i < marks.length - 1 && marks[i] < want) i += 1;
    const leg = marks[i] - marks[i - 1];
    const t = leg < 1e-6 ? 0 : (want - marks[i - 1]) / leg;
    return { ...interpolate(points[i - 1], points[i], t), course: bearing(points[i - 1], points[i]) };
  }

  /* --------------------------------------------------------- drawing --- */

  /**
   * Unroll a route that crosses the dateline.
   *
   * On an equirectangular plate a leg from 179°E to 179°W is two degrees of
   * water and the whole width of the chart. Cutting the line at the seam draws
   * it correctly but frames it terribly: a Busan-to-Long Beach box ends up as
   * the entire world with the route pinned to both edges and the Pacific — the
   * only ocean that matters here — split down the middle.
   *
   * So instead of cutting the line, the world is unrolled. Longitudes run on
   * past 180 rather than wrapping (Long Beach becomes 241.8°E), the route stays
   * one continuous line, and the frame lands on the water the cargo is actually
   * crossing. The chart draws a second copy of the coastlines one plate-width
   * along to fill the space that creates.
   */
  function unwrap(points) {
    const out = [{ ...points[0] }];
    for (let i = 1; i < points.length; i += 1) {
      let lng = points[i].lng;
      const prev = out[i - 1].lng;
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
      out.push({ ...points[i], lng });
    }
    return out;
  }

  /** Put a loose point (a scan, a port) into the same frame as the route. */
  function intoFrame(p, midLng) {
    let lng = p.lng;
    while (lng - midLng > 180) lng -= 360;
    while (lng - midLng < -180) lng += 360;
    return { ...p, lng };
  }

  /* Densify a leg so a great circle draws as a curve rather than a chord. */
  function densify(points) {
    const out = [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const steps = Math.max(2, Math.min(40, Math.round(distanceNm(a, b) / 120)));
      for (let s = 0; s < steps; s += 1) out.push(interpolate(a, b, s / steps));
    }
    out.push(points[points.length - 1]);
    return out;
  }

  /**
   * The mode's own silhouette, drawn bow-up so a rotation by the course points
   * it where it is going.
   *
   * The ship is a plan view — pointed bow, parallel sides, square stern, rows
   * of boxes and the bridge aft — because a side-on ship rotated to a westerly
   * course is an upside-down ship. Everything else gets the same treatment.
   */
  const GLYPHS = {
    ocean_freight:
      '<path class="cm-hull" d="M0 -13 L3.6 -6.4 L3.6 9.4 L2.6 12 L-2.6 12 L-3.6 9.4 L-3.6 -6.4 Z"/>' +
      '<path class="cm-deck" d="M-2.4 -4.6 h4.8 v2.2 h-4.8 Z M-2.4 -1.6 h4.8 v2.2 h-4.8 Z M-2.4 1.4 h4.8 v2.2 h-4.8 Z"/>' +
      '<path class="cm-house" d="M-2.5 5.2 h5 v3.4 h-5 Z"/>',
    air_freight:
      '<path class="cm-hull" d="M0 -13 L1.7 -7 L1.7 -2 L11 4 L11 6.2 L1.7 3.4 L1.7 8.6 L4.4 11.4 L4.4 12.8 L0 11.6 L-4.4 12.8 L-4.4 11.4 L-1.7 8.6 L-1.7 3.4 L-11 6.2 L-11 4 L-1.7 -2 L-1.7 -7 Z"/>',
    express_courier:
      '<path class="cm-hull" d="M0 -13 L1.7 -7 L1.7 -2 L11 4 L11 6.2 L1.7 3.4 L1.7 8.6 L4.4 11.4 L4.4 12.8 L0 11.6 L-4.4 12.8 L-4.4 11.4 L-1.7 8.6 L-1.7 3.4 L-11 6.2 L-11 4 L-1.7 -2 L-1.7 -7 Z"/>',
    road_haulage:
      '<path class="cm-hull" d="M-3.4 -11 h6.8 a1.4 1.4 0 0 1 1.4 1.4 v6 h-9.6 v-6 A1.4 1.4 0 0 1 -3.4 -11 Z"/>' +
      '<path class="cm-deck" d="M-4.2 -2.4 h8.4 v13.4 h-8.4 Z"/>',
    rail_freight:
      '<path class="cm-hull" d="M-3.6 -12 h7.2 a1.6 1.6 0 0 1 1.6 1.6 v7 h-10.4 v-7 A1.6 1.6 0 0 1 -3.6 -12 Z"/>' +
      '<path class="cm-deck" d="M-3.4 -2.2 h6.8 v6 h-6.8 Z M-3.4 5 h6.8 v6.4 h-6.8 Z"/>',
  };
  const glyph = (mode) => GLYPHS[mode] || GLYPHS.ocean_freight;

  /* ------------------------------------------------------------- draw --- */

  /**
   * Render one consignment onto the chart, and keep its marker moving.
   *
   * Returns a stop() so a page that re-renders — the portal, opening a second
   * consignment — does not leave a timer running against a detached element.
   */
  function mount(host, shipment) {
    const world = global.PARAMOUNT_WORLD;
    const position = shipment && shipment.position;
    if (!host || !world || !position || !Array.isArray(position.route) || position.route.length < 2) return null;

    // Densify first, then unroll: interpolate() returns longitudes through
    // atan2, so it wraps everything back into -180..180 and would undo the
    // unrolling if it ran second.
    const line = unwrap(densify(position.route));
    const marks = measure(line);
    const total = marks[marks.length - 1];
    const midLng = (line[0].lng + line[line.length - 1].lng) / 2;

    // x runs past the plate edge in this frame; y is unchanged.
    const project = (p) => ({
      x: ((p.lng + 180) / 360) * world.width,
      y: world.project(0, p.lat).y,
    });

    const path = (points) =>
      points.map((p, i) => {
        const { x, y } = project(p);
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(' ');

    // Frame on the route rather than showing the whole world: a box between
    // Shanghai and Rotterdam is not helped by an empty Pacific.
    const xs = line.map((p) => project(p).x);
    const ys = line.map((p) => project(p).y);
    const pad = 46;
    let minX = Math.min(...xs) - pad;
    let maxX = Math.max(...xs) + pad;
    let minY = Math.min(...ys) - pad;
    let maxY = Math.max(...ys) + pad;
    // Keep a readable aspect: a short north-south lane would otherwise render
    // as a tall sliver.
    const wantRatio = 2.35;
    let w = Math.max(200, maxX - minX);
    let h = Math.max(90, maxY - minY);
    if (w / h < wantRatio) {
      const grow = (h * wantRatio - w) / 2;
      minX -= grow;
      maxX += grow;
      w = maxX - minX;
    } else {
      const grow = (w / wantRatio - h) / 2;
      minY -= grow;
      maxY += grow;
      h = maxY - minY;
    }

    // Enough copies of the coastlines to cover the frame, since it can now run
    // past either edge of the plate.
    const first = Math.floor(minX / world.width);
    const last = Math.floor(maxX / world.width);
    const lands = [];
    for (let i = first; i <= last; i += 1) {
      lands.push(`<path class="cm-land" transform="translate(${(i * world.width).toFixed(1)} 0)" d="${world.land}" />`);
    }

    const scans = (shipment.events || [])
      .filter((e) => e.lat != null && e.lng != null)
      .map((e) => ({
        ...project(intoFrame({ lat: +e.lat, lng: +e.lng }, midLng)),
        label: e.location || e.status_label,
      }));

    const ends = [
      { p: line[0], label: shipment.origin_city, kind: 'from' },
      { p: line[line.length - 1], label: shipment.destination_city, kind: 'to' },
    ];

    host.innerHTML = `
      <svg class="cm-chart" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}"
           preserveAspectRatio="xMidYMid slice" role="img"
           aria-label="Route from ${esc(shipment.origin_city)} to ${esc(shipment.destination_city)}">
        <rect x="${(minX - 400).toFixed(1)}" y="${(minY - 400).toFixed(1)}"
              width="${(w + 800).toFixed(1)}" height="${(h + 800).toFixed(1)}" class="cm-sea" />
        ${lands.join('')}
        <path class="cm-lane" d="${path(line)}" />
        <path class="cm-run" data-cm-run d="" />
        ${scans.map((s) => `<circle class="cm-scan" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="2.6"><title>${esc(s.label)}</title></circle>`).join('')}
        ${ends.map(({ p, label, kind }) => {
          const { x, y } = project(p);
          return `<g class="cm-end cm-${kind}">
              <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" />
              <text x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="middle">${esc(label || '')}</text>
            </g>`;
        }).join('')}
        <g class="cm-mark${position.moving ? ' is-moving' : ''}" data-cm-mark>
          <circle class="cm-halo" r="13" />
          <g data-cm-glyph>${glyph(position.mode)}</g>
        </g>
      </svg>`;

    const markNode = host.querySelector('[data-cm-mark]');
    const glyphNode = host.querySelector('[data-cm-glyph]');
    const runNode = host.querySelector('[data-cm-run]');
    const readouts = document.querySelectorAll('[data-cm-read]');

    const anchorAlong = Number(position.anchor_along_nm || 0);
    const legNm = Math.max(1, total - anchorAlong);
    const anchorAt = new Date(position.anchor.at).getTime();
    const etaAt = position.eta ? new Date(position.eta).getTime() : null;
    const speedKn = Number(position.speed_kn) || 17;

    /** Where the marker should be at wall-clock time `now`. */
    function atTime(now) {
      if (!position.moving) return { along: total * (position.progress || 0) };
      let share;
      if (etaAt && etaAt > anchorAt) share = (now - anchorAt) / (etaAt - anchorAt);
      else share = ((now - anchorAt) / 3600000) * speedKn / legNm;
      share = Math.max(0, Math.min(1, share));
      return { along: anchorAlong + legNm * share, share };
    }

    function paint(now) {
      const { along } = atTime(now);
      const here = pointAt(line, marks, along);
      const { x, y } = project(intoFrame(here, midLng));
      markNode.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      glyphNode.setAttribute('transform', `rotate(${here.course.toFixed(1)})`);

      // The distance already run, drawn over the lane so the two read as one
      // line with a bright half and a faint one.
      const done = line.filter((p, i) => marks[i] <= along).concat([intoFrame(here, midLng)]);
      runNode.setAttribute('d', path(done));

      const remaining = Math.max(0, total - along);
      readouts.forEach((node) => {
        const key = node.getAttribute('data-cm-read');
        if (key === 'run') node.textContent = Math.round(along).toLocaleString('en-US');
        else if (key === 'remaining') node.textContent = Math.round(remaining).toLocaleString('en-US');
        else if (key === 'lat') node.textContent = formatLat(here.lat);
        else if (key === 'lng') node.textContent = formatLng(here.lng);
        else if (key === 'course') node.textContent = `${String(Math.round(here.course)).padStart(3, '0')}°`;
      });
    }

    paint(Date.now());
    const reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer = null;
    if (position.moving && !reduce) {
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') paint(Date.now());
      }, TICK_MS);
    }
    return () => clearInterval(timer);
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  function formatLat(lat) {
    const abs = Math.abs(lat);
    const d = Math.floor(abs);
    return `${pad2(d)}°${((abs - d) * 60).toFixed(1).padStart(4, '0')}'${lat >= 0 ? 'N' : 'S'}`;
  }
  function formatLng(lng) {
    const abs = Math.abs(lng);
    const d = Math.floor(abs);
    return `${String(d).padStart(3, '0')}°${((abs - d) * 60).toFixed(1).padStart(4, '0')}'${lng >= 0 ? 'E' : 'W'}`;
  }

  global.PARAMOUNT_CONSIGNMENT_MAP = { mount, formatLat, formatLng };
})(window);
