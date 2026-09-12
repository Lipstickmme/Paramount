'use strict';

/* =========================================================================
   How a consignment is drawn.

   Shared by /track, where a visitor looks one up by number, and /portal, where
   a customer opens one from their own list. Both show the same thing, because
   there is only one customer-facing view of a consignment and it should not
   drift into two.

   Pure rendering: it takes the object /api/track returns and gives back HTML.
   It fetches nothing and wires nothing.
   ========================================================================= */

(function (global) {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  const MILESTONES = ['pending', 'picked_up', 'in_transit', 'at_facility', 'out_for_delivery', 'delivered'];
  const MILESTONE_LABELS = {
    pending: 'Booked',
    picked_up: 'Collected',
    in_transit: 'In transit',
    at_facility: 'At facility',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
  };

  /* ------------------------------------------------------------ helpers --- */

  /** Dates are shown in the reader's own zone; freight crosses too many. */
  function when(value, { withTime = true } = {}) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  }

  function relative(value) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return '';
    const diff = Date.now() - ms;
    const mins = Math.round(diff / 60000);
    if (Math.abs(mins) < 60) return mins <= 0 ? 'just now' : `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  const place = (city, country) => [city, country].filter(Boolean).map(esc).join(', ') || '—';

  /** True while the consignment is still expected to move. */
  const isMoving = (s) => !s.is_delivered && s.status !== 'cancelled' && s.status !== 'on_hold';

  /* ------------------------------------------------------------- render --- */

  /**
   * The milestone rail.
   *
   * Filled from what actually happened, not from the current status: a
   * consignment sitting in customs has still been collected and has still
   * travelled, and showing those stages as unreached would contradict the
   * timeline directly underneath. The current stage is only marked when the
   * status is a milestone — an off-path state (on hold, exception, cancelled)
   * leaves the rail showing how far it got, with nothing claimed as current.
   */
  function milestoneRail(status, events) {
    const reached = (events || [])
      .map((e) => MILESTONES.indexOf(e.status))
      .concat(MILESTONES.indexOf(status));
    const furthest = Math.max(-1, ...reached);
    const current = MILESTONES.indexOf(status);

    return `
      <div class="milestones">
        ${MILESTONES.map((id, i) => {
          const done = i <= furthest ? 'done' : '';
          const cls = `${done}${i === current ? ' current' : ''}`.trim();
          return `<div class="milestone ${cls}"><i></i><span>${MILESTONE_LABELS[id]}</span></div>`;
        }).join('')}
      </div>`;
  }

  function facts(s) {
    const rows = [
      ['Service', `${esc(s.mode_label)}${s.service_level ? ` · ${esc(s.service_level)}` : ''}`],
      ['Pieces', s.pieces == null ? '—' : esc(s.pieces)],
      ['Weight', s.weight_kg ? `${esc(s.weight_kg)} kg` : '—'],
      ['Dimensions', s.dimensions ? esc(s.dimensions) : '—'],
      ['Package type', s.package_type ? esc(s.package_type) : '—'],
      ['Contents', s.contents ? esc(s.contents) : '—'],
      ['Shipper', s.shipper_name ? esc(s.shipper_name) : '—'],
      ['Consignee', s.receiver_name ? esc(s.receiver_name) : '—'],
      ['Carrier', s.carrier ? esc(s.carrier) : '—'],
      ['Vessel / flight', s.vessel_or_flight ? esc(s.vessel_or_flight) : '—'],
      ['Your reference', s.reference ? esc(s.reference) : '—'],
      ['Booked', when(s.created_at, { withTime: false })],
      ['Collected', when(s.picked_up_at)],
      [s.is_delivered ? 'Delivered' : 'Estimated delivery', when(s.is_delivered ? s.delivered_at : s.estimated_delivery)],
      ['Signed by', s.signed_by ? esc(s.signed_by) : '—'],
      ['Last updated', `${when(s.updated_at)} <span class="muted">(${relative(s.updated_at)})</span>`],
    ];
    return `<dl class="facts">${rows
      .map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('')}</dl>`;
  }

  function timeline(events) {
    if (!events.length) {
      return '<p class="muted">No movements recorded yet. The first scan appears here as soon as the consignment is collected.</p>';
    }
    return `<ol class="timeline">${events
      .map(
        (e) => `
        <li>
          <span class="bead"><b></b></span>
          <div>
            <div class="when">${when(e.occurred_at)} · ${relative(e.occurred_at)}</div>
            <div class="what tone-${esc(e.status_tone || 'go')}">${esc(e.status_label)}</div>
            ${e.location ? `<div class="where">${esc(e.location)}</div>` : ''}
            ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
          </div>
        </li>`
      )
      .join('')}</ol>`;
  }

  /**
   * A schematic of the journey: origin, destination, the recorded scans, and
   * where it is now. Coordinates are optional throughout, so the map is only
   * drawn when there is enough to draw — never a guess.
   */
  function routeMap(s) {
    const points = [];
    if (s.origin_lat != null && s.origin_lng != null) {
      points.push({ lat: +s.origin_lat, lng: +s.origin_lng, kind: 'origin' });
    }
    s.events
      .slice()
      .reverse()
      .forEach((e) => {
        if (e.lat != null && e.lng != null) points.push({ lat: +e.lat, lng: +e.lng, kind: 'scan' });
      });
    if (s.destination_lat != null && s.destination_lng != null) {
      points.push({ lat: +s.destination_lat, lng: +s.destination_lng, kind: 'destination' });
    }
    if (points.length < 2) return '';

    const W = 900;
    const H = 380;
    const pad = 54;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    // A degenerate span (one city, or a due north-south route) would divide by
    // zero, so the extent never shrinks below a couple of degrees.
    const spanLng = Math.max(2, Math.max(...lngs) - Math.min(...lngs));
    const spanLat = Math.max(2, Math.max(...lats) - Math.min(...lats));
    const midLng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
    const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;

    const x = (lng) => pad + ((lng - (midLng - spanLng / 2)) / spanLng) * (W - pad * 2);
    const y = (lat) => pad + (((midLat + spanLat / 2) - lat) / spanLat) * (H - pad * 2);

    const path = points
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.lng).toFixed(1)} ${y(p.lat).toFixed(1)}`)
      .join(' ');

    const travelled = points.filter((p) => p.kind !== 'destination');
    const travelledPath = travelled
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.lng).toFixed(1)} ${y(p.lat).toFixed(1)}`)
      .join(' ');

    const dots = points
      .map((p) => {
        const colour =
          p.kind === 'origin' ? 'var(--accent-2)' : p.kind === 'destination' ? 'var(--accent-3)' : 'var(--ink-3)';
        const r = p.kind === 'scan' ? 3.5 : 6;
        return `<circle cx="${x(p.lng).toFixed(1)}" cy="${y(p.lat).toFixed(1)}" r="${r}" fill="${colour}" />`;
      })
      .join('');

    const nowX = s.current_lng != null ? x(+s.current_lng) : null;
    const nowY = s.current_lat != null ? y(+s.current_lat) : null;
    const now =
      nowX == null || nowY == null
        ? ''
        : `<g>
            <circle cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="7" fill="var(--accent)" />
            <circle cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="7" fill="none" stroke="var(--accent)" stroke-width="1.5">
              <animate attributeName="r" values="7;22" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values=".7;0" dur="2.2s" repeatCount="indefinite" />
            </circle>
          </g>`;

    return `
      <div class="card map-card" data-reveal>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Route from ${esc(s.origin_city)} to ${esc(s.destination_city)}">
          <defs>
            <linearGradient id="route" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="var(--accent-2)" />
              <stop offset="1" stop-color="var(--accent-3)" />
            </linearGradient>
            <pattern id="rdots" width="18" height="18" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.2" fill="currentColor" opacity=".12" />
            </pattern>
          </defs>
          <rect width="${W}" height="${H}" fill="url(#rdots)" color="var(--ink-2)" />
          <path d="${path}" fill="none" stroke="var(--line-strong)" stroke-width="2" stroke-dasharray="4 8" />
          <path d="${travelledPath}" fill="none" stroke="url(#route)" stroke-width="2.6" class="dash" />
          ${dots}
          ${now}
          <text x="${x(points[0].lng).toFixed(1)}" y="${(y(points[0].lat) - 14).toFixed(1)}" text-anchor="middle"
                font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink-2)">${esc(s.origin_city)}</text>
          <text x="${x(points[points.length - 1].lng).toFixed(1)}" y="${(y(points[points.length - 1].lat) + 24).toFixed(1)}" text-anchor="middle"
                font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink-2)">${esc(s.destination_city)}</text>
        </svg>
        <div class="map-legend">
          <span><i style="background:var(--accent-2)"></i>Origin</span>
          <span><i style="background:var(--accent)"></i>Now</span>
          <span><i style="background:var(--accent-3)"></i>Destination</span>
        </div>
      </div>`;
  }

  function render(s) {
    const moving = isMoving(s);
    return `
      <div class="result-head" data-reveal>
        <div class="result-id">
          <div>
            <div class="mono" style="font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-3)">Tracking number</div>
            <div class="result-number">${esc(s.tracking_number)}
              <button type="button" class="result-copy" data-copy="${esc(s.tracking_number)}">Copy</button>
            </div>
          </div>
          <span class="status-badge tone-${esc(s.status_tone)}${moving ? ' live' : ''}">
            <span class="dot"></span>${esc(s.status_label)}
          </span>
        </div>

        <p class="muted">${esc(s.status_blurb)}${s.current_location ? ` Last seen at <strong>${esc(s.current_location)}</strong>.` : ''}</p>

        <div class="route">
          <div class="route-point from">
            <div class="label">From</div>
            <div class="place">${place(s.origin_city, s.origin_country)}</div>
          </div>
          <div class="route-arrow">
            <svg viewBox="0 0 60 24" width="60" height="24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M2 12h50M46 6l6 6-6 6" />
            </svg>
          </div>
          <div class="route-point to">
            <div class="label">To</div>
            <div class="place">${place(s.destination_city, s.destination_country)}</div>
          </div>
        </div>

        <div class="progress-rail${moving ? ' moving' : ''}"><span data-progress="${s.progress}"></span></div>
        ${milestoneRail(s.status, s.events)}
        ${s.instructions ? `<p class="muted"><strong>Note from the desk:</strong> ${esc(s.instructions)}</p>` : ''}
        ${s.special_handling ? `<div><span class="tag">${esc(s.special_handling)}</span></div>` : ''}
      </div>

      <div class="result-grid">
        <div class="card" data-reveal>
          <div class="panel-title"><h3>Movement history</h3><span class="mono muted" style="font-size:.76rem">${s.events.length} event${s.events.length === 1 ? '' : 's'}</span></div>
          ${timeline(s.events)}
        </div>
        <div style="display:grid;gap:20px">
          ${routeMap(s)}
          ${facts(s)}
        </div>
      </div>

      <div class="result-note" data-reveal>
        <strong>Something not right?</strong>
        <span class="muted">Quote ${esc(s.tracking_number)} to the control tower and a named person will pick it up — <a class="link" href="/contact">contact the desk</a> or open the chat.</span>
      </div>`;
  }

  global.PARAMOUNT_TRACK_VIEW = {
    esc,
    when,
    relative,
    place,
    isMoving,
    milestoneRail,
    facts,
    timeline,
    routeMap,
    render,
    MILESTONES,
    MILESTONE_LABELS,
  };
})(window);
