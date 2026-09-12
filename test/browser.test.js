'use strict';

/**
 * The site driven the way a person drives it.
 *
 * The API suite proves the server keeps its contracts; this proves the two
 * halves meet: a visitor tracking a consignment sees what the desk recorded, a
 * chat reaches a human and comes back, and an edit at the desk reaches the
 * public pages without a rebuild.
 */

const assert = require('assert');
const http = require('http');
const { chromium } = require('playwright-core');
const mock = require('./mock-supabase');

const ROOT = require('path').join(__dirname, '..');

/** A plain JSON GET, for checking the public API behind the page's back. */
async function req(base, path) {
  const res = await fetch(base + path, { headers: { Accept: 'application/json' } });
  return res.json().catch(() => ({}));
}

/** Poll a condition; the browser and the server settle at their own pace. */
async function until(check, what, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

(async () => {
  const sb = await mock.start({});
  const thread = {
    id: '44444444-3333-4222-8111-000000000000',
    created_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
    subject: 'Tender documents for the Apapa contract',
    participant_email: 'procurement@example.com',
    participant_name: 'Procurement',
    status: 'new',
  };
  sb.db.email_threads.rows.push(thread);
  sb.db.email_messages.rows.push({
    id: 'e1', created_at: new Date().toISOString(), thread_id: thread.id, direction: 'inbound',
    from_email: 'procurement@example.com', to_email: 'ops@paramount.test',
    subject: thread.subject, body_text: 'Please confirm the deadline for the tender return.',
    has_attachments: false,
  });
  const sbUrl = `http://127.0.0.1:${sb.address().port}`;
  sb.createUser('desk@paramount.test', 'desk-password', { admin: true });
  sb.createUser('nobody@paramount.test', 'outsider-password');
  // A customer, with the address their consignments are booked to.
  sb.createUser('ada@example.com', 'customer-password');

  process.env.SUPABASE_URL = sbUrl;
  process.env.SUPABASE_ANON_KEY = mock.ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = mock.SERVICE_KEY;
  process.env.CHAT_NOTIFY = 'off';

  const app = require(ROOT + '/src/app');
  const site = await new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${site.address().port}`;

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

  const log = [];
  const newPage = async (context) => {
    const page = await context.newPage();
    page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
    page.on('requestfailed', (r) => log.push(`[netfail] ${r.url()} ${r.failure() && r.failure().errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) log.push(`[http${r.status()}] ${r.url()}`); });
    return page;
  };

  try {
    /* ---------------- staff: the gate, then the desk ---------------- */
    const staffCtx = await browser.newContext();
    const staff = await newPage(staffCtx);
    await staff.goto(`${base}/admin`, { waitUntil: 'networkidle' });
    await staff.waitForSelector('#admin-login:not([hidden])');

    // A wrong password is reported, not swallowed.
    await staff.fill('#login-email', 'desk@paramount.test');
    await staff.fill('#login-password', 'wrong');
    await staff.click('#login-btn');
    await staff.waitForFunction(() => document.getElementById('login-error').textContent.length > 0);
    console.log('  ok  bad credentials are reported:', await staff.textContent('#login-error'));

    // An account that is not on the admins list gets told why.
    await staff.fill('#login-email', 'nobody@paramount.test');
    await staff.fill('#login-password', 'outsider-password');
    await staff.click('#login-btn');
    await staff.waitForFunction(() =>
      /not on the desk|not on the admin list/.test(document.getElementById('login-note').textContent)
    );
    assert.ok(await staff.isVisible('#admin-login'), 'non-admin stays on the gate');
    console.log('  ok  a non-admin account is refused with an explanation');

    await staff.fill('#login-email', 'desk@paramount.test');
    await staff.fill('#login-password', 'desk-password');
    await staff.click('#login-btn');
    await staff.waitForSelector('#admin-shell:not([hidden])', { timeout: 10000 });
    assert.strictEqual(await staff.textContent('#admin-who'), 'desk@paramount.test');
    console.log('  ok  admin signed in');

    /* ---------------- book a consignment at the desk ---------------- */
    await staff.click('.admin-tab[data-tab="shipments"]');
    await staff.waitForSelector('#shipment-list .admin-tools');
    await staff.click('#shipment-detail button:has-text("New consignment"), .admin-tools button:has-text("New consignment")');
    await staff.waitForSelector('.admin-ship-form');

    const field = (name, value) => staff.fill(`.admin-ship-form [name="${name}"]`, value);
    await staff.selectOption('.admin-ship-form [name="mode"]', 'ocean_freight');
    await field('shipper_name', 'Vestberg Components AB');
    await field('receiver_name', 'Okonkwo Trading Ltd');
    await field('receiver_email', 'rcv@example.com');
    await field('origin_city', 'Gothenburg');
    await field('origin_country', 'Sweden');
    await field('origin_lat', '57.7');
    await field('origin_lng', '11.97');
    await field('destination_city', 'Lagos');
    await field('destination_country', 'Nigeria');
    await field('destination_lat', '6.45');
    await field('destination_lng', '3.39');
    await field('pieces', '12');
    await field('weight_kg', '4200');
    await field('contents', 'Industrial bearings and spares');
    await field('internal_notes', 'Margin is thin on this one.');
    await staff.click('.admin-ship-form button[type="submit"]');

    await staff.waitForSelector('.admin-move-form', { timeout: 15000 });
    const number = (await staff.textContent('#shipment-detail h2.mono')).trim();
    assert.match(number, /^PMT-\d{4}-[0-9A-HJ-NP-Z]{8}$/, `a tracking number was allocated, got ${number}`);
    assert.strictEqual(sb.db.shipments.rows.length, 1);
    assert.strictEqual(sb.db.shipment_events.rows.length, 1, 'the timeline opens with the booking');
    console.log('  ok  the desk books a consignment and gets a tracking number:', number);

    /* ---------------- a visitor tracks it ---------------- */
    const visitorCtx = await browser.newContext();
    const visitor = await newPage(visitorCtx);

    // Straight from the landing page, the way a customer arrives.
    await visitor.goto(`${base}/`, { waitUntil: 'networkidle' });
    await visitor.fill('#hero-tracker-number', number.toLowerCase());
    await Promise.all([
      visitor.waitForURL(/\/track\?number=/, { timeout: 15000 }),
      visitor.click('#hero-tracker [data-track-submit]'),
    ]);
    await visitor.waitForSelector('.result-number', { timeout: 15000 });
    assert.match(await visitor.textContent('.result-number'), new RegExp(number));
    assert.match(await visitor.textContent('.status-badge'), /Booking registered/);
    assert.strictEqual(await visitor.$$eval('.timeline li', (n) => n.length), 1);
    console.log('  ok  the landing-page console hands a lower-case number to /track and it resolves');

    // Nothing commercial or internal may appear on the public page.
    const publicText = await visitor.textContent('body');
    assert.ok(!/Margin is thin/.test(publicText), 'internal notes must not be published');
    assert.ok(!/rcv@example\.com/.test(publicText), 'the consignee address must not be published');
    console.log('  ok  the public page carries none of the internal detail');

    /* ---------------- the desk moves it, the visitor sees it ---------------- */
    await staff.selectOption('.admin-move-form [name="status"]', 'in_transit');
    await staff.fill('.admin-move-form [name="location"]', 'Algeciras, Spain');
    await staff.fill('.admin-move-form [name="lat"]', '36.13');
    await staff.fill('.admin-move-form [name="lng"]', '-5.45');
    await staff.fill('.admin-move-form [name="note"]', 'Transhipped to MV Aurora.');
    await staff.click('.admin-move-form button[type="submit"]');
    await until(() => sb.db.shipment_events.rows.length === 2, 'the movement to be recorded');
    assert.strictEqual(sb.db.shipments.rows[0].status, 'in_transit');
    assert.strictEqual(sb.db.shipments.rows[0].current_location, 'Algeciras, Spain');
    console.log('  ok  recording a movement rolls up onto the consignment');

    await visitor.reload({ waitUntil: 'networkidle' });
    await visitor.waitForFunction(
      () => document.querySelectorAll('.timeline li').length === 2,
      null,
      { timeout: 15000 }
    );
    assert.match(await visitor.textContent('.status-badge'), /In transit/);
    assert.match(await visitor.textContent('.timeline li:first-child'), /Algeciras/);
    // The milestone rail is filled from the history, so the stages already
    // passed stay marked even when the status moves on.
    const done = await visitor.$$eval('.milestone.done', (n) => n.length);
    assert.ok(done >= 3, `milestones fill from history, got ${done}`);
    // Coordinates on both ends and a scan between them are enough to draw it.
    assert.strictEqual(await visitor.$$eval('.map-card svg', (n) => n.length), 1, 'the route map is drawn');
    console.log('  ok  the visitor sees the movement, the map and the filled milestones');

    /* ---------------- an internal note stays internal ---------------- */
    await staff.selectOption('.admin-move-form [name="status"]', 'exception');
    await staff.fill('.admin-move-form [name="location"]', 'Desk');
    await staff.fill('.admin-move-form [name="note"]', 'Chasing the consignee for a Form M.');
    await staff.check('.admin-move-form [name="internal"]');
    await staff.click('.admin-move-form button[type="submit"]');
    await until(() => sb.db.shipment_events.rows.length === 3, 'the internal note to be recorded');

    await visitor.reload({ waitUntil: 'networkidle' });
    await visitor.waitForSelector('.timeline li');
    assert.strictEqual(await visitor.$$eval('.timeline li', (n) => n.length), 2, 'the internal note is not published');
    assert.match(await visitor.textContent('.status-badge'), /In transit/, 'and it does not move the consignment');
    console.log('  ok  an internal note is kept off the public timeline');

    /* ---------------- an unknown number is refused kindly ---------------- */
    await visitor.goto(`${base}/track`, { waitUntil: 'networkidle' });
    await visitor.fill('#page-tracker-number', 'PMT-2026-4F7K2QX9');
    await visitor.click('#page-tracker [data-track-submit]');
    await visitor.waitForSelector('.result-note.bad', { timeout: 10000 });
    assert.match(await visitor.textContent('.result-note.bad'), /No consignment found/);
    console.log('  ok  an unknown number gets an explanation, not an empty page');

    /* ---------------- chat: visitor writes their own rows ---------------- */
    await visitor.goto(`${base}/contact`, { waitUntil: 'networkidle' });
    await visitor.click('#chat-toggle');
    await visitor.fill('#chat-input', 'Do you handle reefer cargo to West Africa?');
    await visitor.press('#chat-input', 'Enter');
    await visitor.waitForFunction(
      () => document.querySelectorAll('#chat-log .chat-msg.agent:not(.typing)').length >= 1,
      null,
      { timeout: 10000 }
    );

    await until(() => sb.db.chat_sessions.rows.length === 1, 'the browser to open a session');
    assert.ok(sb.db.chat_sessions.rows[0].visitor_id, 'session carries the anonymous auth uid');
    const visitorRows = sb.db.chat_messages.rows.filter((r) => r.sender === 'visitor');
    assert.strictEqual(visitorRows.length, 1, 'visitor row written by the browser');
    await until(
      () => sb.db.chat_messages.rows.filter((r) => r.sender === 'agent').length === 1,
      'the server to write the holding reply'
    );
    console.log('  ok  the visitor wrote their own row under an anonymous login');

    /* ---------------- the chat answers a tracking question ---------------- */
    await visitor.fill('#chat-input', `where is ${number}?`);
    await visitor.press('#chat-input', 'Enter');
    await visitor.waitForFunction(
      () => Array.from(document.querySelectorAll('#chat-log .chat-msg.agent')).some((n) => /in transit/i.test(n.textContent)),
      null,
      { timeout: 15000 }
    );
    console.log('  ok  the widget answers a tracking question from the real record');

    /* ---------------- staff answer, and the visitor sees it ---------------- */
    await staff.click('.admin-tab[data-tab="chat"]');
    await staff.waitForSelector('#chat-list .admin-row');
    await staff.click('#chat-list .admin-row');
    await staff.waitForSelector('#chat-detail .admin-thread .admin-bubble');
    await staff.fill('#chat-detail .admin-reply textarea', 'Yes — weekly reefer capacity to Lagos and Tema.');
    await staff.click('#chat-detail .admin-reply button');
    await until(
      () => sb.db.chat_messages.rows.some((r) => r.sender === 'agent' && /weekly reefer/.test(r.body)),
      'the reply to be written as an agent row'
    );
    // The flag is a second write after the message, so it lands a moment later.
    await until(
      () => sb.db.chat_sessions.rows[0].handled_by_agent === true,
      'the conversation to be marked as handed over'
    );
    await visitor.waitForFunction(
      () => Array.from(document.querySelectorAll('#chat-log .chat-msg')).some((n) => n.textContent.includes('weekly reefer')),
      null,
      { timeout: 15000 }
    );
    console.log('  ok  a staff reply reaches the visitor without a reload');

    /* ---------------- the customer portal ---------------- */
    const customerCtx = await browser.newContext();
    const customer = await newPage(customerCtx);
    await customer.goto(`${base}/portal`, { waitUntil: 'networkidle' });
    await customer.waitForSelector('#portal-auth:not([hidden])', { timeout: 10000 });

    // A wrong password is reported rather than swallowed.
    await customer.fill('#portal-email', 'ada@example.com');
    await customer.fill('#portal-password', 'wrong');
    await customer.click('#portal-auth-submit');
    await customer.waitForFunction(() => document.getElementById('portal-auth-error').textContent.length > 0);
    console.log('  ok  the portal reports a bad password');

    await customer.fill('#portal-password', 'customer-password');
    await customer.click('#portal-auth-submit');
    await customer.waitForSelector('#portal-shell:not([hidden])', { timeout: 10000 });
    assert.strictEqual(await customer.textContent('#portal-who'), 'ada@example.com');

    // The consignment the desk booked earlier is addressed to someone else, so
    // her list starts empty — which is the point: nothing is hers by default.
    await customer.waitForSelector('#portal-list', { timeout: 10000 });
    assert.strictEqual(await customer.$$eval('.pm-card', (n) => n.length), 0, 'nothing is hers yet');
    console.log('  ok  a new account starts empty');

    // She holds the tracking number, so she can add it.
    await customer.fill('#portal-claim-number', number.toLowerCase());
    await customer.click('#portal-claim-submit');
    await customer.waitForFunction(
      () => /added to your account/.test(document.getElementById('portal-claim-status').textContent),
      null,
      { timeout: 15000 }
    );
    await customer.waitForFunction(() => document.querySelectorAll('.pm-card').length === 1, null, { timeout: 10000 });
    assert.match(await customer.textContent('.pm-card'), new RegExp(number));
    console.log('  ok  a consignment is added to the account with its tracking number');

    // Opening it shows the same timeline the tracking page renders.
    await customer.click('.pm-card');
    await customer.waitForSelector('#portal-detail .timeline li', { timeout: 10000 });
    assert.strictEqual(
      await customer.$$eval('#portal-detail .timeline li', (n) => n.length),
      2,
      'the public timeline, internal note excluded'
    );
    assert.ok(
      await customer.isHidden('#portal-list'),
      'the list steps aside while one consignment is open'
    );
    const portalText = await customer.textContent('#portal-detail');
    assert.ok(!/Margin is thin/.test(portalText), 'internal notes must not reach the portal');
    console.log('  ok  a consignment opens with the customer timeline and none of the internal detail');

    // Taking it off the account leaves the consignment itself alone.
    customer.on('dialog', (d) => d.accept());
    await customer.click('[data-remove]');
    await customer.waitForFunction(() => document.querySelectorAll('.pm-card').length === 0, null, { timeout: 10000 });
    assert.strictEqual((await req(base, `/api/track/${number}`)).ok, true, 'the consignment still tracks publicly');
    console.log('  ok  removing it from the account does not touch the consignment');

    // The session survives a reload, and signing out returns to the gate.
    await customer.fill('#portal-claim-number', number);
    await customer.click('#portal-claim-submit');
    await customer.waitForFunction(() => document.querySelectorAll('.pm-card').length === 1, null, { timeout: 15000 });
    await customer.reload({ waitUntil: 'networkidle' });
    await customer.waitForSelector('.pm-card', { timeout: 15000 });
    console.log('  ok  the session and the list survive a reload');

    await customer.click('#portal-signout');
    await customer.waitForSelector('#portal-auth:not([hidden])', { timeout: 10000 });
    console.log('  ok  signing out returns to the gate');
    await customer.close();

    /* ---------------- enquiry and rate request reach the desk ---------------- */
    await visitor.goto(`${base}/contact`, { waitUntil: 'networkidle' });
    await visitor.fill('#contact-form-name', 'Ada Kolen');
    await visitor.fill('#contact-form-email', 'ada@example.com');
    await visitor.fill('#contact-form-message', 'Quay wall spares, 320m of it, live berth.');
    await visitor.click('#contact-form [data-submit]');
    await until(() => sb.db.enquiries.rows.length === 1, 'the enquiry to reach the database');
    console.log('  ok  the enquiry form writes to the inbox');

    await visitor.goto(`${base}/quote`, { waitUntil: 'networkidle' });
    await visitor.fill('#q-name', 'Dana Okafor');
    await visitor.fill('#q-email', 'dana@example.com');
    await visitor.selectOption('#q-mode', 'ocean_freight');
    await visitor.fill('#q-origin', 'Shanghai');
    await visitor.fill('#q-destination', 'Rotterdam');
    await visitor.fill('#q-weight', '8200');
    await visitor.click('#quote-form [data-submit]');
    await until(() => sb.db.quote_requests.rows.length === 1, 'the rate request to reach the database');
    assert.strictEqual(sb.db.quote_requests.rows[0].weight_kg, 8200, 'numbers arrive as numbers');
    console.log('  ok  the quote form writes a rate request');

    await staff.click('.admin-tab[data-tab="quotes"]');
    await staff.waitForSelector('#quote-list .admin-row', { timeout: 15000 });
    await staff.click('#quote-list .admin-row');
    await staff.waitForSelector('#quote-detail .admin-facts');
    assert.match(await staff.textContent('#quote-detail'), /Dana Okafor/);
    console.log('  ok  the rate request shows up on the desk');

    await staff.click('.admin-tab[data-tab="enquiries"]');
    await staff.waitForSelector('#enquiry-list .admin-row', { timeout: 15000 });
    await staff.click('#enquiry-list .admin-row');
    await staff.waitForSelector('#enquiry-detail .admin-message');
    await staff.selectOption('#enquiry-detail .admin-status select', 'closed');
    await until(
      () => sb.db.enquiries.rows.filter((r) => r.status === 'closed').length === 1,
      'triage to write back'
    );
    console.log('  ok  triage writes back');

    /* ---------------- apply: careers -> form -> desk ---------------- */
    await visitor.goto(`${base}/careers`, { waitUntil: 'networkidle' });
    const applyHref = await visitor.getAttribute('#role-list .role a', 'href');
    assert.match(applyHref, /^\/apply\?role=/, `apply link goes to the form, got ${applyHref}`);
    await Promise.all([
      visitor.waitForURL(/\/apply\?role=/, { timeout: 15000 }),
      visitor.click('#role-list .role a'),
    ]);
    await visitor.waitForSelector('#apply-form');
    assert.ok(await visitor.inputValue('#a-role'), 'the role carries over from the careers page');
    await visitor.fill('#a-name', 'Sanne Vermeer');
    await visitor.fill('#a-email', 'sanne@example.nl');
    await visitor.fill('#a-message', 'Six years of entries, mostly pharma and industrial, plus two audits.');
    await visitor.click('#apply-form [data-submit]');
    await until(() => sb.db.applications.rows.length === 1, 'the application to reach the database');
    assert.strictEqual(sb.db.applications.rows[0].email, 'sanne@example.nl');
    console.log('  ok  the application is stored with the role it names');

    /* ---------------- a poll must not type over you ---------------- */
    await staff.click('.admin-tab[data-tab="chat"]');
    await staff.waitForSelector('#chat-list .admin-row');
    await staff.click('#chat-list .admin-row');
    await staff.waitForSelector('#chat-detail .admin-reply textarea');
    await staff.click('#chat-detail .admin-reply textarea');
    await staff.type('#chat-detail .admin-reply textarea', 'Half a sentence that must survive');
    // The dashboard refreshes every 5s. Wait past one tick with focus held.
    await new Promise((r) => setTimeout(r, 7000));
    assert.strictEqual(
      await staff.inputValue('#chat-detail .admin-reply textarea'),
      'Half a sentence that must survive',
      'a chat reply must not be wiped by the refresh'
    );
    console.log('  ok  a half-typed chat reply survives the refresh');

    /* ---------------- settings reach the public pages ---------------- */
    await staff.click('.admin-tab[data-tab="settings"]');
    await staff.waitForSelector('#setting-email');

    // Clearing a field must leave it cleared, through a refresh tick.
    await staff.fill('#setting-address', '');
    await staff.click('#setting-address');
    await new Promise((r) => setTimeout(r, 7000));
    assert.strictEqual(await staff.inputValue('#setting-address'), '', 'a cleared field must not refill itself');
    console.log('  ok  a cleared settings field stays cleared');

    await staff.fill('#setting-address', 'Wijnhaven 3, 3011 WG Rotterdam, NL');
    await staff.fill('#setting-email', 'desk@paramount.test');
    await staff.fill('#setting-phone', '+31 (0)20 111 2222');
    await staff.fill('#setting-chat_agent_name', 'Paramount Control');
    await staff.click('.admin-settings-form button[type="submit"]');
    await until(
      () => sb.db.site_settings.rows[0].email === 'desk@paramount.test',
      'the desk to save the new contact details'
    );
    console.log('  ok  the desk saves new contact details');

    const reader2 = await newPage(visitorCtx);
    await reader2.goto(`${base}/contact`, { waitUntil: 'networkidle' });
    await reader2.waitForFunction(
      () => document.querySelector('[data-site="email"]').textContent.trim() === 'desk@paramount.test',
      null,
      { timeout: 20000 }
    );
    assert.strictEqual(
      await reader2.getAttribute('a[data-site="email"]', 'href'),
      'mailto:desk@paramount.test',
      'the mailto follows the address'
    );
    assert.strictEqual((await reader2.textContent('[data-site="phone"]')).trim(), '+31 (0)20 111 2222');
    console.log('  ok  the change reaches the public pages with no rebuild');
    await reader2.close();

    /* ---------------- every reveal actually reveals ---------------- */
    const reader = await newPage(visitorCtx);
    for (const path of ['/', '/services', '/network', '/about', '/careers', '/track', '/portal']) {
      await reader.goto(base + path, { waitUntil: 'networkidle' });
      await reader.evaluate(async () => {
        // Walk the page so every section enters the viewport at least once.
        // instant, not smooth: the page sets scroll-behavior: smooth, and a
        // smooth scroll cancels the one before it, so a walk in steps never
        // actually reaches the bottom.
        for (let y = 0; y < document.body.scrollHeight; y += Math.round(window.innerHeight * 0.6)) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, 160));
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 1400));
      });
      const hidden = await reader.evaluate(() =>
        Array.from(document.querySelectorAll('[data-reveal]'))
          .filter((el) => getComputedStyle(el).opacity !== '1' || el.getBoundingClientRect().height === 0)
          .map((el) => `${el.tagName}.${el.className} "${(el.textContent || '').trim().slice(0, 30)}"`)
      );
      assert.deepStrictEqual(hidden, [], `every reveal on ${path} must end up visible`);
      console.log(`  ok  every reveal on ${path} ends up visible`);
    }

    /* ---------------- the counters actually count ---------------- */
    // They start at zero and count up when their block is scrolled into view,
    // so the page has to be walked before asking whether they ran.
    await reader.goto(base + '/', { waitUntil: 'networkidle' });
    await reader.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += Math.round(window.innerHeight * 0.6)) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 140));
      }
    });
    await reader.waitForFunction(
      () => Array.from(document.querySelectorAll('[data-count]')).every((n) => n.textContent !== '0'),
      null,
      { timeout: 10000 }
    );
    const counted = await reader.$$eval('[data-count]', (n) => n.map((x) => x.textContent));
    assert.ok(counted.includes('2,400,000+'), 'the headline figure lands on its real value: ' + counted.join(', '));
    console.log('  ok  the headline figures count up rather than sitting at zero:', counted.join(', '));
    await reader.close();

    /* ---------------- company mail reads as a thread ---------------- */
    await staff.click('.admin-tab[data-tab="email"]');
    await staff.waitForSelector('#email-list .admin-row', { timeout: 10000 });
    await staff.click('#email-list .admin-row');
    await staff.waitForSelector('#email-detail .admin-thread .admin-bubble');
    assert.match(await staff.textContent('#email-detail'), /deadline for the tender return/);
    console.log('  ok  company mail reads as a thread');

    /* ---------------- no unexpected console errors ---------------- */
    const expected = [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /grant_type=password/, /favicon/, /\/api\/track\//];
    const bad = log
      .filter((line) => /^\[(error|pageerror|netfail|http)/.test(line))
      .filter((line) => !expected.some((re) => re.test(line)))
      // Chromium reports a bare "Failed to load resource" alongside the
      // detailed [http*]/[netfail] entry for the same request.
      .filter((line) => !/^\[error\] Failed to load resource/.test(line));
    assert.strictEqual(bad.length, 0, 'console clean, got:\n' + bad.join('\n'));
    console.log('  ok  no unexpected page errors');

    console.log('\nbrowser suite passed');
  } catch (err) {
    console.error('\nFAILED:', err.message);
    console.error('console log:\n' + log.join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
    site.close();
    sb.close();
  }
  process.exit(process.exitCode || 0);
})();
