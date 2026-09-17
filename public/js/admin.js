'use strict';

/**
 * The desk: consignments, rate requests, enquiries, live chat and company mail.
 *
 * Most of this page is read and written straight from the browser as the
 * signed-in user, so the policies in supabase/migrations decide what is visible
 * rather than a server route we would otherwise have to write and protect
 * twice. Being on the `admins` table is what grants it; revoking someone is a
 * row delete and takes effect on their next request.
 *
 * Consignments are the exception. Creating one has to mint a tracking number
 * and can email the customer, and recording a movement can too — neither of
 * which the browser may do — so the shipment tabs go through /api/shipments,
 * carrying this session's token for the server to check.
 */
(function () {
  const POLL_MS = 5000;

  const $ = (id) => document.getElementById(id);
  const screens = {
    boot: $('admin-boot'),
    unconfigured: $('admin-unconfigured'),
    login: $('admin-login'),
    shell: $('admin-shell'),
  };

  function show(name) {
    Object.keys(screens).forEach((key) => {
      if (screens[key]) screens[key].hidden = key !== name;
    });
  }

  /** True while the cursor is in any field on the page. */
  function isTyping() {
    const node = document.activeElement;
    if (!node) return false;
    return node.tagName === 'TEXTAREA' || node.tagName === 'INPUT' || node.isContentEditable === true;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  /**
   * Escape for the few places below that build markup rather than nodes.
   *
   * The rest of this file uses textContent and never needs this; a suggestion
   * row and the lane strip are markup because they are three spans each and a
   * node tree for them reads worse than the string does.
   */
  const esc = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  function when(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function alertBar(message) {
    const bar = $('admin-alert');
    if (!bar) return;
    bar.textContent = message || '';
    bar.hidden = !message;
  }

  /* ------------------------------------------------------------- state --- */

  let client = null;
  const state = {
    tab: 'shipments',
    shipments: [],
    shipmentEvents: [],
    shipmentQuery: '',
    shipmentStatus: '',
    shipmentsError: '',
    editing: null,
    // A one-shot confirmation. Re-rendering the detail pane destroys the form
    // that raised it, so the message has to outlive the form to be read at all.
    flash: null,
    quotes: [],
    quotesAvailable: true,
    enquiries: [],
    applications: [],
    applicationsSource: 'applications',
    sessions: [],
    threads: [],
    active: { shipments: null, quotes: null, enquiries: null, applications: null, chat: null, email: null },
    messages: [],
    mail: [],
    emailAvailable: true,
    settings: null,
    effective: null,
    drafts: {},
    settingsEditable: true,
  };

  const STATUSES = [
    ['new', 'New'],
    ['in_progress', 'In progress'],
    ['closed', 'Closed'],
  ];

  /* --------------------------------------------------------- consignments --- */

  /**
   * The stages, in the order the customer reads them. Kept in step with
   * src/utils/tracking.js; the server is the authority and rejects anything
   * else, so a drift here is a wrong label rather than a wrong record.
   */
  const SHIPMENT_STATUSES = [
    ['pending', 'Booking registered'],
    ['picked_up', 'Collected'],
    ['in_transit', 'In transit'],
    ['at_facility', 'At facility'],
    ['customs', 'Customs clearance'],
    ['out_for_delivery', 'Out for delivery'],
    ['delivered', 'Delivered'],
    ['on_hold', 'On hold'],
    ['exception', 'Exception'],
    ['cancelled', 'Cancelled'],
  ];

  const MODES = [
    ['air_freight', 'Air freight'],
    ['ocean_freight', 'Ocean freight'],
    ['road_haulage', 'Road haulage'],
    ['rail_freight', 'Rail freight'],
    ['express_courier', 'Express courier'],
    ['warehousing', 'Warehousing & fulfilment'],
  ];

  /*
   * The lists behind the form's dropdowns.
   *
   * Two kinds. A `select` is a closed set the server or the trade defines —
   * mode, payment status, Incoterms — and typing something else into it is a
   * mistake, so the box does not allow it. A `suggest` is an open list: the
   * common answers are one keystroke away and anything else can still be typed,
   * because no list of package types survives contact with real cargo.
   */
  const SERVICE_LEVELS = {
    air_freight: ['Express', 'Standard', 'Deferred', 'Charter', 'Next flight out'],
    ocean_freight: ['FCL 20\u2032', 'FCL 40\u2032', 'FCL 40\u2032 HC', 'FCL 40\u2032 reefer', 'LCL consolidation', 'Break bulk', 'Ro-ro'],
    rail_freight: ['Block train', 'Wagon group', 'FCL 40\u2032 HC', 'LCL consolidation'],
    road_haulage: ['FTL', 'LTL groupage', 'Dedicated vehicle', 'Temperature controlled', 'ADR'],
    express_courier: ['Same day', 'Next day pre-10:00', 'Next day', 'Two day', 'Economy'],
    warehousing: ['Pick and pack', 'Bonded storage', 'Cross-dock', 'Returns handling'],
  };
  const ALL_SERVICE_LEVELS = [...new Set(Object.values(SERVICE_LEVELS).flat())];

  const PACKAGE_TYPES = [
    'Pallets', 'Euro pallets', 'Cartons', 'Crates', 'Drums', 'Bags', 'Rolls',
    'Container FCL', 'Container LCL', 'Loose loaded', 'Air ULD', 'Big bags', 'Bundles',
  ];

  const CURRENCIES = [
    ['USD', 'USD \u2014 US dollar'], ['EUR', 'EUR \u2014 Euro'], ['GBP', 'GBP \u2014 Pound sterling'],
    ['CNY', 'CNY \u2014 Chinese yuan'], ['SGD', 'SGD \u2014 Singapore dollar'], ['AED', 'AED \u2014 UAE dirham'],
    ['JPY', 'JPY \u2014 Japanese yen'], ['INR', 'INR \u2014 Indian rupee'], ['AUD', 'AUD \u2014 Australian dollar'],
    ['CAD', 'CAD \u2014 Canadian dollar'], ['ZAR', 'ZAR \u2014 South African rand'], ['NGN', 'NGN \u2014 Nigerian naira'],
    ['BRL', 'BRL \u2014 Brazilian real'], ['CHF', 'CHF \u2014 Swiss franc'],
  ];

  // Incoterms 2020, in the order the ICC lists them.
  const INCOTERMS = [
    ['EXW', 'EXW \u2014 Ex works'], ['FCA', 'FCA \u2014 Free carrier'], ['CPT', 'CPT \u2014 Carriage paid to'],
    ['CIP', 'CIP \u2014 Carriage and insurance paid to'], ['DAP', 'DAP \u2014 Delivered at place'],
    ['DPU', 'DPU \u2014 Delivered at place unloaded'], ['DDP', 'DDP \u2014 Delivered duty paid'],
    ['FAS', 'FAS \u2014 Free alongside ship'], ['FOB', 'FOB \u2014 Free on board'],
    ['CFR', 'CFR \u2014 Cost and freight'], ['CIF', 'CIF \u2014 Cost, insurance and freight'],
  ];

  const PAYMENT_MODES = [
    ['prepaid', 'Prepaid'], ['collect', 'Collect'], ['third_party', 'Third party'],
    ['account', 'On account'], ['cash_on_delivery', 'Cash on delivery'],
  ];

  const PAYMENT_STATUSES = [
    ['unpaid', 'Unpaid'], ['invoiced', 'Invoiced'], ['part_paid', 'Part paid'],
    ['paid', 'Paid'], ['written_off', 'Written off'],
  ];

  const SPECIAL_HANDLING = [
    'None', 'Temperature controlled', 'Dangerous goods \u2014 IMDG', 'Dangerous goods \u2014 IATA',
    'Out of gauge', 'High value', 'Fragile', 'Live animals', 'Perishable', 'Personal effects',
  ];

  const CARRIERS = {
    ocean_freight: ['Maersk', 'MSC', 'CMA CGM', 'Hapag-Lloyd', 'ONE', 'Evergreen', 'HMM', 'Yang Ming', 'ZIM', 'Paramount consolidation'],
    air_freight: ['Lufthansa Cargo', 'Emirates SkyCargo', 'Qatar Airways Cargo', 'Cathay Cargo', 'Cargolux', 'Turkish Cargo', 'Korean Air Cargo', 'Paramount consolidation'],
    rail_freight: ['DB Cargo', 'RZD Logistics', 'China Railway Express', 'Union Pacific', 'BNSF', 'Canadian National'],
    road_haulage: ['Paramount fleet', 'Girteka', 'Waberer\u2019s', 'DSV Road', 'Contracted haulier'],
    express_courier: ['Paramount Express', 'DHL', 'FedEx', 'UPS', 'TNT'],
    warehousing: ['Paramount contract logistics'],
  };
  const ALL_CARRIERS = [...new Set(Object.values(CARRIERS).flat())];

  const TONE = {
    delivered: 'done',
    cancelled: 'bad',
    exception: 'bad',
    on_hold: 'warn',
    customs: 'wait',
    pending: 'wait',
  };

  const statusLabel = (id) => (SHIPMENT_STATUSES.find(([key]) => key === id) || [id, id])[1];
  const modeLabel = (id) => (MODES.find(([key]) => key === id) || [id, id || '—'])[1];

  /**
   * Every field on a consignment, as the form renders it.
   * [name, label, type, options] — `group` starts a new fieldset.
   */
  const SHIPMENT_FIELDS = [
    { group: 'Service' },
    ['mode', 'Mode', 'select', MODES],
    ['service_level', 'Service level', 'suggest', ALL_SERVICE_LEVELS],
    ['carrier', 'Carrier / partner', 'suggest', ALL_CARRIERS],
    ['vessel_or_flight', 'Vessel or flight', 'text'],
    ['container_no', 'Container / ULD', 'text'],
    ['reference', "Customer's reference", 'text'],

    { group: 'Shipper' },
    ['shipper_name', 'Shipper name *', 'text'],
    ['shipper_company', 'Shipper company', 'text'],
    ['shipper_email', 'Shipper email', 'email'],
    ['shipper_phone', 'Shipper phone', 'tel'],
    ['shipper_address', 'Shipper address', 'text'],

    { group: 'Consignee' },
    ['receiver_name', 'Consignee name *', 'text'],
    ['receiver_company', 'Consignee company', 'text'],
    ['receiver_email', 'Consignee email', 'email'],
    ['receiver_phone', 'Consignee phone', 'tel'],
    ['receiver_address', 'Consignee address', 'text'],

    { group: 'Route', note: 'Type a city or a UN/LOCODE and pick it from the list — the country and the coordinates fill themselves in.' },
    ['origin_city', 'Origin city *', 'place'],
    ['origin_country', 'Origin country', 'text'],
    ['origin_lat', 'Origin latitude', 'number'],
    ['origin_lng', 'Origin longitude', 'number'],
    ['destination_city', 'Destination city *', 'place'],
    ['destination_country', 'Destination country', 'text'],
    ['destination_lat', 'Destination latitude', 'number'],
    ['destination_lng', 'Destination longitude', 'number'],

    { group: 'Cargo' },
    ['package_type', 'Package type', 'suggest', PACKAGE_TYPES],
    ['pieces', 'Pieces', 'number'],
    ['weight_kg', 'Weight (kg)', 'number'],
    ['volume_cbm', 'Volume (cbm)', 'number'],
    ['dimensions', 'Dimensions', 'text'],
    ['contents', 'Contents', 'text'],
    ['declared_value', 'Declared value', 'number'],
    ['currency', 'Currency', 'select', CURRENCIES],
    ['special_handling', 'Special handling', 'suggest', SPECIAL_HANDLING],

    { group: 'Commercial' },
    ['payment_mode', 'Payment mode', 'select', PAYMENT_MODES],
    ['payment_status', 'Payment status', 'select', PAYMENT_STATUSES],
    ['freight_cost', 'Freight cost', 'number'],
    ['incoterms', 'Incoterms', 'select', INCOTERMS],

    { group: 'Dates' },
    ['estimated_delivery', 'Estimated delivery', 'datetime-local'],
    ['departed_at', 'Departed', 'datetime-local'],
    ['picked_up_at', 'Collected', 'datetime-local'],

    { group: 'Notes' },
    ['instructions', 'Note shown to the customer', 'textarea'],
    ['internal_notes', 'Internal notes (never shown)', 'textarea'],
    ['signed_by', 'Signed for by', 'text'],
  ];

  /**
   * A call to the server-side shipment routes, carrying this session's token.
   *
   * Errors are thrown with the server's own message, which is written for the
   * person reading it rather than for a log.
   */
  async function api(method, path, body) {
    const token = await client.auth.accessToken();
    const res = await fetch(path, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  }

  /** A datetime-local box wants 'YYYY-MM-DDTHH:mm' in the reader's own zone. */
  function toLocalInput(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ------------------------------------------------------------ queries --- */

  const loadEnquiries = () =>
    client.select('enquiries', 'select=*&order=created_at.desc&limit=200');

  // Applications filed as enquiries carry this in their discipline field.
  const APPLICATION_MARKER = 'Application: ';

  /**
   * Applications, from wherever they landed.
   *
   * A database created before the applications table existed takes them in
   * `enquiries` instead, so read that back rather than showing an empty tab
   * and losing sight of people who applied.
   */
  async function loadApplications() {
    try {
      const rows = await client.select('applications', 'select=*&order=created_at.desc&limit=200');
      state.applicationsSource = 'applications';
      return rows;
    } catch (err) {
      const rows = await client.select(
        'enquiries',
        `select=*&service=like.${encodeURIComponent(APPLICATION_MARKER)}*&order=created_at.desc&limit=200`
      );
      state.applicationsSource = 'enquiries';
      return rows.map((row) => ({
        id: row.id,
        created_at: row.created_at,
        name: row.name,
        email: row.email,
        phone: null,
        role_title: String(row.service || '').slice(APPLICATION_MARKER.length) || 'Speculative application',
        portfolio: row.company,
        experience: null,
        message: row.message,
        status: row.status,
      }));
    }
  }

  const loadSessions = () =>
    client.select('chat_sessions', 'select=*&order=last_message_at.desc&limit=200');

  const loadMessages = (id) =>
    client.select(
      'chat_messages',
      `select=id,created_at,sender,body&session_id=eq.${id}&order=created_at.asc&limit=500`
    );

  const loadThreads = () =>
    client.select('email_threads', 'select=*&order=last_message_at.desc&limit=200');

  const loadMail = (id) =>
    client.select(
      'email_messages',
      `select=id,created_at,direction,from_email,from_name,to_email,subject,body_text&thread_id=eq.${id}&order=created_at.asc&limit=200`
    );

  /* ------------------------------------------------- consignment queries --- */

  const loadShipments = async () => {
    const params = new URLSearchParams();
    if (state.shipmentQuery) params.set('q', state.shipmentQuery);
    if (state.shipmentStatus) params.set('status', state.shipmentStatus);
    const data = await api('GET', `/api/shipments${params.toString() ? `?${params}` : ''}`);
    return data.shipments || [];
  };

  const loadShipmentEvents = async (id) => (await api('GET', `/api/shipments/${id}/events`)).events || [];

  const loadQuotes = () => client.select('quote_requests', 'select=*&order=created_at.desc&limit=200');

  /* ------------------------------------------------------------ render --- */

  function tallies() {
    const counts = {
      // Not "new": a consignment needs the desk when it is stuck, not when it
      // is young. Anything on hold or in exception is what should carry a dot.
      shipments: state.shipments.filter((r) => r.status === 'on_hold' || r.status === 'exception').length,
      quotes: state.quotes.filter((r) => r.status === 'new').length,
      enquiries: state.enquiries.filter((r) => r.status === 'new').length,
      applications: state.applications.filter((r) => r.status === 'new').length,
      chat: state.sessions.filter((r) => r.status === 'new').length,
      email: state.threads.filter((r) => r.status === 'new').length,
    };
    document.querySelectorAll('[data-tally]').forEach((node) => {
      const key = node.getAttribute('data-tally');
      node.textContent = counts[key];
      node.classList.toggle('is-live', counts[key] > 0);
    });
  }

  function listRow({ id, title, sub, meta, status, activeId, onPick }) {
    const li = el('li');
    const btn = el('button', 'admin-row' + (id === activeId ? ' is-active' : ''));
    btn.type = 'button';

    const head = el('div', 'admin-row-head');
    head.appendChild(el('span', 'admin-row-title', title));
    if (status === 'new') head.appendChild(el('span', 'admin-dot'));
    btn.appendChild(head);
    btn.appendChild(el('span', 'admin-row-sub', sub));
    btn.appendChild(el('span', 'admin-row-meta', meta));

    btn.addEventListener('click', onPick);
    li.appendChild(btn);
    return li;
  }

  function fill(list, rows, empty) {
    list.textContent = '';
    if (!rows.length) {
      list.appendChild(el('li', 'admin-empty', empty));
      return;
    }
    rows.forEach((row) => list.appendChild(row));
  }

  function statusPicker(current, onChange) {
    const wrap = el('div', 'admin-status');
    wrap.appendChild(el('span', 'k', 'Status'));
    const select = el('select');
    STATUSES.forEach(([value, label]) => {
      const option = el('option', null, label);
      option.value = value;
      if (value === current) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
  }

  function renderEnquiries() {
    const list = $('enquiry-list');
    fill(
      list,
      state.enquiries.map((row) =>
        listRow({
          id: row.id,
          title: row.name || 'Enquiry',
          sub: row.email || '',
          meta: when(row.created_at),
          status: row.status,
          activeId: state.active.enquiries,
          onPick: () => {
            state.active.enquiries = row.id;
            renderEnquiries();
          },
        })
      ),
      'No enquiries yet. The contact form opens them.'
    );

    const detail = $('enquiry-detail');
    const row = state.enquiries.find((r) => r.id === state.active.enquiries);
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick an enquiry to read it.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, row.name || 'Enquiry'));
    head.appendChild(
      statusPicker(row.status, async (status) => {
        try {
          await client.update('enquiries', `id=eq.${row.id}`, { status });
          row.status = status;
          renderEnquiries();
          tallies();
        } catch (err) {
          alertBar(err.message);
        }
      })
    );
    detail.appendChild(head);

    const facts = el('dl', 'admin-facts');
    const fact = (k, v, href) => {
      if (!v) return;
      facts.appendChild(el('dt', null, k));
      const dd = el('dd');
      if (href) {
        const a = el('a', null, v);
        a.href = href;
        dd.appendChild(a);
      } else {
        dd.textContent = v;
      }
      facts.appendChild(dd);
    };
    fact('Email', row.email, `mailto:${row.email}?subject=${encodeURIComponent('Re: your enquiry to Paramount Shipping')}`);
    fact('Company', row.company);
    fact('Discipline', row.service);
    fact('Received', when(row.created_at));
    detail.appendChild(facts);

    detail.appendChild(el('p', 'admin-message', row.message));
  }

  function renderApplications() {
    const list = $('application-list');
    fill(
      list,
      state.applications.map((row) =>
        listRow({
          id: row.id,
          title: row.name || 'Applicant',
          sub: row.role_title || 'Speculative application',
          meta: when(row.created_at),
          status: row.status,
          activeId: state.active.applications,
          onPick: () => {
            state.active.applications = row.id;
            renderApplications();
          },
        })
      ),
      'No applications yet. The apply form on /careers opens them.'
    );

    if (state.applicationsSource === 'enquiries' && state.applications.length) {
      const note = el('li', 'admin-empty',
        'These arrived before this database had an applications table, so they are filed as enquiries. Run supabase/migrations/0001_init.sql to give them their own table; nothing already here is lost.');
      list.appendChild(note);
    }

    const detail = $('application-detail');
    const row = state.applications.find((r) => r.id === state.active.applications);
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick an application to read it.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, row.name || 'Applicant'));
    head.appendChild(
      statusPicker(row.status, async (status) => {
        try {
          await client.update(state.applicationsSource, `id=eq.${row.id}`, { status });
          row.status = status;
          renderApplications();
          tallies();
        } catch (err) {
          alertBar(err.message);
        }
      })
    );
    detail.appendChild(head);

    const facts = el('dl', 'admin-facts');
    const fact = (k, v, href) => {
      if (!v) return;
      facts.appendChild(el('dt', null, k));
      const dd = el('dd');
      if (href) {
        const a = el('a', null, v);
        a.href = href;
        if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        dd.appendChild(a);
      } else {
        dd.textContent = v;
      }
      facts.appendChild(dd);
    };
    fact('Role', row.role_title);
    fact('Email', row.email, `mailto:${row.email}?subject=${encodeURIComponent(`Your application: ${row.role_title || 'Paramount Shipping'}`)}`);
    fact('Phone', row.phone, row.phone ? `tel:${row.phone}` : null);
    fact('Experience', row.experience);
    fact('Portfolio', row.portfolio, row.portfolio);
    fact('Received', when(row.created_at));
    detail.appendChild(facts);

    detail.appendChild(el('p', 'admin-message', row.message));
  }

  function renderChat() {
    const list = $('chat-list');
    fill(
      list,
      state.sessions.map((row) =>
        listRow({
          id: row.id,
          title: row.visitor_name || 'Website visitor',
          sub: row.visitor_email || 'No email left',
          meta: when(row.last_message_at),
          status: row.status,
          activeId: state.active.chat,
          onPick: () => {
            state.active.chat = row.id;
            state.messages = [];
            renderChat();
            refreshThread();
          },
        })
      ),
      'No conversations yet. The widget on the public site opens them.'
    );

    const detail = $('chat-detail');
    const row = state.sessions.find((r) => r.id === state.active.chat);
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick a conversation to read and reply.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, row.visitor_name || 'Website visitor'));
    head.appendChild(
      statusPicker(row.status, async (status) => {
        try {
          await client.update('chat_sessions', `id=eq.${row.id}`, { status });
          row.status = status;
          renderChat();
          tallies();
        } catch (err) {
          alertBar(err.message);
        }
      })
    );
    detail.appendChild(head);
    detail.appendChild(el('p', 'admin-sub', `Opened ${when(row.created_at)}`));

    const thread = el('ol', 'admin-thread');
    state.messages.forEach((message) => {
      const li = el('li', 'admin-bubble ' + (message.sender === 'agent' ? 'agent' : 'visitor'));
      li.appendChild(el('p', null, message.body));
      li.appendChild(el('time', null, when(message.created_at)));
      thread.appendChild(li);
    });
    detail.appendChild(thread);
    thread.scrollTop = thread.scrollHeight;

    const form = el('form', 'admin-reply');
    const box = el('textarea');
    box.rows = 2;
    box.placeholder = 'Type a reply';
    box.setAttribute('aria-label', 'Reply');
    // Survives a re-render from any other source, per conversation.
    box.value = state.drafts[row.id] || '';
    box.addEventListener('input', () => {
      state.drafts[row.id] = box.value;
    });
    const send = el('button', 'btn', 'Send');
    send.type = 'submit';
    form.appendChild(box);
    form.appendChild(send);

    const submit = async (event) => {
      if (event) event.preventDefault();
      const body = box.value.trim();
      if (!body) return;
      box.value = '';
      delete state.drafts[row.id];
      send.disabled = true;
      try {
        const rows = await client.insert(
          'chat_messages',
          { session_id: row.id, sender: 'agent', body },
          'id,created_at,sender,body'
        );
        state.messages = state.messages.concat(rows);
        // `handled_by_agent` is what stops the canned responder answering over
        // the top of a real person.
        try {
          await client.update('chat_sessions', `id=eq.${row.id}`, {
            status: 'in_progress',
            handled_by_agent: true,
          });
        } catch (err) {
          await client.update('chat_sessions', `id=eq.${row.id}`, { status: 'in_progress' });
          alertBar('Reply sent. Re-run supabase/migrations/0001_init.sql to add handled_by_agent, or the automatic responder keeps answering.');
        }
        row.status = 'in_progress';
        renderChat();
        tallies();
      } catch (err) {
        box.value = body;
        state.drafts[row.id] = body;
        alertBar(err.message);
      } finally {
        send.disabled = false;
      }
    };

    form.addEventListener('submit', submit);
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    detail.appendChild(form);
  }

  function renderEmail() {
    const list = $('email-list');
    if (!state.emailAvailable) {
      fill(list, [], 'Studio mail is not set up. Run supabase/migrations/0002_email.sql and point Resend Inbound at /api/inbound/resend.');
      $('email-detail').textContent = '';
      return;
    }

    fill(
      list,
      state.threads.map((row) =>
        listRow({
          id: row.id,
          title: row.participant_name || row.participant_email,
          sub: row.subject,
          meta: when(row.last_message_at),
          status: row.status,
          activeId: state.active.email,
          onPick: () => {
            state.active.email = row.id;
            state.mail = [];
            renderEmail();
            refreshThread();
          },
        })
      ),
      'No mail yet.'
    );

    const detail = $('email-detail');
    const row = state.threads.find((r) => r.id === state.active.email);
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick a thread to read it.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, row.subject || '(no subject)'));
    head.appendChild(
      statusPicker(row.status, async (status) => {
        try {
          await client.update('email_threads', `id=eq.${row.id}`, { status });
          row.status = status;
          renderEmail();
          tallies();
        } catch (err) {
          alertBar(err.message);
        }
      })
    );
    detail.appendChild(head);

    detail.appendChild(el('p', 'admin-sub', `Conversation with ${row.participant_email}`));

    const thread = el('ol', 'admin-thread');
    state.mail.forEach((message) => {
      const li = el('li', 'admin-bubble ' + (message.direction === 'outbound' ? 'agent' : 'visitor'));
      li.appendChild(el('p', null, message.body_text || '(no text part)'));
      li.appendChild(el('time', null, `${message.from_email} · ${when(message.created_at)}`));
      thread.appendChild(li);
    });
    detail.appendChild(thread);
    thread.scrollTop = thread.scrollHeight;

    const form = el('form', 'admin-reply');
    const box = el('textarea');
    box.rows = 3;
    box.placeholder = `Reply to ${row.participant_email}`;
    box.setAttribute('aria-label', 'Reply');
    box.value = state.drafts[row.id] || '';
    box.addEventListener('input', () => {
      state.drafts[row.id] = box.value;
    });
    const send = el('button', 'btn', 'Send reply');
    send.type = 'submit';
    form.appendChild(box);
    form.appendChild(send);
    detail.appendChild(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = box.value.trim();
      if (!body) return;
      send.disabled = true;
      try {
        // The one part of this page that goes through the API: sending needs the
        // Resend key, which the browser must never hold.
        const token = await client.auth.accessToken();
        const res = await fetch('/api/emails/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ threadId: row.id, body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `Reply failed (${res.status})`);
        box.value = '';
        delete state.drafts[row.id];
        alertBar('');
        await refreshThread();
      } catch (err) {
        // The draft stays in the box, so a failed send is not lost text.
        alertBar(err.message);
      } finally {
        send.disabled = false;
      }
    });
  }

  /* ------------------------------------------------------ consignments --- */

  /**
   * One labelled control from a SHIPMENT_FIELDS entry.
   *
   * Five kinds, and the difference between two of them is the whole point:
   *
   *   select    a closed set. Mode, Incoterms, payment status — a value outside
   *             the list is a mistake, so the control will not accept one.
   *   suggest   an open list on a datalist. The common answers are one
   *             keystroke away and anything else can still be typed, because no
   *             list of package types survives contact with real cargo.
   *   place     a city, looked up in the gazetteer as it is typed. Picking a row
   *             fills the country and both coordinates beside it.
   *
   * plus the plain text/number/datetime boxes and the textarea.
   */
  function buildField(spec, values) {
    const [name, label, type, options] = spec;
    const wrap = el('div', 'field');
    const id = `ship-${name}`;
    const lab = el('label', null, label);
    lab.htmlFor = id;

    let input;
    if (type === 'select') {
      input = el('select');
      // A blank first row, so a field the desk has not decided yet stays empty
      // rather than silently taking whatever happened to be at the top.
      const blank = el('option', null, '—');
      blank.value = '';
      input.appendChild(blank);
      options.forEach(([value, text]) => {
        const option = el('option', null, text);
        option.value = value;
        input.appendChild(option);
      });
    } else if (type === 'textarea') {
      input = el('textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = type === 'suggest' || type === 'place' ? 'text' : type;
      if (type === 'number') input.step = 'any';
      if (type === 'suggest') {
        const list = el('datalist');
        list.id = `${id}-list`;
        (options || []).forEach((value) => {
          const option = el('option');
          option.value = value;
          list.appendChild(option);
        });
        input.setAttribute('list', list.id);
        input.autocomplete = 'off';
        wrap.appendChild(list);
      }
      if (type === 'place') {
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = 'City or LOCODE, e.g. Rotterdam or NLRTM';
        wrap.classList.add('field-place');
      }
    }

    input.id = id;
    input.name = name;
    const current = values ? values[name] : undefined;
    input.value = type === 'datetime-local' ? toLocalInput(current) : current == null ? '' : String(current);

    wrap.appendChild(lab);
    wrap.appendChild(input);
    if (type === 'place') wrap.appendChild(placeSuggest(input, name));
    return wrap;
  }

  /* ------------------------------------------------- the place lookup --- */

  /** One shared cache: the desk books the same twenty ports all day. */
  const placeCache = new Map();

  async function lookUpPlaces(query) {
    const key = query.toLowerCase();
    if (placeCache.has(key)) return placeCache.get(key);
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json' },
      });
      const body = await res.json();
      const rows = Array.isArray(body.places) ? body.places : [];
      placeCache.set(key, rows);
      return rows;
    } catch (err) {
      return [];   // offline: the box is still a plain text field
    }
  }

  /**
   * The suggestion list under a city box.
   *
   * Hand-rolled rather than a <datalist> because picking a row has to do more
   * than set the text: it fills the country and the two coordinate boxes beside
   * it, and a datalist gives no event that says which row was chosen. Keyboard
   * first — arrows move, Enter takes, Escape closes — since this is a form the
   * desk fills in all day without reaching for the mouse.
   */
  function placeSuggest(input, name) {
    const side = name.startsWith('origin') ? 'origin' : 'destination';
    const list = el('div', 'admin-suggest');
    list.hidden = true;
    let rows = [];
    let active = -1;
    let seq = 0;

    const close = () => {
      list.hidden = true;
      active = -1;
    };

    const paint = () => {
      list.innerHTML = '';
      rows.forEach((place, i) => {
        const row = el('button', `admin-suggest-row${i === active ? ' is-on' : ''}`);
        row.type = 'button';
        row.innerHTML =
          `<span class="admin-suggest-name">${esc(place.name)}</span>` +
          `<span class="admin-suggest-meta">${esc(place.country)}</span>` +
          `<code>${esc(place.locode)}</code>`;
        row.addEventListener('mousedown', (event) => {
          event.preventDefault();   // fires before the input's blur
          take(place);
        });
        list.appendChild(row);
      });
      list.hidden = rows.length === 0;
    };

    /** Fill the city, and everything the city implies. */
    function take(place) {
      input.value = place.name;
      const form = input.form;
      const set = (field, value) => {
        const node = form && form.elements.namedItem(field);
        if (node) node.value = value;
      };
      set(`${side}_country`, place.country);
      set(`${side}_lat`, place.lat);
      set(`${side}_lng`, place.lng);
      input.dataset.locode = place.locode;
      close();
      // Both ends known means the lane is known, so the form can offer the rest.
      input.dispatchEvent(new CustomEvent('place:picked', { bubbles: true, detail: place }));
    }

    let timer = null;
    input.addEventListener('input', () => {
      delete input.dataset.locode;
      clearTimeout(timer);
      const query = input.value.trim();
      if (query.length < 2) return close();
      // A short pause, so typing "rotterdam" is one request rather than eight.
      timer = setTimeout(async () => {
        const mine = ++seq;
        const found = await lookUpPlaces(query);
        if (mine !== seq || document.activeElement !== input) return;
        rows = found;
        active = -1;
        paint();
      }, 140);
    });

    input.addEventListener('keydown', (event) => {
      if (list.hidden || !rows.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = (active + (event.key === 'ArrowDown' ? 1 : rows.length - 1) + rows.length) % rows.length;
        paint();
      } else if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        take(rows[active]);
      } else if (event.key === 'Escape') {
        close();
      }
    });

    input.addEventListener('blur', () => setTimeout(close, 120));
    return list;
  }

  /* --------------------------------------------------- the quick fill --- */

  /**
   * What the form can work out for itself once it knows the lane.
   *
   * A booking is mostly implied by three things: where it starts, where it ends
   * and what mode it goes by. The server derives the rest from the gazetteer —
   * the mode this lane usually books, the distance, a transit time — and this
   * offers the result as a strip above the form: what it worked out, and one
   * button to accept it.
   *
   * Two rules make this safe to use in a hurry.
   *
   *   It never overwrites. A box the desk has already filled in is left alone,
   *   every time. Only empty boxes take a suggestion.
   *
   *   It never saves. Everything it fills in is a default sitting in a form the
   *   desk still has to read and submit, and every one of them can be corrected
   *   now or after the booking is out.
   */
  function wireQuickFill(form) {
    const strip = el('div', 'admin-quickfill');
    strip.hidden = true;
    const summary = el('div', 'admin-quickfill-read');
    const apply = el('button', 'btn sm', 'Fill the blanks');
    apply.type = 'button';
    strip.appendChild(summary);
    strip.appendChild(apply);

    const routeHeading = Array.from(form.querySelectorAll('.admin-form-group'))
      .find((node) => node.textContent === 'Route');
    if (routeHeading && routeHeading.nextSibling) {
      form.insertBefore(strip, routeHeading.nextSibling.nextSibling || routeHeading.nextSibling);
    } else {
      form.insertBefore(strip, form.firstChild);
    }

    const value = (name) => {
      const node = form.elements.namedItem(name);
      return node ? String(node.value || '').trim() : '';
    };
    /** Fill a box only if the desk has left it empty. */
    const fillIfBlank = (name, next) => {
      const node = form.elements.namedItem(name);
      if (!node || next == null || next === '') return false;
      if (String(node.value || '').trim()) return false;
      node.value = next;
      node.classList.add('is-filled');
      setTimeout(() => node.classList.remove('is-filled'), 1400);
      return true;
    };

    let lane = null;
    let seq = 0;

    async function refresh() {
      const from = value('origin_city');
      const to = value('destination_city');
      if (!from || !to) {
        strip.hidden = true;
        return;
      }
      const mine = ++seq;
      try {
        const res = await fetch(
          `/api/places/lane?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { headers: { Accept: 'application/json' } }
        );
        const body = await res.json();
        if (mine !== seq) return;
        // `lane: null` means the gazetteer does not carry one of the two
        // places — a normal answer, not a failure. Say so and offer nothing.
        if (!res.ok || body.lane === null) {
          lane = null;
          strip.hidden = false;
          summary.innerHTML = `<span class="muted">${esc(body.message || 'That lane is not in the gazetteer.')}</span>`;
          apply.hidden = true;
          return;
        }
        lane = body;
        apply.hidden = false;
        strip.hidden = false;
        const eta = new Date(Date.now() + lane.transit_days * 86400000);
        summary.innerHTML =
          `<strong>${esc(lane.mode_label)}</strong>` +
          `<span><b class="mono">${lane.routed_nm.toLocaleString('en-US')}</b> nm routed</span>` +
          `<span><b class="mono">${lane.transit_days}</b> days transit</span>` +
          `<span>due <b class="mono">${eta.toISOString().slice(0, 10)}</b></span>` +
          `<span class="muted">${esc(lane.basis)}</span>`;
      } catch (err) {
        strip.hidden = true;
      }
    }

    apply.addEventListener('click', () => {
      if (!lane) return;
      let filled = 0;
      const mode = value('mode') || lane.mode;

      filled += fillIfBlank('mode', lane.mode) ? 1 : 0;
      filled += fillIfBlank('origin_country', lane.origin.country) ? 1 : 0;
      filled += fillIfBlank('origin_lat', lane.origin.lat) ? 1 : 0;
      filled += fillIfBlank('origin_lng', lane.origin.lng) ? 1 : 0;
      filled += fillIfBlank('destination_country', lane.destination.country) ? 1 : 0;
      filled += fillIfBlank('destination_lat', lane.destination.lat) ? 1 : 0;
      filled += fillIfBlank('destination_lng', lane.destination.lng) ? 1 : 0;

      const levels = SERVICE_LEVELS[mode] || [];
      filled += fillIfBlank('service_level', levels[0]) ? 1 : 0;
      filled += fillIfBlank('carrier', (CARRIERS[mode] || [])[0]) ? 1 : 0;
      filled += fillIfBlank('package_type', lane.containerised ? 'Container FCL' : 'Pallets') ? 1 : 0;
      // Incoterms that match who controls the cargo on each mode: sea and rail
      // quote CIF as a matter of course, everything else moves on DAP.
      filled += fillIfBlank('incoterms', lane.containerised ? 'CIF' : 'DAP') ? 1 : 0;

      const eta = new Date(Date.now() + lane.transit_days * 86400000);
      eta.setHours(17, 0, 0, 0);
      filled += fillIfBlank('estimated_delivery', toLocalInput(eta.toISOString())) ? 1 : 0;

      apply.textContent = filled ? `Filled ${filled} field${filled === 1 ? '' : 's'}` : 'Nothing left blank';
      setTimeout(() => (apply.textContent = 'Fill the blanks'), 2200);
    });

    // A picked city, a typed city, or a changed mode all move the lane.
    form.addEventListener('place:picked', refresh);
    ['origin_city', 'destination_city'].forEach((name) => {
      const node = form.elements.namedItem(name);
      if (node) node.addEventListener('change', refresh);
    });
    const modeNode = form.elements.namedItem('mode');
    if (modeNode) modeNode.addEventListener('change', refresh);
    refresh();
  }

  /**
   * The booking form, used for both creating and correcting a consignment.
   *
   * On create the server mints the tracking number; on edit it refuses a status
   * change, because moving a consignment is an event, not a field.
   */
  function shipmentForm(existing) {
    const form = el('form', 'admin-ship-form');
    const values = existing || {
      mode: 'ocean_freight', pieces: 1, currency: 'USD',
      payment_mode: 'prepaid', payment_status: 'unpaid',
    };

    SHIPMENT_FIELDS.forEach((spec) => {
      if (spec.group) {
        form.appendChild(el('h4', 'admin-form-group', spec.group));
        if (spec.note) form.appendChild(el('p', 'admin-form-note', spec.note));
        return;
      }
      // Status belongs to the movement form, so it is not offered here.
      if (existing && spec[0] === 'status') return;
      form.appendChild(buildField(spec, values));
    });

    wireQuickFill(form);

    const status = el('div', 'form-status');
    const actions = el('div', 'admin-form-actions');
    const save = el('button', 'btn', existing ? 'Save changes' : 'Create consignment');
    save.type = 'submit';
    const cancel = el('button', 'btn ghost sm', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      state.editing = null;
      render();
    });
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(status);
    form.appendChild(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.className = 'form-status';
      status.textContent = existing ? 'Saving…' : 'Creating and allocating a tracking number…';

      const payload = {};
      SHIPMENT_FIELDS.forEach((spec) => {
        if (spec.group) return;
        const [name, , type] = spec;
        const node = form.elements.namedItem(name);
        if (!node) return;
        const raw = String(node.value || '').trim();
        if (!raw) {
          // An empty box on an edit clears the column; on a create it is simply
          // a field the desk did not fill in.
          payload[name] = existing ? null : undefined;
          return;
        }
        payload[name] = type === 'datetime-local' ? new Date(raw).toISOString() : type === 'number' ? Number(raw) : raw;
      });

      try {
        if (existing) {
          const data = await api('PATCH', `/api/shipments/${existing.id}`, payload);
          state.shipments = state.shipments.map((row) => (row.id === existing.id ? data.shipment : row));
          state.flash = { tone: 'ok', text: 'Saved. The public tracking page reflects this immediately.' };
        } else {
          const data = await api('POST', '/api/shipments', payload);
          state.shipments.unshift(data.shipment);
          state.active.shipments = data.shipment.id;
          const mailed = data.notified && data.notified.customer;
          state.flash = {
            tone: 'ok',
            text: `Created ${data.shipment.tracking_number}.${mailed ? ' The shipper and consignee were emailed the number.' : ''}`,
          };
        }
        state.editing = null;
        await refreshShipmentDetail();
        render();
      } catch (err) {
        status.className = 'form-status bad';
        status.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    });

    return form;
  }

  /** The movement form: the only way a consignment's status changes. */
  function movementForm(shipment) {
    const form = el('form', 'admin-move-form');
    form.appendChild(el('h4', 'admin-form-group', 'Record a movement'));

    const row = el('div', 'admin-move-row');
    const select = el('select');
    SHIPMENT_STATUSES.forEach(([value, text]) => {
      const option = el('option', null, text);
      option.value = value;
      select.appendChild(option);
    });
    // Default to the next stage rather than the one it is already in, since
    // recording a movement usually means it has moved on.
    const index = SHIPMENT_STATUSES.findIndex(([id]) => id === shipment.status);
    select.value = SHIPMENT_STATUSES[Math.min(index + 1, 6)] ? SHIPMENT_STATUSES[Math.min(index + 1, 6)][0] : shipment.status;
    select.name = 'status';

    const location = document.createElement('input');
    location.type = 'text';
    location.name = 'location';
    location.placeholder = 'Where — Algeciras, or ESALG';
    location.autocomplete = 'off';
    location.spellcheck = false;
    location.value = '';

    // The same gazetteer the booking form uses. A movement with coordinates is
    // a movement the customer can see on the chart, so making them free is the
    // difference between a map that fills in and one that stays empty.
    const pick = el('div', 'field-place move-place');
    pick.appendChild(location);
    pick.appendChild(placeSuggest(location, 'move'));

    row.appendChild(select);
    row.appendChild(pick);
    form.appendChild(row);

    const coords = el('div', 'admin-move-row');
    const lat = document.createElement('input');
    lat.type = 'number';
    lat.step = 'any';
    lat.name = 'lat';
    lat.placeholder = 'Latitude (optional)';
    const lng = document.createElement('input');
    lng.type = 'number';
    lng.step = 'any';
    lng.name = 'lng';
    lng.placeholder = 'Longitude (optional)';
    coords.appendChild(lat);
    coords.appendChild(lng);
    form.appendChild(coords);

    // placeSuggest fills `<side>_lat` / `<side>_lng`; here the side is "move",
    // and the movement form's boxes are plain lat/lng, so the pick is relayed.
    location.addEventListener('place:picked', (event) => {
      const place = event.detail;
      location.value = `${place.name}, ${place.country}`;
      lat.value = place.lat;
      lng.value = place.lng;
    });

    const note = el('textarea');
    note.name = 'note';
    note.rows = 2;
    note.placeholder = 'Note shown on the customer timeline';
    form.appendChild(note);

    const options = el('label', 'admin-check');
    const internal = document.createElement('input');
    internal.type = 'checkbox';
    internal.name = 'internal';
    options.appendChild(internal);
    options.appendChild(document.createTextNode(' Internal only — not shown to the customer, and no email sent'));
    form.appendChild(options);

    const status = el('div', 'form-status');
    const send = el('button', 'btn', 'Record movement');
    send.type = 'submit';
    form.appendChild(status);
    form.appendChild(send);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      send.disabled = true;
      status.className = 'form-status';
      status.textContent = 'Recording…';
      try {
        const data = await api('POST', `/api/shipments/${shipment.id}/events`, {
          status: select.value,
          location: location.value.trim() || null,
          lat: lat.value === '' ? null : Number(lat.value),
          lng: lng.value === '' ? null : Number(lng.value),
          note: note.value.trim() || null,
          internal: internal.checked,
        });
        state.shipments = state.shipments.map((row) => (row.id === shipment.id ? data.shipment : row));
        state.shipmentEvents = await loadShipmentEvents(shipment.id);
        const sent = data.notified && data.notified.ok;
        state.flash = {
          tone: 'ok',
          text: sent
            ? `Recorded: ${statusLabel(select.value)}. The customer was emailed (${data.notified.recipients} recipient(s)).`
            : `Recorded: ${statusLabel(select.value)}. No customer email was sent.`,
        };
        location.value = '';
        note.value = '';
        render();
      } catch (err) {
        status.className = 'form-status bad';
        status.textContent = err.message;
      } finally {
        send.disabled = false;
      }
    });

    return form;
  }

  function renderShipments() {
    const list = $('shipment-list');
    const detail = $('shipment-detail');

    /* -- the list, with its search box and status filter ------------------ */
    list.textContent = '';

    const tools = el('li', 'admin-tools');
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search number, party, city, reference…';
    search.value = state.shipmentQuery;
    search.addEventListener('input', () => {
      state.shipmentQuery = search.value.trim();
      clearTimeout(search._timer);
      search._timer = setTimeout(refreshShipments, 260);
    });

    const filter = el('select');
    [['', 'Every status'], ...SHIPMENT_STATUSES].forEach(([value, text]) => {
      const option = el('option', null, text);
      option.value = value;
      filter.appendChild(option);
    });
    filter.value = state.shipmentStatus;
    filter.addEventListener('change', () => {
      state.shipmentStatus = filter.value;
      refreshShipments();
    });

    const create = el('button', 'btn sm', 'New consignment');
    create.type = 'button';
    create.addEventListener('click', () => {
      state.editing = 'new';
      state.active.shipments = null;
      render();
    });

    tools.appendChild(search);
    tools.appendChild(filter);
    tools.appendChild(create);
    list.appendChild(tools);

    if (state.shipmentsError) {
      list.appendChild(el('li', 'admin-empty', state.shipmentsError));
    } else if (!state.shipments.length) {
      list.appendChild(
        el('li', 'admin-empty', state.shipmentQuery || state.shipmentStatus
          ? 'No consignment matches that.'
          : 'No consignments yet. Create the first one to allocate a tracking number.')
      );
    }

    state.shipments.forEach((row) => {
      const li = el('li');
      const btn = el('button', 'admin-row' + (row.id === state.active.shipments ? ' is-active' : ''));
      btn.type = 'button';

      const headRow = el('div', 'admin-row-head');
      headRow.appendChild(el('strong', 'mono', row.tracking_number));
      headRow.appendChild(el('span', `admin-chip tone-${TONE[row.status] || 'go'}`, statusLabel(row.status)));
      btn.appendChild(headRow);
      btn.appendChild(el('span', 'admin-row-sub', `${row.origin_city || '?'} → ${row.destination_city || '?'}`));
      btn.appendChild(
        el('span', 'admin-row-meta', `${modeLabel(row.mode)} · ${row.receiver_name || '—'} · ${when(row.updated_at || row.created_at)}`)
      );

      btn.addEventListener('click', async () => {
        state.active.shipments = row.id;
        state.editing = null;
        state.flash = null;
        render();
        await refreshShipmentDetail();
        render();
      });

      li.appendChild(btn);
      list.appendChild(li);
    });

    /* -- the detail pane -------------------------------------------------- */
    detail.textContent = '';

    if (state.flash) {
      detail.appendChild(el('p', `form-status ${state.flash.tone}`, state.flash.text));
      // Shown once: it describes something that has already happened, and it
      // should not still be on screen two consignments later.
      state.flash = null;
    }

    if (state.editing === 'new') {
      detail.appendChild(el('h2', null, 'New consignment'));
      detail.appendChild(el('p', 'admin-sub',
        'A tracking number is allocated on save. The shipper and consignee are emailed it when they have an address and the setting is on.'));
      detail.appendChild(shipmentForm(null));
      return;
    }

    const shipment = state.shipments.find((row) => row.id === state.active.shipments);
    if (!shipment) {
      detail.appendChild(el('p', 'admin-empty', 'Pick a consignment, or create one.'));
      return;
    }

    if (state.editing === shipment.id) {
      detail.appendChild(el('h2', 'mono', shipment.tracking_number));
      detail.appendChild(el('p', 'admin-sub', 'Correcting the file. To move it, close this and record a movement instead.'));
      detail.appendChild(shipmentForm(shipment));
      return;
    }

    const head = el('div', 'admin-detail-head');
    const title = el('div');
    title.appendChild(el('h2', 'mono', shipment.tracking_number));
    title.appendChild(el('span', 'admin-sub', `${shipment.origin_city || '?'} → ${shipment.destination_city || '?'} · ${modeLabel(shipment.mode)}`));
    head.appendChild(title);
    head.appendChild(el('span', `admin-chip tone-${TONE[shipment.status] || 'go'}`, statusLabel(shipment.status)));
    detail.appendChild(head);

    const actions = el('div', 'admin-form-actions');
    const view = el('a', 'btn ghost sm', 'Open public tracking');
    view.href = `/?number=${encodeURIComponent(shipment.tracking_number)}#track`;
    view.target = '_blank';
    view.rel = 'noopener';
    const edit = el('button', 'btn ghost sm', 'Edit details');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      state.editing = shipment.id;
      render();
    });
    const copy = el('button', 'btn ghost sm', 'Copy number');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(shipment.tracking_number).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy number'), 1500);
      }, () => {});
    });
    const remove = el('button', 'btn ghost sm admin-danger', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      // Deleting takes the customer's timeline with it, so it asks first.
      if (!window.confirm(`Delete ${shipment.tracking_number} and its whole movement history? This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/shipments/${shipment.id}`);
        state.shipments = state.shipments.filter((row) => row.id !== shipment.id);
        state.active.shipments = null;
        state.shipmentEvents = [];
        render();
      } catch (err) {
        alertBar(err.message);
      }
    });
    actions.appendChild(view);
    actions.appendChild(edit);
    actions.appendChild(copy);
    actions.appendChild(remove);
    detail.appendChild(actions);

    detail.appendChild(movementForm(shipment));

    /* -- the file, and the history ---------------------------------------- */
    const facts = el('dl', 'admin-facts');
    const fact = (key, value) => {
      if (value == null || value === '') return;
      facts.appendChild(el('dt', null, key));
      facts.appendChild(el('dd', null, value));
    };
    fact('Shipper', [shipment.shipper_name, shipment.shipper_company].filter(Boolean).join(' · '));
    fact('Shipper contact', [shipment.shipper_email, shipment.shipper_phone].filter(Boolean).join(' · '));
    fact('Consignee', [shipment.receiver_name, shipment.receiver_company].filter(Boolean).join(' · '));
    fact('Consignee contact', [shipment.receiver_email, shipment.receiver_phone].filter(Boolean).join(' · '));
    fact('Delivery address', shipment.receiver_address);
    fact('Now at', shipment.current_location);
    fact('Cargo', [
      shipment.pieces ? `${shipment.pieces} pc` : null,
      shipment.weight_kg ? `${shipment.weight_kg} kg` : null,
      shipment.package_type,
      shipment.dimensions,
    ].filter(Boolean).join(' · '));
    fact('Contents', shipment.contents);
    fact('Carrier', [shipment.carrier, shipment.vessel_or_flight, shipment.container_no].filter(Boolean).join(' · '));
    fact('Commercial', [
      shipment.payment_mode,
      shipment.payment_status,
      shipment.freight_cost ? `${shipment.freight_cost} ${shipment.currency || ''}`.trim() : null,
      shipment.incoterms,
    ].filter(Boolean).join(' · '));
    fact('Reference', shipment.reference);
    fact('Booked', when(shipment.created_at));
    fact('Estimated delivery', when(shipment.estimated_delivery));
    fact('Delivered', when(shipment.delivered_at));
    fact('Signed by', shipment.signed_by);
    fact('Customer note', shipment.instructions);
    fact('Internal notes', shipment.internal_notes);
    detail.appendChild(facts);

    detail.appendChild(el('h4', 'admin-form-group', `Movement history (${state.shipmentEvents.length})`));
    if (!state.shipmentEvents.length) {
      detail.appendChild(el('p', 'admin-empty', 'No movements recorded yet.'));
    } else {
      const history = el('ol', 'admin-thread');
      state.shipmentEvents.forEach((event) => {
        const li = el('li', 'admin-bubble ' + (event.internal ? 'visitor' : 'agent'));
        li.appendChild(el('strong', null, statusLabel(event.status) + (event.internal ? ' · internal' : '')));
        if (event.location) li.appendChild(el('div', null, event.location));
        if (event.note) li.appendChild(el('div', 'admin-note-text', event.note));
        li.appendChild(el('time', null, when(event.occurred_at)));
        history.appendChild(li);
      });
      detail.appendChild(history);
    }
  }

  /* ------------------------------------------------------ rate requests --- */

  function renderQuotes() {
    const list = $('quote-list');
    const detail = $('quote-detail');

    if (!state.quotesAvailable) {
      fill(list, [], 'This database has no quote_requests table. Run supabase/migrations/0003_shipments.sql to file rate requests here; until then they arrive by email only.');
      detail.textContent = '';
      detail.appendChild(el('p', 'admin-empty', 'Nothing to show.'));
      return;
    }

    fill(
      list,
      state.quotes.map((row) =>
        listRow({
          id: row.id,
          title: `${row.origin || '?'} → ${row.destination || '?'}`,
          sub: `${row.name}${row.company ? ` · ${row.company}` : ''}`,
          meta: `${modeLabel(row.mode)} · ${when(row.created_at)}`,
          status: row.status,
          activeId: state.active.quotes,
          onPick: () => {
            state.active.quotes = row.id;
            render();
          },
        })
      ),
      'No rate requests yet.'
    );

    detail.textContent = '';
    const row = state.quotes.find((r) => r.id === state.active.quotes);
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick a rate request to read it.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    const title = el('div');
    title.appendChild(el('h2', null, `${row.origin || '?'} → ${row.destination || '?'}`));
    title.appendChild(el('span', 'admin-sub', when(row.created_at)));
    head.appendChild(title);
    head.appendChild(
      statusPicker(row.status, async (value) => {
        await client.update('quote_requests', `id=eq.${row.id}`, { status: value });
        row.status = value;
        render();
      })
    );
    detail.appendChild(head);

    const facts = el('dl', 'admin-facts');
    const fact = (key, value, href) => {
      if (!value) return;
      facts.appendChild(el('dt', null, key));
      const dd = el('dd');
      if (href) {
        const a = el('a', null, value);
        a.href = href;
        dd.appendChild(a);
      } else {
        dd.textContent = value;
      }
      facts.appendChild(dd);
    };
    fact('Name', row.name);
    fact('Company', row.company);
    fact('Email', row.email, `mailto:${row.email}?subject=${encodeURIComponent(`Rates: ${row.origin || ''} to ${row.destination || ''}`)}`);
    fact('Phone', row.phone, `tel:${String(row.phone || '').replace(/\s+/g, '')}`);
    fact('Service', modeLabel(row.mode));
    fact('Cargo', row.cargo_type);
    fact('Weight', row.weight_kg ? `${row.weight_kg} kg` : '');
    fact('Pieces', row.pieces ? String(row.pieces) : '');
    fact('Dimensions', row.dimensions);
    fact('Ready on', row.ready_date);
    fact('Incoterms', row.incoterms);
    detail.appendChild(facts);

    if (row.message) detail.appendChild(el('p', 'admin-body-text', row.message));

    const convert = el('button', 'btn sm', 'Book this as a consignment');
    convert.type = 'button';
    convert.addEventListener('click', () => {
      // Carry what the customer already told us into the booking form, so the
      // desk is not retyping a rate request it has just read.
      state.tab = 'shipments';
      state.editing = 'new';
      state.active.shipments = null;
      render();
      const form = $('shipment-detail').querySelector('form');
      if (!form) return;
      const set = (name, value) => {
        const node = form.elements.namedItem(name);
        if (node && value) node.value = value;
      };
      set('shipper_name', row.name);
      set('shipper_company', row.company);
      set('shipper_email', row.email);
      set('shipper_phone', row.phone);
      set('origin_city', row.origin);
      set('destination_city', row.destination);
      set('mode', row.mode);
      set('contents', row.cargo_type);
      set('weight_kg', row.weight_kg);
      set('pieces', row.pieces);
      set('dimensions', row.dimensions);
      set('incoterms', row.incoterms);
    });
    detail.appendChild(convert);
  }

  /* ---------------------------------------------------------- settings --- */

  /**
   * Everything the desk can change without a deploy.
   *
   * Three sections, because they answer three different questions: what the
   * public pages print, where our own mail goes, and how the chat widget
   * behaves. A blank text box means "use the value the deployment was
   * configured with", which is why none of them is required.
   */
  const SETTINGS_SECTIONS = [
    {
      title: 'Public contact details',
      note: 'These appear in the footer, on the contact page and in the quote sidebar. A change reaches every page on its next load.',
      fields: [
        ['company_name', 'Company name', 'text'],
        ['tagline', 'Tagline', 'text'],
        ['address', 'Head office address', 'text'],
        ['email', 'General email', 'email'],
        ['hours', 'Desk hours', 'text'],
      ],
    },
    {
      title: 'Email',
      note: 'Where site notifications land and what customer mail goes out as. Leave a box blank to use the deployment\u2019s own environment setting (FORM_TO, FORM_FROM).',
      fields: [
        ['notify_email', 'Send notifications to', 'email'],
        ['from_email', 'Send mail as', 'text'],
        ['reply_to', 'Reply-To', 'email'],
        ['email_signature', 'Signature on replies', 'textarea'],
      ],
      flags: [
        ['auto_reply', 'Acknowledge web forms automatically'],
        ['notify_on_shipment_created', 'Email the customer when a consignment is booked'],
        ['notify_on_shipment_update', 'Email the customer on every movement'],
      ],
    },
    {
      title: 'Customer portal',
      note: 'Customers sign in at /portal to see every consignment of theirs. Matching by address only ever applies to an address Supabase has confirmed \u2014 turn on "Confirm email" under Authentication, Providers, Email, or leave matching off and let customers add consignments by tracking number.',
      fields: [],
      flags: [
        ['portal_enabled', 'Offer the customer portal'],
        ['portal_email_matching', 'Show customers consignments booked to their confirmed address'],
      ],
    },
    {
      title: 'Live chat',
      note: 'How the widget introduces itself on the public pages, and whether the desk is alerted.',
      fields: [
        ['chat_agent_name', 'Name shown in the widget', 'text'],
        ['chat_greeting', 'Opening message', 'textarea'],
        ['chat_away_message', 'Out-of-hours message', 'textarea'],
      ],
      flags: [
        ['chat_enabled', 'Show the chat widget on the site'],
        ['chat_notify', 'Email the desk on every visitor message'],
      ],
    },
  ];

  const SETTINGS_FLAGS = SETTINGS_SECTIONS.flatMap((section) => section.flags || []).map(([key]) => key);
  const SETTINGS_TEXT = SETTINGS_SECTIONS.flatMap((section) => section.fields).map(([key]) => key);

  async function loadSettings() {
    // What the site is actually serving right now, stored value or built-in.
    try {
      state.effective = await (await fetch('/api/site', { headers: { Accept: 'application/json' } })).json();
    } catch (err) {
      state.effective = {};
    }
    try {
      const rows = await client.select('site_settings', 'select=*&id=eq.default&limit=1');
      state.settingsEditable = true;
      state.settings = rows[0] || {};
    } catch (err) {
      // The table arrives with 0001_init.sql. Without it the site keeps the
      // details it was built with; they just cannot be changed from here.
      state.settingsEditable = false;
      state.settings = null;
    }
  }

  function renderSettings() {
    const panel = $('settings-panel');
    // Built once. Rebuilding it would discard whatever is half typed and put
    // the stored values back in the boxes.
    if (panel.dataset.built === '1') return;
    panel.dataset.built = '1';
    panel.textContent = '';

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, 'Settings'));
    panel.appendChild(head);

    if (!state.settingsEditable) {
      panel.appendChild(el('p', 'admin-empty',
        'This database has no site_settings table, so the details stay as the site was built with. Run supabase/migrations/0001_init.sql and 0004_settings.sql in the Supabase SQL Editor, then reload this page.'));
      return;
    }

    const form = el('form', 'admin-settings-form');
    const inputs = {};
    const checks = {};
    // Columns this database does not have. 0004_settings.sql adds most of
    // them, so a deployment that has not run it gets an explanation rather
    // than a save that silently fails.
    const available = state.settings ? Object.keys(state.settings) : [];
    const missing = [];

    SETTINGS_SECTIONS.forEach((section) => {
      form.appendChild(el('h4', 'admin-form-group', section.title));
      form.appendChild(el('p', 'admin-sub', section.note));

      section.fields.forEach(([key, label, type]) => {
        if (available.length && !available.includes(key)) {
          missing.push(key);
          return;
        }
        const field = el('div', 'field');
        const id = `setting-${key}`;
        const lab = el('label', null, label);
        lab.htmlFor = id;
        const input = type === 'textarea' ? el('textarea') : document.createElement('input');
        if (type !== 'textarea') input.type = type;
        else input.rows = 3;
        input.id = id;
        input.name = key;
        // Show what is live, whether it came from this table or the build.
        input.value = (state.settings && state.settings[key]) || (state.effective && state.effective[key]) || '';
        input.placeholder = 'Leave blank to use the deployment default';
        inputs[key] = input;
        field.appendChild(lab);
        field.appendChild(input);
        form.appendChild(field);
      });

      (section.flags || []).forEach(([key, label]) => {
        if (available.length && !available.includes(key)) {
          missing.push(key);
          return;
        }
        const wrap = el('label', 'admin-check');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.name = key;
        box.checked = state.settings ? state.settings[key] !== false : true;
        checks[key] = box;
        wrap.appendChild(box);
        wrap.appendChild(document.createTextNode(` ${label}`));
        form.appendChild(wrap);
      });
    });

    if (missing.length) {
      form.appendChild(el('p', 'admin-empty',
        `This database is missing ${missing.length} newer setting column(s), so they are not shown: ${missing.join(', ')}. ` +
        'Run the migrations in supabase/migrations that have not been applied yet — 0004_settings.sql adds the email and chat settings, 0005_portal.sql the portal ones.'));
    }

    const status = el('div', 'form-status');
    const save = el('button', 'btn', 'Save changes');
    save.type = 'submit';
    form.appendChild(status);
    form.appendChild(save);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.className = 'form-status';
      status.textContent = 'Saving…';
      const patch = { updated_at: new Date().toISOString() };
      SETTINGS_TEXT.forEach((key) => {
        if (inputs[key]) patch[key] = inputs[key].value.trim() || null;
      });
      SETTINGS_FLAGS.forEach((key) => {
        if (checks[key]) patch[key] = checks[key].checked;
      });
      try {
        await client.update('site_settings', 'id=eq.default', patch);
        state.settings = Object.assign({}, state.settings, patch);
        status.className = 'form-status ok';
        status.textContent = 'Saved. The site and every notification pick these up within a few seconds.';
      } catch (err) {
        status.className = 'form-status bad';
        status.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    });

    panel.appendChild(form);
  }

  function render() {
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-panel') !== state.tab;
    });
    document.querySelectorAll('.admin-tab').forEach((tab) => {
      const on = tab.getAttribute('data-tab') === state.tab;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    if (state.tab === 'shipments') renderShipments();
    if (state.tab === 'quotes') renderQuotes();
    if (state.tab === 'enquiries') renderEnquiries();
    if (state.tab === 'applications') renderApplications();
    if (state.tab === 'chat') renderChat();
    if (state.tab === 'email') renderEmail();
    if (state.tab === 'settings') renderSettings();
    tallies();
  }

  /* ------------------------------------------------------------- fetch --- */

  /** Re-read the consignment list on its own, for the search box and filter. */
  async function refreshShipments() {
    try {
      state.shipments = await loadShipments();
      state.shipmentsError = '';
    } catch (err) {
      state.shipments = [];
      state.shipmentsError = err.message;
    }
    render();
  }

  /** The open consignment's events, which the list does not carry. */
  async function refreshShipmentDetail() {
    if (!state.active.shipments) {
      state.shipmentEvents = [];
      return;
    }
    try {
      state.shipmentEvents = await loadShipmentEvents(state.active.shipments);
    } catch (err) {
      state.shipmentEvents = [];
    }
  }

  async function refreshLists() {
    try {
      const [enquiries, sessions] = await Promise.all([loadEnquiries(), loadSessions()]);
      state.enquiries = (enquiries || []).filter(
        (row) => !String(row.service || '').startsWith(APPLICATION_MARKER)
      );
      state.sessions = sessions || [];
      try {
        state.applications = (await loadApplications()) || [];
      } catch (err) {
        // The table arrives with 0001_init.sql; a database built before it
        // simply has no applications rather than a broken dashboard.
        state.applications = [];
      }
      if (state.emailAvailable) {
        try {
          state.threads = (await loadThreads()) || [];
        } catch (err) {
          // 0002_email.sql is optional; a site not receiving mail has no tables.
          state.emailAvailable = false;
          state.threads = [];
        }
      }
      try {
        state.shipments = await loadShipments();
        state.shipmentsError = '';
      } catch (err) {
        // Either the tables are missing or the session is not staff; the
        // message says which, and the rest of the desk keeps working.
        state.shipments = [];
        state.shipmentsError = err.message;
      }
      if (state.quotesAvailable) {
        try {
          state.quotes = (await loadQuotes()) || [];
        } catch (err) {
          // quote_requests arrives with 0003_shipments.sql.
          state.quotesAvailable = false;
          state.quotes = [];
        }
      }
      if (state.settings === null && state.settingsEditable) await loadSettings();
      alertBar('');
    } catch (err) {
      alertBar(err.message);
    }
    render();
  }

  async function refreshThread() {
    try {
      if (state.tab === 'shipments' && state.active.shipments) {
        await refreshShipmentDetail();
      } else if (state.tab === 'chat' && state.active.chat) {
        state.messages = (await loadMessages(state.active.chat)) || [];
      } else if (state.tab === 'email' && state.active.email && state.emailAvailable) {
        state.mail = (await loadMail(state.active.email)) || [];
      } else {
        return;
      }
      render();
    } catch (err) {
      alertBar(err.message);
    }
  }

  /* -------------------------------------------------------------- boot --- */

  async function isAdmin(user) {
    if (!user || user.is_anonymous) return false;
    const rows = await client.select('admins', `select=user_id&user_id=eq.${user.id}&limit=1`);
    return rows.length > 0;
  }

  function wire() {
    document.querySelectorAll('.admin-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.tab = tab.getAttribute('data-tab');
        render();
        refreshThread();
      });
    });

    $('admin-signout').addEventListener('click', async () => {
      await client.auth.signOut();
      window.location.reload();
    });

    $('login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('login-btn');
      const error = $('login-error');
      error.textContent = '';
      button.disabled = true;
      try {
        await client.auth.signInWithPassword($('login-email').value.trim(), $('login-password').value);
        await enter();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });

    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (screens.shell.hidden) return;
      // Never rebuild the page under someone's cursor. Refreshing while a
      // field has focus replaces the element being typed into, which reads as
      // the text vanishing, or as a value you just deleted coming back.
      if (isTyping()) return;
      refreshLists();
      refreshThread();
    }, POLL_MS);
  }

  /** Decide which screen the current session earns. */
  async function enter() {
    const token = await client.auth.accessToken();
    const user = client.auth.user();
    if (!token || !user) return show('login');

    let admin = false;
    try {
      admin = await isAdmin(user);
    } catch (err) {
      $('login-note').textContent = err.message;
      return show('login');
    }

    if (!admin) {
      $('login-note').textContent =
        'That account is not on the admin list. Grant it by running supabase/grant-admin.sql with this address, or sign in with a different account.';
      await client.auth.signOut();
      return show('login');
    }

    $('admin-who').textContent = user.email || '';
    show('shell');
    await refreshLists();
    await refreshThread();
  }

  /** Say which value is missing and what the server would accept for it. */
  function explainUnconfigured(cfg, reason) {
    const target = $('admin-missing');
    if (!target) return show('unconfigured');
    target.textContent = '';

    if (reason) {
      target.appendChild(el('p', 'admin-note', reason));
      return show('unconfigured');
    }

    (cfg.missing || []).forEach((item) => {
      const p = el('p', 'admin-note');
      p.appendChild(document.createTextNode(
        item.value === 'supabaseUrl'
          ? 'The project URL is not set on this deployment. Accepted names: '
          : 'The browser key is not set on this deployment. Accepted names: '
      ));
      (item.accepts || []).forEach((name, i) => {
        if (i) p.appendChild(document.createTextNode(', '));
        p.appendChild(el('code', null, name));
      });
      p.appendChild(document.createTextNode('.'));
      target.appendChild(p);
    });

    if (!(cfg.missing || []).length) {
      target.appendChild(el('p', 'admin-note', 'The server did not return a Supabase URL or browser key.'));
    }
    return show('unconfigured');
  }

  async function boot() {
    let cfg = {};
    try {
      const res = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
      if (!res.ok) return explainUnconfigured(cfg, `The API answered ${res.status} for /api/public-config.`);
      cfg = await res.json();
    } catch (err) {
      return explainUnconfigured(cfg, 'The API could not be reached from this page.');
    }
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return explainUnconfigured(cfg);

    client = window.ParamountSupabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      // Its own key, so a member of staff signing in here does not displace
      // the anonymous session the chat widget uses on the public pages.
      storageKey: 'pm-admin-auth',
    });

    wire();
    await enter();
  }

  boot();
})();
