'use strict';

/* =========================================================================
   How a consignment is drawn.

   Shared by /track, where a visitor looks one up by number, and /portal, where
   a customer opens one from their own list. Both show the same thing, because
   there is only one customer-facing view of a consignment and it should not
   drift into two.

   Rendering, almost entirely: it takes the object /api/track returns and
   gives back HTML. The one thing it sends is a request for a photo, wired in
   activate() because both pages would otherwise wire it the same way twice.
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

  /**
   * The consignment's own details.
   *
   * Only what is actually known. A grid of sixteen rows, eleven of them an
   * em dash, says nothing except that the form was long — and on a page whose
   * whole argument is that the record is complete, a wall of blanks argues the
   * opposite. Five rows are always shown because their absence is itself
   * information: service, booked, the delivery date, and who it is between.
   */
  function facts(s) {
    const always = [
      ['Service', `${esc(s.mode_label)}${s.service_level ? ` · ${esc(s.service_level)}` : ''}`],
      ['Booked', when(s.created_at, { withTime: false })],
      [s.is_delivered ? 'Delivered' : 'Estimated delivery', when(s.is_delivered ? s.delivered_at : s.estimated_delivery) || 'To be confirmed'],
      ['Last updated', `${when(s.updated_at)} <span class="muted">(${relative(s.updated_at)})</span>`],
    ];
    const whenKnown = [
      ['Pieces', s.pieces],
      ['Weight', s.weight_kg ? `${esc(s.weight_kg)} kg` : null],
      ['Volume', s.volume_cbm ? `${esc(s.volume_cbm)} cbm` : null],
      ['Dimensions', s.dimensions],
      ['Package type', s.package_type],
      ['Contents', s.contents],
      ['Shipper', s.shipper_name],
      ['Consignee', s.receiver_name],
      ['Carrier', s.carrier],
      ['Vessel / flight', s.vessel_or_flight],
      ['Container / ULD', s.container_no],
      ['Your reference', s.reference],
      ['Collected', when(s.picked_up_at)],
      ['Signed by', s.signed_by],
    ].filter(([, v]) => v != null && v !== '');

    const rows = always.concat(whenKnown.map(([k, v]) => [k, typeof v === 'string' ? esc(v) : esc(String(v))]));
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
   * Why a consignment has stopped, said where somebody looking for it will
   * read it: above the chart, not buried in the timeline.
   *
   * A consignment that has not moved for a week is frightening. The same
   * consignment with "waiting on a corrected certificate of origin, since
   * Tuesday" against it is an errand. This is the difference between the two,
   * and it is the reason the desk is made to give a reason.
   */
  function holdNotice(hold) {
    if (!hold) return '';
    const where = hold.location ? ` at <strong>${esc(hold.location)}</strong>` : '';
    const since = hold.since ? ` since ${when(hold.since)}` : '';
    return `
        <div class="cm-hold">
          <span class="cm-hold-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
              <circle cx="12" cy="12" r="9"/><path d="M9.5 9v6M14.5 9v6"/>
            </svg>
          </span>
          <div>
            <strong>Held${where}${since}.</strong>
            ${hold.reason
              ? `<span>${esc(hold.reason)}</span>`
              : '<span class="muted">The desk has not published a reason yet. Quote the tracking number and someone will tell you.</span>'}
          </div>
        </div>`;
  }

  /**
   * The chart, and the readout beside it.
   *
   * The drawing is done by consignment-map.js against the real coastlines; this
   * only lays out the frame it goes in and the numbers that change as the
   * marker moves. Both come back empty when the server could not say where the
   * consignment is — no origin coordinates, no destination coordinates — and an
   * absent map is better than an invented one.
   */
  function routeMap(s) {
    const p = s.position;
    if (!p || !Array.isArray(p.route) || p.route.length < 2) return '';

    const estimated = p.source === 'estimated';
    const held = p.source === 'held';
    const basis = !estimated
      ? ''
      : p.basis === 'eta'
        ? 'Estimated between scans, paced to the delivery date.'
        : `Estimated between scans at the planned ${p.speed_kn} kn.`;

    const state = held
      ? { className: 'is-held', label: 'Held' }
      : estimated
        ? { className: 'is-estimated', label: 'Estimated position' }
        : { className: 'is-fixed', label: 'Last recorded position' };

    return `
      <section class="cm card" data-reveal>
        <header class="cm-head">
          <div>
            <span class="eyebrow">Where it is</span>
            <h3>${esc(s.origin_city || 'Origin')} &rarr; ${esc(s.destination_city || 'Destination')}</h3>
          </div>
          <span class="cm-state ${state.className}">
            <span class="dot"></span>${state.label}
          </span>
        </header>

        ${held ? holdNotice(p.hold) : ''}

        <div class="cm-stage" data-consignment-map></div>

        <div class="cm-readout">
          <div><dt>Latitude</dt><dd class="mono" data-cm-read="lat">—</dd></div>
          <div><dt>Longitude</dt><dd class="mono" data-cm-read="lng">—</dd></div>
          <div><dt>Course</dt><dd class="mono" data-cm-read="course">—</dd></div>
          <div><dt>Run</dt><dd><b class="mono" data-cm-read="run">—</b> nm</dd></div>
          <div><dt>To go</dt><dd><b class="mono" data-cm-read="remaining">—</b> nm</dd></div>
        </div>

        ${basis ? `<p class="cm-note">${esc(basis)} Every dot on the line is a movement somebody recorded; the marker between them is our reckoning, and the next scan replaces it.</p>` : ''}
        ${held ? '<p class="cm-note">The marker is where it stopped, not where it would have been. It will not move again until the desk releases it, and you will see the release here.</p>' : ''}
      </section>`;
  }

  /**
   * Photos of the cargo, and the way to ask for one.
   *
   * A consignment is a line on a chart and a list of scans; a photo is the
   * first thing that shows the box is real and in one piece. Anyone holding
   * the number can ask, because anyone holding it can already see the rest.
   * Once asked, the panel says so rather than offering the button again —
   * asking twice does not make the desk faster, and it should not look as if
   * it might.
   */
  function photos(s) {
    const list = Array.isArray(s.photos) ? s.photos : [];
    const asked = s.photo_request && s.photo_request.open;
    const canAsk = s.status !== 'cancelled';
    if (!list.length && !canAsk) return '';

    const grid = list.length
      ? `<div class="photo-grid">${list
          .map((p, i) => `
          <a class="photo" href="${esc(p.url)}" target="_blank" rel="noopener" data-photo="${i}">
            <img src="${esc(p.url)}" alt="${esc(p.caption || `Photo of ${s.tracking_number}`)}" loading="lazy" decoding="async" />
            <span class="photo-cap">${p.caption ? esc(p.caption) : when(p.taken_at, { withTime: false })}</span>
          </a>`)
          .join('')}</div>`
      : '';

    let ask = '';
    if (asked) {
      ask = `
        <p class="photo-wait" data-photo-wait>
          <span class="dot"></span>
          A photo was requested ${when(s.photo_request.requested_at, { withTime: false })}. The desk will add it here.
        </p>`;
    } else if (canAsk) {
      ask = `
        <div class="photo-ask" data-photo-ask-wrap>
          <p class="muted">${list.length ? 'Want a newer one?' : 'Want to see it?'} Ask the desk for a photo of the cargo. It appears on this page for anyone with the number.</p>
          <button type="button" class="btn sm ghost" data-photo-ask>Request a photo</button>
          <form class="photo-form" data-photo-form hidden novalidate>
            <div class="field">
              <label for="photo-email">Email <span class="opt">(optional, to hear when it is up)</span></label>
              <input id="photo-email" type="email" name="email" autocomplete="email" placeholder="you@company.com" />
            </div>
            <div class="field">
              <label for="photo-note">Anything in particular? <span class="opt">(optional)</span></label>
              <input id="photo-note" type="text" name="note" maxlength="500" placeholder="The markings on the crates, the seal…" />
            </div>
            <div class="honeypot" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
            <div class="photo-form-actions">
              <button type="submit" class="btn sm">Send request</button>
              <button type="button" class="btn sm ghost" data-photo-cancel>Cancel</button>
            </div>
            <div class="form-status" role="status" aria-live="polite"></div>
          </form>
        </div>`;
    }

    return `
      <section class="card result-panel photos" data-reveal data-photos>
        <div class="panel-title">
          <h3>Photos</h3>
          <span class="mono muted" style="font-size:.76rem">${list.length ? `${list.length} photo${list.length === 1 ? '' : 's'}` : 'None yet'}</span>
        </div>
        ${grid}
        ${ask}
      </section>`;
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

      ${routeMap(s)}

      <div class="result-grid">
        <div class="card result-panel" data-reveal>
          <div class="panel-title"><h3>Movement history</h3><span class="mono muted" style="font-size:.76rem">${s.events.length} event${s.events.length === 1 ? '' : 's'}</span></div>
          ${timeline(s.events)}
        </div>
        <div class="card result-panel" data-reveal>
          <div class="panel-title"><h3>Consignment</h3></div>
          ${facts(s)}
        </div>
      </div>

      ${photos(s)}

      <div class="result-note" data-reveal>
        <strong>Something not right?</strong>
        <span class="muted">Quote ${esc(s.tracking_number)} to the control tower and a named person will pick it up — <a class="link" href="/contact">contact the desk</a> or open the chat.</span>
      </div>`;
  }

  /**
   * Hand a freshly painted result to the chart.
   *
   * Called by whoever wrote the markup — the tracking console, the portal —
   * because only they know when the nodes are in the document. Each call stops
   * the previous chart's clock, so opening a second consignment does not leave
   * a timer ticking against a detached element.
   */
  let stopChart = null;
  function activate(root, shipment) {
    if (stopChart) {
      stopChart();
      stopChart = null;
    }
    wirePhotos(root || document, shipment);
    const stage = (root || document).querySelector('[data-consignment-map]');
    const chart = global.PARAMOUNT_CONSIGNMENT_MAP;
    if (!stage || !chart) return;
    stopChart = chart.mount(stage, shipment);
  }

  /** Open a photo full size in the page, falling back to the link. */
  function viewer() {
    let dialog = document.querySelector('dialog.photo-view');
    if (dialog) return dialog;
    if (typeof HTMLDialogElement !== 'function') return null;
    dialog = document.createElement('dialog');
    dialog.className = 'photo-view';
    dialog.innerHTML = `
      <figure>
        <img alt="" />
        <figcaption></figcaption>
      </figure>
      <button type="button" class="photo-view-close" aria-label="Close">&times;</button>`;
    dialog.querySelector('.photo-view-close').addEventListener('click', () => dialog.close());
    // A click on the backdrop, outside the picture, closes it too.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function wirePhotos(root, s) {
    const panel = root.querySelector('[data-photos]');
    if (!panel || !s) return;

    panel.querySelectorAll('[data-photo]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const dialog = viewer();
        if (!dialog || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        const photo = s.photos[Number(link.getAttribute('data-photo'))] || {};
        const img = dialog.querySelector('img');
        img.src = photo.url;
        img.alt = photo.caption || `Photo of ${s.tracking_number}`;
        dialog.querySelector('figcaption').textContent =
          [photo.caption, when(photo.taken_at)].filter(Boolean).join(' · ');
        dialog.showModal();
      });
    });

    const ask = panel.querySelector('[data-photo-ask]');
    const form = panel.querySelector('[data-photo-form]');
    if (!ask || !form) return;
    const status = form.querySelector('.form-status');
    const send = form.querySelector('button[type="submit"]');

    const open = (on) => {
      form.hidden = !on;
      ask.hidden = on;
      if (on) form.querySelector('input[name="email"]').focus();
    };
    ask.addEventListener('click', () => open(true));
    form.querySelector('[data-photo-cancel]').addEventListener('click', () => open(false));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = form.elements.email.value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        status.className = 'form-status bad';
        status.textContent = 'That email address does not look right. Leave it blank if you would rather not be told.';
        return;
      }
      send.disabled = true;
      status.className = 'form-status';
      status.textContent = 'Sending\u2026';
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(s.tracking_number)}/photo-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            email,
            note: form.elements.note.value.trim(),
            website: form.elements.website.value,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);

        // The request is the consignment's now, not this form's: say so in
        // the same words a reload would, and take the button away.
        s.photo_request = body.request || { open: true, requested_at: new Date().toISOString() };
        const wrap = panel.querySelector('[data-photo-ask-wrap]');
        const done = document.createElement('p');
        done.className = 'photo-wait';
        done.setAttribute('data-photo-wait', '');
        done.innerHTML = `<span class="dot"></span>${esc(body.message || 'Requested. The desk will add a photo here.')}`;
        wrap.replaceWith(done);
      } catch (err) {
        status.className = 'form-status bad';
        status.textContent = err.message;
        send.disabled = false;
      }
    });
  }

  global.PARAMOUNT_TRACK_VIEW = {
    esc,
    activate,
    when,
    relative,
    place,
    isMoving,
    milestoneRail,
    facts,
    timeline,
    routeMap,
    photos,
    render,
    MILESTONES,
    MILESTONE_LABELS,
  };
})(window);
