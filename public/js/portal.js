'use strict';

/* =========================================================================
   Customer portal.

   Sign in, see every consignment on the account, open any of them, and add one
   by tracking number.

   Auth is Supabase, the same client the chat widget and the desk use. The
   consignments themselves come from /api/portal, not from PostgREST: finding
   them means matching an email address across a table customers cannot read,
   and deciding whether that address has been proved — neither of which belongs
   in the browser.
   ========================================================================= */

(function () {
  const helpers = window.PARAMOUNT || {};
  const view = window.PARAMOUNT_TRACK_VIEW;
  const root = document.getElementById('portal');
  if (!root || !view) return;

  const $ = (id) => document.getElementById(id);
  const esc = view.esc;

  const screens = {
    boot: $('portal-boot'),
    unavailable: $('portal-unavailable'),
    auth: $('portal-auth'),
    shell: $('portal-shell'),
  };

  function show(name) {
    Object.keys(screens).forEach((key) => {
      if (screens[key]) screens[key].hidden = key !== name;
    });
    // The signed-out screen is a full-height sign-in panel; once the shell is
    // up there is nothing left in the right column, so the banner collapses to
    // the same slim band the rest of the site opens on.
    document.body.classList.toggle('pm-open', name === 'shell');
  }

  /**
   * POST to our own API, with no session attached.
   *
   * Registration and reset are how somebody gets a session, so there is none to
   * send. Errors come back in the shape the site's other forms use — a message
   * for the person, and `fields` when a particular box is wrong.
   */
  async function post(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `That did not go through (${res.status}).`);
    return body;
  }

  const state = {
    account: null,
    shipments: [],
    counts: { active: 0, delivered: 0, attention: 0 },
    filter: 'all',
    open: null,
    mode: 'signin', // signin | signup | reset
  };

  let client = null;

  /* --------------------------------------------------------------- api --- */

  async function api(method, path, body) {
    const token = await client.auth.accessToken();
    const res = await fetch(path, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ------------------------------------------------------------- auth --- */

  /*
   * Two modes, not three.
   *
   * There is no sign-up. Tracking a consignment needs no account — paste the
   * number on the home page and the timeline and the chart are there — so an
   * account is only worth having when somebody wants every consignment on one
   * list, and those are opened by the desk. Asking a visitor to register, wait
   * for a confirmation email and come back, in order to see something they
   * could already see, is a toll gate in front of an open door.
   *
   * Signing in and resetting a password stay, because the accounts that exist
   * still need both.
   */
  const AUTH_COPY = {
    signin: {
      title: 'Your consignments, in one place.',
      note: 'Sign in to see everything booked to or from your address, and anything you have added by tracking number.',
      action: 'Sign in',
      alt: 'Track a consignment instead',
      altMode: null,
    },
    reset: {
      title: 'Reset your password.',
      note: 'We will email you a link to set a new one.',
      action: 'Send reset link',
      alt: 'Back to sign in',
      altMode: 'signin',
    },
  };

  function renderAuth() {
    const copy = AUTH_COPY[state.mode];
    $('portal-auth-title').textContent = copy.title;
    $('portal-auth-note').textContent = copy.note;
    $('portal-auth-submit').textContent = copy.action;
    $('portal-auth-alt').textContent = copy.alt;
    $('portal-auth-forgot').hidden = state.mode !== 'signin';
    // A reset needs the address only; asking for a password would suggest the
    // old one still matters.
    $('portal-password-field').hidden = state.mode === 'reset';
    $('portal-auth-error').textContent = '';
    $('portal-auth-note-out').textContent = '';
  }

  function authMessage(text, tone) {
    const node = $('portal-auth-note-out');
    node.textContent = text;
    node.className = `form-status${tone ? ` ${tone}` : ''}`;
  }

  async function submitAuth(event) {
    event.preventDefault();
    const email = $('portal-email').value.trim();
    const password = $('portal-password').value;
    const button = $('portal-auth-submit');
    const error = $('portal-auth-error');

    error.textContent = '';
    authMessage('');
    button.disabled = true;

    try {
      if (state.mode === 'signin') {
        // Straight to GoTrue: signing in sends no mail, and a password that
        // does not have to pass through our server should not.
        await client.auth.signInWithPassword(email, password);
        await enter();
      } else {
        const body = await post('/api/portal/reset', { email });
        state.mode = 'signin';
        renderAuth();
        $('portal-email').value = email;
        authMessage(body.message, 'ok');
      }
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  /* ------------------------------------------------------------ render --- */

  const FILTERS = [
    ['all', 'All'],
    ['active', 'In progress'],
    ['attention', 'Needs attention'],
    ['delivered', 'Delivered'],
  ];

  function bucketOf(s) {
    if (s.is_delivered) return 'delivered';
    if (s.status === 'exception' || s.status === 'on_hold') return 'attention';
    if (s.status === 'cancelled') return 'cancelled';
    return 'active';
  }

  function card(s) {
    const last = s.last_event;
    return `
      <article class="pm-card card tilt" data-tilt data-open="${esc(s.tracking_number)}">
        <div class="pm-card-top">
          <span class="mono pm-number">${esc(s.tracking_number)}</span>
          <span class="status-badge tone-${esc(s.status_tone)}${view.isMoving(s) ? ' live' : ''}">
            <span class="dot"></span>${esc(s.status_label)}
          </span>
        </div>
        <div class="pm-route">
          <span>${esc(s.origin_city || '—')}</span>
          <svg viewBox="0 0 40 12" width="40" height="12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <path d="M1 6h32M29 2l4 4-4 4" />
          </svg>
          <span>${esc(s.destination_city || '—')}</span>
        </div>
        <div class="progress-rail${view.isMoving(s) ? ' moving' : ''}"><span style="width:${Math.max(3, s.progress || 0)}%"></span></div>
        <dl class="pm-meta">
          <div><dt>Service</dt><dd>${esc(s.mode_label || '—')}</dd></div>
          <div><dt>${s.is_delivered ? 'Delivered' : 'Estimated'}</dt><dd>${view.when(s.is_delivered ? s.delivered_at : s.estimated_delivery, { withTime: false })}</dd></div>
          <div><dt>Last scan</dt><dd>${last ? esc(last.location || last.status_label) : '—'}</dd></div>
        </dl>
        <div class="pm-card-foot">
          <span class="tag">${s.via === 'claim' ? 'Added by you' : 'On your address'}</span>
          <span class="link">Open <span class="arw">&rsaquo;</span></span>
        </div>
      </article>`;
  }

  function renderList() {
    const list = $('portal-list');
    const rows =
      state.filter === 'all'
        ? state.shipments
        : state.shipments.filter((s) => bucketOf(s) === state.filter);

    $('portal-tabs').innerHTML = FILTERS.map(
      ([id, label]) =>
        `<button type="button" class="pm-tab${state.filter === id ? ' is-active' : ''}" data-filter="${id}">${label}</button>`
    ).join('');

    $('portal-counts').innerHTML = [
      ['In progress', state.counts.active],
      ['Needs attention', state.counts.attention],
      ['Delivered', state.counts.delivered],
    ]
      .map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`)
      .join('');

    if (!state.shipments.length) {
      list.innerHTML = `
        <div class="result-note">
          <strong>Nothing on your account yet.</strong>
          <span class="muted">${
            state.account && state.account.emailMatching
              ? `Consignments booked to or from <strong>${esc(state.account.email)}</strong> appear here on their own. Anything else, add it with its tracking number above.`
              : 'Add a consignment with its tracking number above, and it stays on your account.'
          }</span>
        </div>`;
      return;
    }

    list.innerHTML = rows.length
      ? `<div class="pm-grid">${rows.map(card).join('')}</div>`
      : '<p class="muted">Nothing in this view.</p>';

    if (window.PARAMOUNT_OBSERVE) window.PARAMOUNT_OBSERVE(list);
  }

  function renderAccount() {
    if (!state.account) return;
    $('portal-who').textContent = state.account.email;

    const warn = $('portal-unconfirmed');
    // Worth saying out loud: without a confirmed address the list only holds
    // what they have added themselves, which otherwise looks like a fault.
    const hide = state.account.emailMatching || !state.account.email;
    warn.hidden = hide;
    if (!hide) {
      warn.innerHTML = state.account.emailConfirmed
        ? 'Consignments are matched to accounts by tracking number on this site. Add yours below to keep them here.'
        : `Confirm <strong>${esc(state.account.email)}</strong> from the email we sent, and consignments booked to that address will appear here on their own. Until then, add them by tracking number.`;
    }
  }

  async function openShipment(number) {
    const detail = $('portal-detail');
    state.open = number;
    // One consignment at a time: the list, the filters and the add box are put
    // away while a consignment is open, so what is on screen is unambiguous.
    root.classList.add('is-detail');
    detail.hidden = false;
    detail.innerHTML = '<div class="result-note"><strong>Opening…</strong></div>';
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const data = await api('GET', `/api/portal/shipments/${encodeURIComponent(number)}`);
      detail.innerHTML = `
        <div class="pm-detail-head">
          <button type="button" class="btn ghost sm" data-close>&lsaquo; Back to my consignments</button>
          <button type="button" class="btn ghost sm admin-danger" data-remove="${esc(number)}">Remove from my account</button>
        </div>
        <div class="result">${view.render(data.shipment)}</div>`;
      if (window.PARAMOUNT_OBSERVE) window.PARAMOUNT_OBSERVE(detail);
      if (view.activate) view.activate(detail, data.shipment);
      // The bar animates from zero, so it is set once the node is in the DOM.
      requestAnimationFrame(() => {
        detail.querySelectorAll('[data-progress]').forEach((node) => {
          node.style.width = `${Math.max(3, Number(node.getAttribute('data-progress')) || 0)}%`;
        });
      });
    } catch (err) {
      detail.innerHTML = `<div class="result-note bad"><strong>Could not open that consignment</strong><span class="muted">${esc(err.message)}</span></div>`;
    }
  }

  function closeShipment() {
    state.open = null;
    root.classList.remove('is-detail');
    const detail = $('portal-detail');
    detail.hidden = true;
    detail.innerHTML = '';
  }

  /* ------------------------------------------------------------- load --- */

  async function refresh() {
    const data = await api('GET', '/api/portal/shipments');
    state.account = data.account;
    state.shipments = data.shipments || [];
    state.counts = data.counts || state.counts;
    renderAccount();
    renderList();
  }

  async function enter() {
    const token = await client.auth.accessToken();
    const user = client.auth.user();
    if (!token || !user) return show('auth');

    show('shell');
    // Name the account straight away, from the session we already hold. The
    // list arrives over the network, and painting the identity with it meant
    // the shell appeared saying "Signed in" as nobody in particular until the
    // fetch came back — brief on a desk, not brief on a phone.
    $('portal-who').textContent = user.email || '';

    try {
      await refresh();
    } catch (err) {
      if (err.status === 401) {
        await client.auth.signOut();
        return show('auth');
      }
      $('portal-list').innerHTML = `<div class="result-note bad"><strong>Could not load your consignments</strong><span class="muted">${esc(err.message)}</span></div>`;
    }
    return undefined;
  }

  /* ------------------------------------------------------------- wire --- */

  function wire() {
    $('portal-auth-form').addEventListener('submit', submitAuth);

    // On the sign-in screen the alternative is not another mode — it is the
    // tracking console, which is what most people arriving here actually want.
    $('portal-auth-alt').addEventListener('click', () => {
      const next = AUTH_COPY[state.mode].altMode;
      if (!next) {
        window.location.href = '/#track';
        return;
      }
      state.mode = next;
      renderAuth();
    });

    $('portal-auth-forgot').addEventListener('click', () => {
      state.mode = 'reset';
      renderAuth();
    });

    $('portal-signout').addEventListener('click', async () => {
      await client.auth.signOut();
      // Back to the gate directly rather than through a reload: there is
      // nothing left on the page that a fresh document would fix, and a
      // customer on a slow connection should not watch the site load again to
      // be told they are signed out.
      state.account = null;
      state.shipments = [];
      state.counts = { active: 0, delivered: 0, attention: 0 };
      state.filter = 'all';
      closeShipment();
      $('portal-claim-number').value = '';
      $('portal-claim-status').textContent = '';
      $('portal-password').value = '';
      state.mode = 'signin';
      renderAuth();
      show('auth');
    });

    $('portal-claim-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = $('portal-claim-number');
      const status = $('portal-claim-status');
      const button = $('portal-claim-submit');
      const number = input.value.trim();
      if (!number) return;

      button.disabled = true;
      status.className = 'form-status';
      status.textContent = 'Looking it up…';
      try {
        const data = await api('POST', '/api/portal/claims', { trackingNumber: number });
        input.value = '';
        status.className = 'form-status ok';
        status.textContent = `${data.shipment.tracking_number} added to your account.`;
        await refresh();
      } catch (err) {
        status.className = 'form-status bad';
        status.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });

    $('portal-tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('[data-filter]');
      if (!tab) return;
      state.filter = tab.getAttribute('data-filter');
      renderList();
    });

    $('portal-list').addEventListener('click', (event) => {
      const card = event.target.closest('[data-open]');
      if (card) openShipment(card.getAttribute('data-open'));
    });

    $('portal-detail').addEventListener('click', async (event) => {
      if (event.target.closest('[data-close]')) return closeShipment();

      const remove = event.target.closest('[data-remove]');
      if (!remove) return undefined;
      const number = remove.getAttribute('data-remove');
      if (!window.confirm(`Remove ${number} from your account? The consignment itself is not affected, and you can add it again with its number.`)) {
        return undefined;
      }
      remove.disabled = true;
      try {
        await api('DELETE', `/api/portal/claims/${encodeURIComponent(number)}`);
        closeShipment();
        await refresh();
      } catch (err) {
        remove.disabled = false;
        window.alert(err.message);
      }
      return undefined;
    });
  }

  /* ------------------------------------------------------------- boot --- */

  async function boot() {
    let cfg = {};
    try {
      const res = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
      cfg = await res.json();
    } catch (err) {
      return show('unavailable');
    }

    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.ParamountSupabase) {
      return show('unavailable');
    }

    client = window.ParamountSupabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      // Its own key: a customer signing in here must not displace the
      // anonymous session the chat widget holds on the public pages.
      storageKey: 'pm-customer-auth',
    });

    wire();
    renderAuth();
    await enter();
    return undefined;
  }

  boot();
})();
