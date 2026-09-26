'use strict';

const assert = require('assert');
const http = require('http');
const mock = require('./mock-supabase');

const ROOT = require('path').join(__dirname, '..');

async function req(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, body: json, text };
}

async function withApp(env, fn) {
  Object.assign(process.env, env);
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ROOT + '/src')) delete require.cache[key];
  }
  const app = require(ROOT + '/src/api-app');
  const server = await new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

(async () => {
  /* ---- 1. the schema mismatch that broke chat is caught by the mock ---- */
  {
    const sb = await mock.start({});
    const base = `http://127.0.0.1:${sb.address().port}`;
    const res = await fetch(`${base}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: { apikey: mock.SERVICE_KEY, Authorization: `Bearer ${mock.SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ session_id: 'sometoken', role: 'user', text: 'hi' }]),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400, 'old column names must be rejected');
    assert.match(body.message, /'role' column/);
    console.log('  ok  mock rejects the pre-fix columns:', body.message);
    sb.close();
  }

  /* ---- 2. server-side chat path writes what the schema expects ---- */
  {
    const sb = await mock.start({});
    const sbUrl = `http://127.0.0.1:${sb.address().port}`;
    await withApp(
      { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, CHAT_NOTIFY: 'off' },
      async (base) => {
        const token = 'visitortoken1234';
        const sent = await req(base, 'POST', '/api/chat/message', { sessionId: token, text: 'Where is my consignment?' });
        assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
        assert.strictEqual(sent.body.stored, true, 'message must persist: ' + JSON.stringify(sent.body));
        assert.strictEqual(sent.body.messages.length, 2);
        assert.strictEqual(sent.body.messages[0].text, 'Where is my consignment?');
        assert.strictEqual(sent.body.messages[1].role, 'agent');

        assert.strictEqual(sb.db.chat_sessions.rows.length, 1, 'one session row');
        assert.strictEqual(sb.db.chat_messages.rows.length, 2, 'visitor + agent rows');
        assert.deepStrictEqual(
          sb.db.chat_messages.rows.map((r) => r.sender),
          ['visitor', 'agent']
        );
        console.log('  ok  server path wrote sender/body rows and a parent session');

        // A second message must reuse the same session row.
        await req(base, 'POST', '/api/chat/message', { sessionId: token, text: 'Second message' });
        assert.strictEqual(sb.db.chat_sessions.rows.length, 1, 'session row is not duplicated');
        console.log('  ok  a follow-up reuses the same session');

        const history = await req(base, 'GET', `/api/chat/${token}`);
        assert.strictEqual(history.status, 200);
        assert.strictEqual(history.body.messages.length, 4);
        assert.deepStrictEqual(history.body.messages.map((m) => m.role), ['user', 'agent', 'user', 'agent']);
        assert.strictEqual(history.body.messages[0].text, 'Where is my consignment?');
        console.log('  ok  history reads back in order with app roles');

        // Once a human answers, the canned responder stays quiet.
        sb.db.chat_sessions.rows[0].handled_by_agent = true;
        const quiet = await req(base, 'POST', '/api/chat/message', { sessionId: token, text: 'Anyone there?' });
        assert.strictEqual(quiet.body.messages.length, 1, 'no auto-reply after handover');
        assert.strictEqual(sb.db.chat_messages.rows.length, 5, 'only the visitor row was added');
        console.log('  ok  handover silences the automatic responder');
      }
    );
    sb.close();
  }

  /* ---- 3. browser path: /api/chat/notify posts the holding reply ---- */
  {
    const sb = await mock.start({});
    const sbUrl = `http://127.0.0.1:${sb.address().port}`;
    const visitor = { id: '11111111-2222-4333-8444-555555555555' };
    const session = { id: '99999999-8888-4777-8666-555555555555', visitor_id: visitor.id, created_at: new Date().toISOString(), last_message_at: new Date().toISOString(), status: 'new', handled_by_agent: false };
    sb.db.chat_sessions.rows.push(session);
    sb.db.chat_messages.rows.push({ id: 'm1', created_at: new Date().toISOString(), session_id: session.id, sender: 'visitor', body: 'Hello' });

    await withApp(
      { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, CHAT_NOTIFY: 'off' },
      async (base) => {
        const notified = await req(base, 'POST', '/api/chat/notify', { sessionId: session.id, text: 'Hello' });
        assert.strictEqual(notified.status, 202, JSON.stringify(notified.body));
        assert.strictEqual(notified.body.replied, true);
        assert.strictEqual(sb.db.chat_messages.rows.length, 2);
        assert.strictEqual(sb.db.chat_messages.rows[1].sender, 'agent');
        console.log('  ok  notify posts the holding reply into the visitor thread');

        session.handled_by_agent = true;
        const after = await req(base, 'POST', '/api/chat/notify', { sessionId: session.id, text: 'Still there?' });
        assert.strictEqual(after.body.replied, false);
        assert.strictEqual(sb.db.chat_messages.rows.length, 2, 'no bot reply once a human is on it');
        console.log('  ok  notify stays quiet after handover');

        const bad = await req(base, 'POST', '/api/chat/notify', { sessionId: 'not-a-uuid', text: 'x' });
        assert.strictEqual(bad.status, 422);
        console.log('  ok  notify rejects a malformed session id');
      }
    );
    sb.close();
  }

  /* ---- 4. the health probe sees a schema built from an older migration ---- */
  {
    const good = await mock.start({});
    // A site that is not receiving mail never runs 0002_email.sql.
    delete good.db.email_threads;
    delete good.db.email_messages;
    await withApp(
      { SUPABASE_URL: `http://127.0.0.1:${good.address().port}`, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'GET', '/api/health?probe=1');
        assert.strictEqual(res.body.schema.chat_messages, 'ok');
        assert.strictEqual(res.body.schema.chat_sessions, 'ok');
        assert.match(res.body.schema.email_threads, /^optional:/);
        assert.ok(!res.body.warnings.some((w) => /did not answer/.test(w)), JSON.stringify(res.body.warnings));
        console.log('  ok  probe passes against the current migration');
      }
    );
    good.close();

    const stale = await mock.start({ drop: ['chat_sessions.handled_by_agent'] });
    await withApp(
      { SUPABASE_URL: `http://127.0.0.1:${stale.address().port}`, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'GET', '/api/health?probe=1');
        assert.strictEqual(res.body.status, 'degraded');
        assert.match(res.body.schema.chat_sessions, /handled_by_agent does not exist/);
        assert.ok(res.body.warnings.some((w) => /0001_init\.sql/.test(w)));
        console.log('  ok  probe names the missing column and the file that adds it');
      }
    );
    stale.close();

    // Once MAILBOX_ADDRESS is set the inbox tables stop being optional. Filing
    // is best effort, so without them the webhook still answers 200 and Resend
    // still reports success while /admin stays empty and nothing says why.
    const receiving = await mock.start({});
    delete receiving.db.email_threads;
    delete receiving.db.email_messages;
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${receiving.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        MAILBOX_ADDRESS: 'Paramount Shipping <ops@paramount.test>',
      },
      async (base) => {
        const res = await req(base, 'GET', '/api/health?probe=1');
        assert.strictEqual(res.body.status, 'degraded');
        assert.ok(
          res.body.warnings.some((w) => /email_threads[\s\S]*0002_email\.sql/.test(w)),
          JSON.stringify(res.body.warnings)
        );
        console.log('  ok  a site receiving mail is told the inbox tables are missing');
      }
    );
    receiving.close();
  }

  /* ---- 5. contact enquiries still land ---- */
  {
    const sb = await mock.start({});
    await withApp(
      { SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'POST', '/api/contact', {
          name: 'Ada Kolen', email: 'ada@example.com', company: 'Kolen BV', service: 'Structural',
          message: 'A 40m span over a canal, tight headroom.',
        });
        assert.strictEqual(res.status, 201, JSON.stringify(res.body));
        assert.strictEqual(sb.db.enquiries.rows.length, 1);
        assert.strictEqual(sb.db.enquiries.rows[0].email, 'ada@example.com');
        console.log('  ok  contact enquiry persisted');
      }
    );
    sb.close();
  }

  /* ---- 6. job applications reach the same database ---- */
  {
    const sb = await mock.start({});
    await withApp(
      { SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const roles = require(ROOT + '/src/data/careers.json');

        const good = await req(base, 'POST', '/api/applications', {
          name: 'Sanne Vermeer', email: 'sanne@example.nl', phone: '+31 6 1234 5678',
          roleId: roles[0].id, experience: '4 to 8', portfolio: 'https://example.nl/sanne',
          message: 'Six years on tall buildings, mostly post-tensioned flat slabs and one diagrid.',
        });
        assert.strictEqual(good.status, 201, JSON.stringify(good.body));
        assert.strictEqual(sb.db.applications.rows.length, 1);
        const row = sb.db.applications.rows[0];
        assert.strictEqual(row.email, 'sanne@example.nl');
        assert.strictEqual(row.role_id, roles[0].id);
        assert.strictEqual(row.role_title, roles[0].title);
        assert.strictEqual(row.status, 'new');
        console.log('  ok  application stored against the role it names');

        const spec = await req(base, 'POST', '/api/applications', {
          name: 'Tom Bakker', email: 'tom@example.nl',
          message: 'No open role fits but I detail connections and would like to talk.',
        });
        assert.strictEqual(spec.status, 201);
        assert.strictEqual(sb.db.applications.rows[1].role_title, 'Speculative application');
        console.log('  ok  a speculative application is still an application');

        const bad = await req(base, 'POST', '/api/applications', { name: 'X', email: 'nope', message: 'short' });
        assert.strictEqual(bad.status, 422);
        assert.deepStrictEqual(Object.keys(bad.body.fields).sort(), ['email', 'message', 'name']);
        console.log('  ok  validation reports every bad field at once');

        const stale = await req(base, 'POST', '/api/applications', {
          name: 'Ada Kolen', email: 'ada@example.com', roleId: 'a-role-we-closed',
          message: 'Applying for a role that is no longer listed on the careers page.',
        });
        assert.strictEqual(stale.status, 422);
        assert.ok(stale.body.fields.roleId, 'a closed role is rejected');
        console.log('  ok  a role that is no longer open is refused');

        const probe = await req(base, 'GET', '/api/health?probe=1');
        assert.strictEqual(probe.body.schema.applications, 'ok');
        console.log('  ok  the schema probe covers applications');
      }
    );
    sb.close();
  }

  /* ---- 7. the browser key, under every name Supabase has given it ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;

    // A project created under the newer API keys scheme: the Vercel
    // integration injects a publishable key, not an anon key. Missing this
    // name is why /admin can report "backend not connected" on a deployment
    // that is in fact configured.
    for (const name of [
      'SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_ANON_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ]) {
      ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
       'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
      ].forEach((k) => delete process.env[k]);

      await withApp(
        { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, [name]: 'browser-key-value' },
        async (base) => {
          const cfg = await req(base, 'GET', '/api/public-config');
          assert.strictEqual(cfg.body.supabaseAnonKey, 'browser-key-value', `${name} must be accepted`);
          assert.strictEqual(cfg.body.chatEnabled, true, `${name} must enable the browser half`);
          assert.deepStrictEqual(cfg.body.missing, [], `${name} leaves nothing missing`);
        }
      );
    }
    console.log('  ok  every name Supabase uses for the browser key is accepted');

    ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
     'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
    ].forEach((k) => delete process.env[k]);

    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY },
      async (base) => {
        const cfg = await req(base, 'GET', '/api/public-config');
        assert.strictEqual(cfg.body.chatEnabled, false);
        assert.strictEqual(cfg.body.missing.length, 1);
        assert.strictEqual(cfg.body.missing[0].value, 'supabaseAnonKey');
        assert.ok(cfg.body.missing[0].accepts.includes('SUPABASE_PUBLISHABLE_KEY'));
        // Names only. A diagnosis must never hand out a key.
        assert.ok(!JSON.stringify(cfg.body.missing).includes(mock.SERVICE_KEY));
        console.log('  ok  a missing browser key is named, with the env names that would satisfy it');

        const health = await req(base, 'GET', '/api/health');
        assert.ok(
          health.body.warnings.some((w) => /SUPABASE_PUBLISHABLE_KEY/.test(w)),
          JSON.stringify(health.body.warnings)
        );
        console.log('  ok  health says the same thing');
      }
    );
    sb.close();
  }

  /* ---- 8. an application never vanishes, and the details are editable ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;

    // A database created before the applications table existed.
    delete sb.db.applications;
    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'POST', '/api/applications', {
          name: 'Sanne Vermeer', email: 'sanne@example.nl', roleId: 'customs-broker',
          phone: '+31 6 1234 5678', experience: '4 to 8',
          message: 'Six years of entries, mostly pharma and industrial, plus two audits.',
        });
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.stored, 'enquiries', 'it must land somewhere');
        assert.strictEqual(sb.db.enquiries.rows.length, 1);
        const filed = sb.db.enquiries.rows[0];
        assert.match(filed.service, /^Application: /);
        assert.match(filed.message, /Six years of entries/);
        assert.match(filed.message, /\+31 6 1234 5678/, 'the phone survives the fallback');
        console.log('  ok  an application is filed as an enquiry when its own table is missing');
      }
    );
    sb.close();
  }

  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const defaults = require(ROOT + '/src/data/site.json');

        const before = await req(base, 'GET', '/api/site');
        assert.strictEqual(before.body.email, defaults.email, 'an empty row falls back to the built-in values');
        assert.strictEqual(before.body.source, 'database');

        sb.db.site_settings.rows[0].email = 'desk@example.com';
        sb.db.site_settings.rows[0].hours = 'Desk 06:00-22:00 CET';
        // The site publishes no telephone number, so the desk cannot set one:
        // the column is still there, it is simply never read.
        sb.db.site_settings.rows[0].phone = '+31 (0)20 111 2222';
        // Settings are cached for a few seconds, since every page load reads
        // them; `?fresh=1` is the read that skips it.
        const cached = await req(base, 'GET', '/api/site');
        assert.strictEqual(cached.body.email, defaults.email, 'the cached read is still the old value');
        const after = await req(base, 'GET', '/api/site?fresh=1');
        assert.strictEqual(after.body.email, 'desk@example.com');
        assert.strictEqual(after.body.hours, 'Desk 06:00-22:00 CET');
        assert.strictEqual(after.body.phone, undefined, 'a telephone number is never published');
        assert.strictEqual(after.body.address, defaults.address, 'a field left blank keeps the built-in value');
        console.log('  ok  edited contact details are served, blanks fall back');
      }
    );
    // And with no table at all the site still knows its own address.
    delete sb.db.site_settings;
    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'GET', '/api/site');
        assert.strictEqual(res.body.source, 'defaults');
        assert.strictEqual(res.body.email, require(ROOT + '/src/data/site.json').email);
        console.log('  ok  without the table the built-in details stand');
      }
    );
    sb.close();
  }

  /* ---- 15. a signed Resend delivery reaches the admin inbox ---- */
  {
    const { sign } = require(ROOT + '/src/utils/webhookSignature');
    const SECRET = 'whsec_' + Buffer.from('paramount-inbound-test-secret').toString('base64');
    const sb = await mock.start({});
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        RESEND_WEBHOOK_SECRET: SECRET,
        MAILBOX_ADDRESS: 'Paramount Shipping <ops@paramount.test>',
        // No forwarding here: this asserts the archive that /admin reads.
        FORWARD_TO: '',
        RESEND_API_KEY: '',
      },
      async (base) => {
        const post = (raw, id, timestamp, signature) =>
          fetch(base + '/api/inbound/resend', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'svix-id': id,
              'svix-timestamp': timestamp,
              'svix-signature': signature,
            },
            body: raw,
          });

        // Resend sends `to` as an array and prefixes the event with "email.".
        const body = JSON.stringify({
          type: 'email.received',
          data: {
            from: 'Ada Kolen <ada@example.com>',
            to: ['ops@paramount.test'],
            subject: 'Re: Rates for Shanghai to Rotterdam',
            text: 'Can you quote the canal crossing?',
            message_id: '<m1@example.com>',
          },
        });
        const ts = String(Math.floor(Date.now() / 1000));

        const ok = await post(body, 'msg_1', ts, sign(SECRET, 'msg_1', ts, body));
        assert.strictEqual(ok.status, 200, await ok.text());
        assert.strictEqual(sb.db.email_threads.rows.length, 1, 'a thread was opened');
        assert.strictEqual(sb.db.email_threads.rows[0].participant_email, 'ada@example.com');
        // Re: is stripped so a reply joins the conversation it belongs to.
        assert.strictEqual(sb.db.email_threads.rows[0].subject, 'Rates for Shanghai to Rotterdam');
        assert.strictEqual(sb.db.email_messages.rows.length, 1);
        assert.strictEqual(sb.db.email_messages.rows[0].direction, 'inbound');
        assert.strictEqual(sb.db.email_messages.rows[0].to_email, 'ops@paramount.test');
        console.log('  ok  a signed inbound delivery lands in the admin inbox');

        // The address the production webhook was pointed at answered 404 and
        // filed nothing. It is the same endpoint now, and says it filed.
        const aliasBody = body.replace('<m1@example.com>', '<m1b@example.com>');
        const alias = await fetch(base + '/api/inbound-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'svix-id': 'msg_1b',
            'svix-timestamp': ts,
            'svix-signature': sign(SECRET, 'msg_1b', ts, aliasBody),
          },
          body: aliasBody,
        });
        assert.strictEqual(alias.status, 200, await alias.clone().text());
        assert.strictEqual((await alias.json()).filed, 'ok');
        assert.strictEqual(sb.db.email_messages.rows.length, 2, 'the alias files onto the same inbox');
        assert.strictEqual(sb.db.email_threads.rows.length, 1, 'and onto the same thread');
        console.log('  ok  /api/inbound-email is the same signed endpoint');

        // Mail for another address is acknowledged, and the log says why.
        const strayBody = body.replace('ops@paramount.test', 'info@elsewhere.test');
        const stray = await post(strayBody, 'msg_1c', ts, sign(SECRET, 'msg_1c', ts, strayBody));
        const strayOut = await stray.json();
        assert.strictEqual(strayOut.ignored, 'not_for_mailbox');
        assert.strictEqual(strayOut.mailbox, 'ops@paramount.test');
        console.log('  ok  mail for another address says which mailbox it expected');

        const tampered = body.replace('Ada Kolen', 'Mallory Vane');
        const bad = await post(tampered, 'msg_2', ts, sign(SECRET, 'msg_2', ts, body));
        assert.strictEqual(bad.status, 401);
        // Named so a provider's delivery log says which of the failures it was.
        assert.strictEqual((await bad.json()).reason, 'signature_mismatch');
        assert.strictEqual(sb.db.email_messages.rows.length, 2, 'nothing filed from an unverified post');
        console.log('  ok  a tampered body is refused and files nothing');
      }
    );
    sb.close();
  }

  /* ---- 15b. an inbound webhook that carries no body fetches one ---- */
  {
    const { sign } = require(ROOT + '/src/utils/webhookSignature');
    const SECRET = 'whsec_' + Buffer.from('body-fetch-secret').toString('base64');
    const sb = await mock.start({});

    const realFetch = global.fetch;
    const asked = [];
    global.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/emails/receiving/')) {
        asked.push(String(url));
        return new Response(JSON.stringify({ text: 'Can you quote the canal crossing?' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url, init);
    };

    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY,
        RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: 'test-key',
        MAILBOX_ADDRESS: 'ops@paramount.test', FORWARD_TO: '',
      },
      async (base) => {
        // Shaped like a real Resend delivery: envelope only, no text or html.
        const body = JSON.stringify({
          type: 'email.received',
          data: {
            attachments: [], bcc: [], cc: [],
            email_id: '4a93e097-c85c-408f-89fd-67bc22511be5',
            from: 'ada@example.com',
            message_id: '<ada-2@example.com>',
            received_for: ['ops@paramount.test'],
            subject: 'Canal crossing',
            to: ['ops@paramount.test'],
          },
        });
        const id = 'msg_body', ts = String(Math.floor(Date.now() / 1000));
        const res = await fetch(base + '/api/inbound/resend', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(SECRET, id, ts, body),
          },
          body,
        });
        assert.strictEqual(res.status, 200, await res.text());
        assert.strictEqual(asked.length, 1, 'the body was fetched by email_id');
        // Received mail lives under /emails/receiving; /emails/{id} is sent mail
        // and answers "Email not found" for an inbound id.
        assert.match(asked[0], /\/emails\/receiving\/4a93e097-c85c-408f-89fd-67bc22511be5\?/);
        const filed = sb.db.email_messages.rows[0];
        assert.strictEqual(filed.body_text, 'Can you quote the canal crossing?',
          'the fetched body is what reaches the dashboard');
        console.log('  ok  an envelope-only delivery fetches its body before filing');
      }
    );

    global.fetch = realFetch;
    sb.close();
  }

  /* ---- 16. replying to studio mail from the desk ---- */
  {
    const sb = await mock.start({});
    const sbUrl = `http://127.0.0.1:${sb.address().port}`;

    // Stand in for Resend so the suite never sends real mail.
    const realFetch = global.fetch;
    const sentMail = [];
    global.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/')) {
        sentMail.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'resend-1' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url, init);
    };

    // A real signed-in session, the way the desk gets one.
    const signIn = async (email, password) => {
      await realFetch(`${sbUrl}/auth/v1/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: mock.ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const res = await realFetch(`${sbUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: mock.ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      return res.json();
    };

    const staff = await signIn('desk@paramount.test', 'pw-desk');
    const outsider = await signIn('nosy@example.com', 'pw-nosy');
    sb.db.admins.rows.push({ user_id: staff.user.id, email: staff.user.email });

    const thread = {
      id: '11111111-2222-4333-8444-555555555555',
      created_at: new Date().toISOString(), last_message_at: new Date().toISOString(),
      subject: 'Rates for Shanghai to Rotterdam', participant_email: 'ada@example.com', participant_name: 'Ada', status: 'new',
    };
    sb.db.email_threads.rows.push(thread);
    sb.db.email_messages.rows.push({
      id: 'aaaaaaaa-2222-4333-8444-555555555555', created_at: new Date().toISOString(),
      thread_id: thread.id, direction: 'inbound', from_email: 'ada@example.com',
      to_email: 'ops@paramount.test', subject: 'Rates for Shanghai to Rotterdam', message_id: '<ada-1@example.com>',
      has_attachments: false,
    });

    await withApp(
      {
        SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY,
        RESEND_API_KEY: 'test-key', MAILBOX_ADDRESS: 'ops@paramount.test',
      },
      async (base) => {
        const reply = (token, payload) => fetch(base + '/api/emails/reply', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' },
            token ? { Authorization: `Bearer ${token}` } : {}),
          body: JSON.stringify(payload),
        });

        const anon = await reply(null, { threadId: thread.id, body: 'hello' });
        assert.strictEqual(anon.status, 401, 'an unauthenticated caller cannot send mail as the studio');
        assert.strictEqual(sentMail.length, 0);
        console.log('  ok  replying without a session is refused');

        const nonAdmin = await reply(outsider.access_token, { threadId: thread.id, body: 'hello' });
        assert.strictEqual(nonAdmin.status, 403, 'a signed-in non-admin cannot send mail either');
        assert.strictEqual(sentMail.length, 0);
        console.log('  ok  a signed-in non-admin is refused');

        const empty = await reply(staff.access_token, { threadId: thread.id, body: '   ' });
        assert.strictEqual(empty.status, 422);
        console.log('  ok  an empty reply is rejected before sending');

        const missing = await reply(staff.access_token, { threadId: '99999999-2222-4333-8444-555555555555', body: 'hi' });
        assert.strictEqual(missing.status, 404);
        console.log('  ok  replying to a thread that does not exist is a 404');

        const ok = await reply(staff.access_token, { threadId: thread.id, body: 'Quoting next week.' });
        assert.strictEqual(ok.status, 201, JSON.stringify(await ok.json().catch(() => ({}))));
        assert.strictEqual(sentMail.length, 1);
        assert.deepStrictEqual(sentMail[0].to, ['ada@example.com']);
        assert.strictEqual(sentMail[0].subject, 'Re: Rates for Shanghai to Rotterdam', 'one Re: prefix, not two');
        // Threading headers are what put the reply inside Ada's conversation.
        assert.strictEqual(sentMail[0].headers['In-Reply-To'], '<ada-1@example.com>');
        // A bare MAILBOX_ADDRESS would otherwise show in the recipient's inbox
        // as "ops", the local part, rather than as the company.
        assert.strictEqual(sentMail[0].from, 'Paramount Shipping <ops@paramount.test>');
        // Written by a person, so no monospace HTML part goes with it.
        assert.strictEqual(sentMail[0].html, undefined);
        assert.strictEqual(sentMail[0].text, 'Quoting next week.');

        const outbound = sb.db.email_messages.rows.filter((r) => r.direction === 'outbound');
        assert.strictEqual(outbound.length, 1, 'the reply is recorded on the thread');
        assert.strictEqual(outbound[0].body_text, 'Quoting next week.');
        assert.strictEqual(outbound[0].message_id, 'resend-1');
        console.log('  ok  an admin reply sends, threads, and is filed as outbound');
      }
    );

    global.fetch = realFetch;
    sb.close();
  }

  /* ---- tracking: the desk books, the world looks it up ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    sb.createUser('desk@paramount.test', 'pw-desk', { admin: true });
    sb.createUser('visitor@example.com', 'pw-visitor');

    const signIn = async (email, password) => {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: mock.ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return (await res.json()).access_token;
    };

    const staff = await signIn('desk@paramount.test', 'pw-desk');
    const outsider = await signIn('visitor@example.com', 'pw-visitor');

    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, RESEND_API_KEY: '' },
      async (base) => {
        const asStaff = (method, path, body) =>
          fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staff}` },
            body: body ? JSON.stringify(body) : undefined,
          }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

        /* -- only the desk may touch a consignment ----------------------- */
        const anonymous = await req(base, 'POST', '/api/shipments', { shipper_name: 'x' });
        assert.strictEqual(anonymous.status, 401, 'no session, no booking');

        const notStaff = await fetch(base + '/api/shipments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${outsider}` },
          body: JSON.stringify({ shipper_name: 'x', receiver_name: 'y', origin_city: 'a', destination_city: 'b' }),
        });
        assert.strictEqual(notStaff.status, 403, 'a signed-in stranger is not the desk');
        console.log('  ok  booking a consignment needs a desk session');

        /* -- a booking mints a number and opens the timeline -------------- */
        const missing = await asStaff('POST', '/api/shipments', { shipper_name: 'Only a shipper' });
        assert.strictEqual(missing.status, 422);
        assert.deepStrictEqual(missing.body.fields, ['receiver_name', 'origin_city', 'destination_city']);
        console.log('  ok  a booking names every field it still needs');

        const created = await asStaff('POST', '/api/shipments', {
          shipper_name: 'Vestberg Components AB',
          receiver_name: 'Okonkwo Trading Ltd',
          receiver_email: 'rcv@example.com',
          origin_city: 'Gothenburg',
          origin_country: 'Sweden',
          destination_city: 'Lagos',
          destination_country: 'Nigeria',
          mode: 'ocean_freight',
          pieces: 12,
          weight_kg: 4200,
          internal_notes: 'margin is thin on this one',
          freight_cost: 8400,
        });
        assert.strictEqual(created.status, 201, JSON.stringify(created.body));
        const number = created.body.shipment.tracking_number;
        const id = created.body.shipment.id;
        assert.match(number, /^PMT-\d{4}-[0-9A-HJ-NP-Z]{8}$/, 'the number follows the published shape');
        assert.strictEqual(sb.db.shipment_events.rows.length, 1, 'the timeline opens with the booking');
        console.log('  ok  a booking mints a tracking number and opens the timeline:', number);

        /* -- anyone holding the number can look it up -------------------- */
        const tracked = await req(base, 'GET', `/api/track/${number}`);
        assert.strictEqual(tracked.status, 200);
        assert.strictEqual(tracked.body.shipment.status_label, 'Booking registered');
        assert.strictEqual(tracked.body.shipment.events.length, 1);
        assert.strictEqual(tracked.body.shipment.mode_label, 'Ocean freight');

        // Commercial and internal columns must never reach a public response.
        ['internal_notes', 'freight_cost', 'shipper_email', 'receiver_email', 'payment_status', 'id'].forEach((key) => {
          assert.ok(!(key in tracked.body.shipment), `${key} must not be public`);
        });
        console.log('  ok  a public lookup returns the customer view and nothing else');

        // Typed in lower case, without the dashes, with a stray space.
        const sloppy = await req(base, 'GET', `/api/track/${encodeURIComponent(` ${number.toLowerCase().replace(/-/g, '')} `)}`);
        assert.strictEqual(sloppy.status, 200);
        assert.strictEqual(sloppy.body.shipment.tracking_number, number);
        console.log('  ok  a number typed loosely still finds its consignment');

        const nonsense = await req(base, 'GET', '/api/track/NOT-A-NUMBER');
        assert.strictEqual(nonsense.status, 422);
        assert.strictEqual(nonsense.body.error, 'malformed_tracking_number');

        const unknown = await req(base, 'GET', '/api/track/PMT-2026-4F7K2QX9');
        assert.strictEqual(unknown.status, 404);
        assert.strictEqual(unknown.body.error, 'not_found');
        console.log('  ok  a malformed number and an unknown one are told apart');

        /* -- movement is an event, and it rolls up ------------------------ */
        const moved = await asStaff('POST', `/api/shipments/${id}/events`, {
          status: 'in_transit',
          location: 'Algeciras, Spain',
          lat: 36.13,
          lng: -5.45,
          note: 'Transhipped to MV Aurora.',
        });
        assert.strictEqual(moved.status, 201, JSON.stringify(moved.body));
        assert.strictEqual(moved.body.shipment.status, 'in_transit');
        assert.strictEqual(moved.body.shipment.current_location, 'Algeciras, Spain');

        const afterMove = await req(base, 'GET', `/api/track/${number}`);
        assert.strictEqual(afterMove.body.shipment.events.length, 2);
        assert.strictEqual(afterMove.body.shipment.events[0].location, 'Algeciras, Spain', 'newest first');
        assert.strictEqual(afterMove.body.shipment.progress, 45);
        console.log('  ok  a movement updates the consignment and the public timeline');

        const badStatus = await asStaff('POST', `/api/shipments/${id}/events`, { status: 'teleported' });
        assert.strictEqual(badStatus.status, 422);
        assert.strictEqual(badStatus.body.error, 'invalid_status');
        console.log('  ok  an unknown status is refused');

        /* -- an internal note stays off the customer's timeline ----------- */
        await asStaff('POST', `/api/shipments/${id}/events`, {
          status: 'exception',
          location: 'Desk',
          note: 'Chasing the consignee for a Form M.',
          internal: true,
        });
        const afterInternal = await req(base, 'GET', `/api/track/${number}`);
        assert.strictEqual(afterInternal.body.shipment.events.length, 2, 'the internal note is not published');
        assert.strictEqual(afterInternal.body.shipment.status, 'in_transit', 'and it does not move the consignment');

        const deskView = await asStaff('GET', `/api/shipments/${id}/events`);
        assert.strictEqual(deskView.body.events.length, 3, 'the desk sees it');
        console.log('  ok  an internal note is recorded for the desk and hidden from the customer');

        /* -- delivery closes it out --------------------------------------- */
        await asStaff('POST', `/api/shipments/${id}/events`, { status: 'delivered', location: 'Lagos, Nigeria', note: 'Signed by A. Bello.' });
        const delivered = await req(base, 'GET', `/api/track/${number}`);
        assert.strictEqual(delivered.body.shipment.is_delivered, true);
        assert.strictEqual(delivered.body.shipment.progress, 100);
        assert.ok(delivered.body.shipment.delivered_at, 'delivery is timestamped');
        console.log('  ok  delivery completes the progress and stamps the time');

        /* -- corrections, and what a correction may not do ----------------- */
        const patched = await asStaff('PATCH', `/api/shipments/${id}`, { carrier: 'Maersk Line', status: 'pending' });
        assert.strictEqual(patched.status, 200);
        assert.strictEqual(patched.body.shipment.carrier, 'Maersk Line');
        assert.strictEqual(patched.body.shipment.status, 'delivered', 'status only moves through an event');
        console.log('  ok  editing corrects the file but cannot rewrite the status');

        /* -- the desk list, and search ------------------------------------- */
        const list = await asStaff('GET', '/api/shipments?q=lagos');
        assert.strictEqual(list.body.count, 1);
        const none = await asStaff('GET', '/api/shipments?q=reykjavik');
        assert.strictEqual(none.body.count, 0);
        console.log('  ok  the desk can search its consignments');

        /* -- a supplied number must be one of ours, and unique ------------- */
        const clash = await asStaff('POST', '/api/shipments', {
          shipper_name: 'a', receiver_name: 'b', origin_city: 'c', destination_city: 'd', tracking_number: number,
        });
        assert.strictEqual(clash.status, 409);
        const malformed = await asStaff('POST', '/api/shipments', {
          shipper_name: 'a', receiver_name: 'b', origin_city: 'c', destination_city: 'd', tracking_number: 'ABC-123',
        });
        assert.strictEqual(malformed.status, 422);
        console.log('  ok  a supplied tracking number must be ours, and free');

        /* -- deleting takes the history with it ---------------------------- */
        const removed = await asStaff('DELETE', `/api/shipments/${id}`);
        assert.strictEqual(removed.status, 200);
        assert.strictEqual((await req(base, 'GET', `/api/track/${number}`)).status, 404);
        assert.strictEqual(sb.db.shipment_events.rows.length, 0, 'the events cascade');
        console.log('  ok  deleting a consignment takes its whole history with it');

        /* -- the chat answers a tracking question from the real record ----- */
        const live = await asStaff('POST', '/api/shipments', {
          shipper_name: 'Helio Pharma', receiver_name: 'St Mary Hospital',
          origin_city: 'Frankfurt', destination_city: 'Nairobi', mode: 'air_freight',
        });
        const liveNumber = live.body.shipment.tracking_number;
        await asStaff('POST', `/api/shipments/${live.body.shipment.id}/events`, {
          status: 'out_for_delivery', location: 'Nairobi, Kenya',
        });

        const asked = await req(base, 'POST', '/api/chat/message', {
          sessionId: 'chattoken12345',
          text: `hi, where is ${liveNumber} right now?`,
        });
        assert.strictEqual(asked.status, 201);
        const answer = asked.body.messages[1].text;
        assert.match(answer, /out for delivery/i, 'the widget answers from the record: ' + answer);
        assert.match(answer, /Nairobi/);
        console.log('  ok  the chat widget answers a tracking question from the record');

        const guessed = await req(base, 'POST', '/api/chat/message', {
          sessionId: 'chattoken12345',
          text: 'where is PMT-2026-4F7K2QX9?',
        });
        assert.match(guessed.body.messages[1].text, /could not find/i);
        console.log('  ok  and says so plainly when the number is not one of ours');
      }
    );
    sb.close();
  }

  /* ---- the customer portal ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    sb.createUser('desk@paramount.test', 'pw-desk', { admin: true });
    sb.createUser('ada@example.com', 'pw-ada');
    sb.createUser('mallory@example.com', 'pw-mallory');
    // Registered but never clicked the link in the confirmation email.
    sb.createUser('unconfirmed@example.com', 'pw-unconfirmed', { confirmed: false });

    const signIn = async (email, password) =>
      (await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: mock.ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }).then((r) => r.json())).access_token;

    const staff = await signIn('desk@paramount.test', 'pw-desk');
    const ada = await signIn('ada@example.com', 'pw-ada');
    const mallory = await signIn('mallory@example.com', 'pw-mallory');
    const unconfirmed = await signIn('unconfirmed@example.com', 'pw-unconfirmed');

    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, RESEND_API_KEY: '' },
      async (base) => {
        const as = (token) => (method, path, body) =>
          fetch(base + path, {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

        const desk = as(staff);
        const asAda = as(ada);
        const asMallory = as(mallory);
        const asUnconfirmed = as(unconfirmed);

        // Booked to Ada, in mixed case, which is how a person types it.
        const hers = (await desk('POST', '/api/shipments', {
          shipper_name: 'Vestberg AB', receiver_name: 'Ada Kolen', receiver_email: 'Ada@Example.com',
          origin_city: 'Gothenburg', destination_city: 'Rotterdam', mode: 'ocean_freight',
          internal_notes: 'margin is thin', freight_cost: 8400,
        })).body.shipment;

        // Booked to somebody else entirely.
        const theirs = (await desk('POST', '/api/shipments', {
          shipper_name: 'Someone', receiver_name: 'Someone Else', receiver_email: 'other@example.com',
          origin_city: 'Lagos', destination_city: 'Dubai', mode: 'air_freight',
        })).body.shipment;

        /* -- the portal is for people who are signed in -------------------- */
        assert.strictEqual((await req(base, 'GET', '/api/portal/shipments')).status, 401);
        console.log('  ok  the portal needs a session');

        /* -- a confirmed address collects its own consignments ------------- */
        const mine = await asAda('GET', '/api/portal/shipments');
        assert.strictEqual(mine.status, 200);
        assert.strictEqual(mine.body.count, 1, 'the consignment addressed to her, and only that one');
        assert.strictEqual(mine.body.shipments[0].tracking_number, hers.tracking_number);
        assert.strictEqual(mine.body.shipments[0].via, 'email');
        assert.strictEqual(mine.body.account.emailMatching, true);
        console.log('  ok  a confirmed address collects the consignments booked to it, whatever the case');

        // The portal is a customer view, so it carries no more than /track does.
        ['internal_notes', 'freight_cost', 'receiver_email', 'shipper_email', 'id'].forEach((key) => {
          assert.ok(!(key in mine.body.shipments[0]), `${key} must not reach the portal`);
        });
        console.log('  ok  and carries none of the commercial or internal detail');

        /* -- other people's consignments are not there --------------------- */
        const empty = await asMallory('GET', '/api/portal/shipments');
        assert.strictEqual(empty.body.count, 0, 'nothing is visible without a link to it');

        const peek = await asMallory('GET', `/api/portal/shipments/${hers.tracking_number}`);
        assert.strictEqual(peek.status, 404, "another customer's consignment is not readable");
        console.log('  ok  one account cannot read another account\'s consignments');

        /* -- an unconfirmed address is not proof of anything ---------------- */
        const unproved = await asUnconfirmed('GET', '/api/portal/shipments');
        assert.strictEqual(unproved.status, 200, 'the portal still works');
        assert.strictEqual(unproved.body.account.emailConfirmed, false);
        assert.strictEqual(unproved.body.account.emailMatching, false, 'but nothing is matched to it');
        console.log('  ok  an unconfirmed address matches nothing, and is told so');

        // The dangerous case, stated as a test: registering an address someone
        // else's consignments are booked to must not hand them over.
        sb.createUser('impostor@example.com', 'pw', { confirmed: false });
        sb.users.get('impostor@example.com').email = 'ada@example.com';
        const impostorToken = await signIn('impostor@example.com', 'pw');
        const stolen = await as(impostorToken)('GET', '/api/portal/shipments');
        assert.strictEqual(stolen.body.count, 0, "an unconfirmed claim on someone else's address sees nothing");
        console.log('  ok  registering an unconfirmed address does not hand over its consignments');

        /* -- claiming by tracking number ----------------------------------- */
        const claimed = await asMallory('POST', '/api/portal/claims', {
          // Typed the way it comes off a label: lower case, no dashes.
          trackingNumber: theirs.tracking_number.toLowerCase().replace(/-/g, ''),
        });
        assert.strictEqual(claimed.status, 201, JSON.stringify(claimed.body));
        assert.strictEqual(claimed.body.shipment.tracking_number, theirs.tracking_number);
        assert.strictEqual(claimed.body.shipment.via, 'claim');

        const again = await asMallory('POST', '/api/portal/claims', { trackingNumber: theirs.tracking_number });
        assert.strictEqual(again.status, 201, 'claiming twice is not an error');
        assert.strictEqual(sb.db.shipment_claims.rows.length, 1, 'and does not add a second row');
        console.log('  ok  a consignment is claimed with its number, and claiming twice is idempotent');

        const afterClaim = await asMallory('GET', '/api/portal/shipments');
        assert.strictEqual(afterClaim.body.count, 1);
        assert.strictEqual(afterClaim.body.shipments[0].via, 'claim');

        const opened = await asMallory('GET', `/api/portal/shipments/${theirs.tracking_number}`);
        assert.strictEqual(opened.status, 200);
        assert.ok(Array.isArray(opened.body.shipment.events), 'the whole timeline comes with it');
        console.log('  ok  a claimed consignment opens with its full timeline');

        const nonsense = await asMallory('POST', '/api/portal/claims', { trackingNumber: 'nope' });
        assert.strictEqual(nonsense.status, 422);
        const unknown = await asMallory('POST', '/api/portal/claims', { trackingNumber: 'PMT-2026-4F7K2QX9' });
        assert.strictEqual(unknown.status, 404);
        console.log('  ok  a malformed number and an unknown one are told apart when claiming');

        /* -- removing a claim ---------------------------------------------- */
        const dropped = await asMallory('DELETE', `/api/portal/claims/${theirs.tracking_number}`);
        assert.strictEqual(dropped.status, 200);
        assert.strictEqual((await asMallory('GET', '/api/portal/shipments')).body.count, 0);
        // The consignment itself is untouched by a customer tidying their list.
        assert.ok(await (await fetch(`${base}/api/track/${theirs.tracking_number}`)).json().then((d) => d.ok));
        console.log('  ok  removing a claim drops it from the account and leaves the consignment alone');

        /* -- the list reflects what the desk does -------------------------- */
        await desk('POST', `/api/shipments/${hers.id}/events`, {
          status: 'on_hold', location: 'Rotterdam', note: 'Awaiting customs paperwork.',
        });
        const updated = await asAda('GET', '/api/portal/shipments');
        assert.strictEqual(updated.body.shipments[0].status, 'on_hold');
        assert.strictEqual(updated.body.shipments[0].last_event.location, 'Rotterdam');
        assert.deepStrictEqual(updated.body.counts, { active: 0, delivered: 0, attention: 1 });
        console.log('  ok  a movement at the desk reaches the customer\'s list, and the counts');

        /* -- the desk can switch it off ------------------------------------ */
        sb.db.site_settings.rows[0].portal_enabled = false;
        // The settings cache holds for a few seconds; this is the read that skips it.
        await req(base, 'GET', '/api/site?fresh=1');
        const off = await asAda('GET', '/api/portal/shipments');
        assert.strictEqual(off.status, 404);
        assert.strictEqual(off.body.error, 'portal_disabled');
        sb.db.site_settings.rows[0].portal_enabled = true;
        await req(base, 'GET', '/api/site?fresh=1');
        console.log('  ok  the desk can turn the portal off');

        /* -- and can switch address matching off separately ---------------- */
        sb.db.site_settings.rows[0].portal_email_matching = false;
        await req(base, 'GET', '/api/site?fresh=1');
        const claimsOnly = await asAda('GET', '/api/portal/shipments');
        assert.strictEqual(claimsOnly.body.count, 0, 'with matching off, only claims are listed');
        assert.strictEqual(claimsOnly.body.account.emailMatching, false);
        sb.db.site_settings.rows[0].portal_email_matching = true;
        await req(base, 'GET', '/api/site?fresh=1');
        console.log('  ok  address matching can be turned off on its own');
      }
    );
    sb.close();
  }

  /* ---- the portal on a database that has not run 0005 ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    sb.createUser('desk@paramount.test', 'pw-desk', { admin: true });
    sb.createUser('ada@example.com', 'pw-ada');
    delete sb.db.shipment_claims;

    const signIn = async (email, password) =>
      (await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: mock.ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }).then((r) => r.json())).access_token;

    const staff = await signIn('desk@paramount.test', 'pw-desk');
    const ada = await signIn('ada@example.com', 'pw-ada');

    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, RESEND_API_KEY: '' },
      async (base) => {
        const as = (token) => (method, path, body) =>
          fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: body ? JSON.stringify(body) : undefined,
          }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

        const made = await as(staff)('POST', '/api/shipments', {
          shipper_name: 'S', receiver_name: 'Ada Kolen', receiver_email: 'ada@example.com',
          origin_city: 'Gothenburg', destination_city: 'Rotterdam',
        });

        // Matching still works, because it does not need the claims table.
        const list = await as(ada)('GET', '/api/portal/shipments');
        assert.strictEqual(list.status, 200, 'the portal still answers');
        assert.strictEqual(list.body.count, 1);
        assert.strictEqual(list.body.shipments[0].via, 'email');

        // Claiming cannot work, and says so rather than failing as a 500.
        const claim = await as(ada)('POST', '/api/portal/claims', {
          trackingNumber: made.body.shipment.tracking_number,
        });
        assert.strictEqual(claim.status, 503);
        assert.strictEqual(claim.body.error, 'claims_unavailable');

        const health = await req(base, 'GET', '/api/health?probe=1');
        assert.ok(
          health.body.warnings.some((w) => /shipment_claims[\s\S]*0005_portal\.sql/.test(w)),
          'the probe names the migration: ' + JSON.stringify(health.body.warnings)
        );
        console.log('  ok  without 0005 the portal degrades to address matching and names the migration');
      }
    );
    sb.close();
  }

  /* ---- rate requests ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, RESEND_API_KEY: '' },
      async (base) => {
        const bad = await req(base, 'POST', '/api/quotes', { name: 'x', email: 'not-an-email' });
        assert.strictEqual(bad.status, 422);
        assert.deepStrictEqual(
          Object.keys(bad.body.fields).sort(),
          ['destination', 'email', 'mode', 'name', 'origin']
        );
        console.log('  ok  a rate request reports every missing field at once');

        const good = await req(base, 'POST', '/api/quotes', {
          name: 'Dana Okafor', email: 'dana@example.com', company: 'Okafor Imports',
          mode: 'ocean_freight', origin: 'Shanghai', destination: 'Rotterdam',
          weightKg: 8200, pieces: 4, readyDate: '2026-11-02', message: 'Two 40ft HC monthly.',
        });
        assert.strictEqual(good.status, 201, JSON.stringify(good.body));
        assert.strictEqual(good.body.stored, 'quote_requests');
        assert.strictEqual(sb.db.quote_requests.rows.length, 1);
        const row = sb.db.quote_requests.rows[0];
        assert.strictEqual(row.origin, 'Shanghai');
        assert.strictEqual(row.weight_kg, 8200);
        assert.strictEqual(row.ready_date, '2026-11-02');
        console.log('  ok  a rate request is filed with its cargo details');

        // The honeypot is filled only by bots: accepted, and dropped.
        const trap = await req(base, 'POST', '/api/quotes', {
          name: 'Bot', email: 'bot@example.com', mode: 'air_freight',
          origin: 'Aarhus', destination: 'Bergen', website: 'http://spam.example',
        });
        assert.strictEqual(trap.status, 201);
        assert.strictEqual(sb.db.quote_requests.rows.length, 1, 'the trap submission is not filed');
        console.log('  ok  a honeypot submission is accepted and dropped');
      }
    );
    sb.close();
  }

  /* ---- the tracking product is covered by the schema probe ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    delete sb.db.shipments;
    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const health = await req(base, 'GET', '/api/health?probe=1');
        assert.ok(
          health.body.warnings.some((w) => /shipments[\s\S]*0003_shipments\.sql/.test(w)),
          'the probe must name the migration that creates it: ' + JSON.stringify(health.body.warnings)
        );
        console.log('  ok  a database without the shipment tables is told which file adds them');
      }
    );
    sb.close();
  }

  /* ---- the fleet behind the home page ---- */
  {
    const fleet = require(ROOT + '/src/utils/fleet');
    const now = Date.now();
    const snap = fleet.snapshot(now);

    assert.ok(snap.vessels.length >= 8, 'there is a fleet to draw');
    assert.ok(snap.underway > 0 && snap.underway <= snap.count, 'some of it is at sea');

    snap.vessels.forEach((v) => {
      assert.ok(Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180, `${v.name} is on the planet`);
      assert.match(v.latitude, /^\d+°\d+\.\d'[NS]$/, `${v.name} latitude reads as a chart prints it`);
      assert.match(v.longitude, /^\d+°\d+\.\d'[EW]$/, `${v.name} longitude reads as a chart prints it`);
      assert.ok(v.course >= 0 && v.course <= 360, `${v.name} has a course`);
      assert.ok(v.track.length >= 2, `${v.name} has a track to draw`);
      assert.ok(v.imo && v.mmsi && v.callsign, `${v.name} carries its identifiers`);
      // The next call has to be a port. A waypoint in the middle of an ocean
      // is not something a customer can be told to expect it at.
      assert.strictEqual(v.nextPort.kind, 'port', `${v.name} reports a real next port`);
    });
    console.log('  ok  every vessel reports a position, a heading and a real next port');

    // An hour on, each one has moved by the distance its own speed implies.
    const later = fleet.snapshot(now + 3600000);
    snap.vessels.forEach((v, i) => {
      const then = later.vessels[i];
      const moved = fleet.distanceNm({ lat: v.lat, lng: v.lng }, { lat: then.lat, lng: then.lng });
      if (v.inPort) return;
      assert.ok(
        Math.abs(moved - v.speed) < 1.5,
        `${v.name} moved ${moved.toFixed(1)} nm in an hour but reports ${v.speed} kn`
      );
    });
    console.log('  ok  and moves at exactly the speed it reports');

    // The whole fleet must not be alongside at once, whenever you look.
    let sailingSomewhere = 0;
    for (let d = 0; d < 30; d += 1) {
      if (fleet.snapshot(now + d * 86400000).underway > 0) sailingSomewhere += 1;
    }
    assert.strictEqual(sailingSomewhere, 30, 'there are vessels at sea on every one of the next 30 days');
    console.log('  ok  the fleet is still sailing a month from now');
  }

  /* ---- the lane suggestions the booking form runs on ---- */
  {
    const places = require(ROOT + '/src/utils/places');

    assert.strictEqual(places.search('rotter')[0].locode, 'NLRTM', 'a partial city name finds the port');
    assert.strictEqual(places.search('nlrtm')[0].name, 'Rotterdam', 'and so does its LOCODE');
    assert.strictEqual(places.search('')[0], undefined, 'an empty query suggests nothing');

    // The mode has to survive the cases a single distance rule gets wrong.
    const mode = (a, b) => places.suggestLane(a, b).mode;
    assert.strictEqual(mode('Rotterdam', 'Hamburg'), 'road_haulage', 'a short hop on one landmass drives');
    assert.strictEqual(mode('Auckland', 'Sydney'), 'ocean_freight', 'a lorry cannot cross the Tasman Sea');
    assert.strictEqual(mode('Tokyo', 'Seoul'), 'air_freight', 'nor the Sea of Japan');
    assert.strictEqual(mode('Los Angeles', 'New York'), 'rail_freight', 'coast to coast goes overland, not via Panama');
    assert.strictEqual(mode('Shanghai', 'Rotterdam'), 'ocean_freight', 'a seaport at both ends beats the block train');
    assert.strictEqual(mode('Chengdu', 'Duisburg'), 'rail_freight', 'two inland hubs on the rail network take it');
    assert.strictEqual(mode('Nairobi', 'London'), 'air_freight', 'there is no rail out of East Africa');
    console.log('  ok  a lane is offered the mode it would actually book');

    // Transit times are what the customer is quoted, so they are checked
    // against published port-to-port figures rather than left to a formula.
    const days = (a, b) => places.suggestLane(a, b).transit_days;
    const near = (got, want, slack, what) =>
      assert.ok(Math.abs(got - want) <= slack, `${what}: got ${got}d, expected about ${want}d`);
    near(days('Shanghai', 'Rotterdam'), 30, 4, 'Asia to Europe through Suez');
    near(days('Busan', 'Long Beach'), 20, 4, 'trans-Pacific');
    near(days('Ningbo', 'New York'), 33, 5, 'Asia to the US east coast through Panama');
    near(days('Valencia', 'New York'), 14, 4, 'trans-Atlantic');
    // The basin split is the point: the same origin, two American coasts.
    assert.ok(
      days('Ningbo', 'New York') - days('Shanghai', 'Oakland') > 8,
      'the east coast is a long way further than the west'
    );
    console.log('  ok  transit times land near the published figures');
  }

  /* ---- where a consignment is between scans ---- */
  {
    const voyage = require(ROOT + '/src/utils/voyage');
    const searoute = require(ROOT + '/src/utils/searoute');
    const now = Date.parse('2026-06-01T00:00:00Z');

    const box = {
      mode: 'ocean_freight',
      status: 'in_transit',
      origin_lat: 31.2304, origin_lng: 121.4737,
      destination_lat: 51.9244, destination_lng: 4.4777,
      departed_at: new Date(now - 12 * 86400000).toISOString(),
      estimated_delivery: new Date(now + 18 * 86400000).toISOString(),
    };

    const here = voyage.position(box, [], now);
    assert.ok(here, 'a consignment with both ends gets a position');
    // Twelve days out of thirty: in the Arabian Sea, not over Siberia, which
    // is where the great circle between these two ports runs.
    assert.ok(here.lat > 0 && here.lat < 20, `should be in the tropics, got ${here.lat}`);
    assert.ok(here.lng > 55 && here.lng < 95, `should be in the Indian Ocean, got ${here.lng}`);
    assert.ok(here.route.length > 10, 'and it follows the lane network, not a straight line');
    assert.ok(here.route_nm > 9500 && here.route_nm < 11500, `Shanghai-Rotterdam is about 10,500 nm, got ${here.route_nm}`);

    // It advances, and it never overshoots the destination.
    const later = voyage.position(box, [], now + 6 * 86400000);
    assert.ok(later.progress > here.progress, 'the position advances with the clock');
    const overdue = voyage.position(box, [], now + 60 * 86400000);
    assert.strictEqual(overdue.progress, 1, 'and stops at the destination rather than sailing past it');
    assert.strictEqual(overdue.remaining_nm, 0);

    // A recorded scan outranks the estimate: the marker jumps to the fix.
    const scanned = voyage.position(
      box,
      [{ status: 'in_transit', occurred_at: new Date(now - 1 * 86400000).toISOString(), lat: 12.5, lng: 43.3 }],
      now
    );
    assert.strictEqual(scanned.anchor.location, null);
    assert.ok(scanned.lng < 43.4, `a scan at Bab el-Mandeb moves the marker past it, got ${scanned.lng}`);

    // Nothing to say is said as nothing, not as a guess.
    assert.strictEqual(voyage.position({ mode: 'ocean_freight', status: 'in_transit' }, []), null);
    assert.strictEqual(voyage.position({ ...box, status: 'pending' }, [], now).progress, 0);
    assert.strictEqual(voyage.position({ ...box, status: 'delivered' }, [], now).progress, 1);

    // Every sea route stays on the water it was routed through.
    const suez = searoute.route({ lat: 31.23, lng: 121.47 }, { lat: 51.92, lng: 4.48 });
    assert.ok(suez.some((p) => p.name === 'Suez'), 'Asia to Europe goes through the canal');
    assert.ok(suez.some((p) => p.name === 'Malacca Strait'), 'and through Malacca');
    console.log('  ok  a consignment is placed on real water and moves with the clock');
  }

  /* ---- a consignment held, and why ---- */
  {
    const voyage = require(ROOT + '/src/utils/voyage');
    const now = Date.parse('2026-06-01T00:00:00Z');
    const box = {
      mode: 'ocean_freight', status: 'in_transit',
      origin_lat: 31.2304, origin_lng: 121.4737,
      destination_lat: 51.9244, destination_lng: 4.4777,
      departed_at: new Date(now - 12 * 86400000).toISOString(),
      estimated_delivery: new Date(now + 18 * 86400000).toISOString(),
    };
    const sailed = {
      status: 'picked_up', occurred_at: new Date(now - 12 * 86400000).toISOString(),
      lat: 31.23, lng: 121.47, location: 'Shanghai, China',
    };
    const stoppedAtSuez = {
      status: 'on_hold', occurred_at: new Date(now - 2 * 86400000).toISOString(),
      lat: 29.97, lng: 32.55, location: 'Suez, Egypt',
      note: 'Waiting on a corrected certificate of origin.',
    };

    const moving = voyage.position(box, [sailed], now);
    assert.strictEqual(moving.hold, null, 'a consignment under way is not held');
    assert.strictEqual(moving.moving, true);

    const held = voyage.position({ ...box, status: 'on_hold' }, [sailed, stoppedAtSuez], now);
    assert.strictEqual(held.moving, false, 'a held consignment stops');
    assert.strictEqual(held.source, 'held');
    // It sits where the desk stopped it, not where the clock would have put it.
    assert.ok(Math.abs(held.lat - 29.97) < 0.2 && Math.abs(held.lng - 32.55) < 0.2,
      `held at the hold's own coordinates, got ${held.lat},${held.lng}`);
    assert.strictEqual(held.hold.location, 'Suez, Egypt');
    assert.match(held.hold.reason, /certificate of origin/);
    assert.ok(held.hold.since, 'and says since when');

    // The reason is the desk's published note. An internal one never gets here,
    // because toPublic filters internal events before voyage sees them.
    const secret = { ...stoppedAtSuez, note: 'Customer has not paid.', internal: true };
    const publicView = require(ROOT + '/src/utils/shipmentStore').toPublic(
      { ...box, status: 'on_hold', tracking_number: 'PMT-2026-TESTTEST' },
      [sailed, secret]
    );
    assert.ok(!JSON.stringify(publicView).includes('has not paid'), 'an internal hold note is never published');

    // Released, it moves again and the hold is gone.
    const released = voyage.position(
      { ...box, status: 'in_transit' },
      [sailed, stoppedAtSuez, { status: 'in_transit', occurred_at: new Date(now - 86400000).toISOString(), lat: 29.97, lng: 32.55, location: 'Suez, Egypt', note: 'Released.' }],
      now
    );
    assert.strictEqual(released.hold, null, 'releasing clears the hold');
    assert.strictEqual(released.moving, true, 'and it sails on');
    console.log('  ok  a held consignment stops where it was stopped, and says why');
  }

  /* ---- no sign-up, and the reset that is left tells nobody anything ---- */
  {
    const sb = await mock.start({});
    const sbUrl = `http://127.0.0.1:${sb.address().port}`;
    sb.createUser('already@example.com', 'has-an-account');

    const realFetch = global.fetch;
    const posted = [];
    global.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/')) {
        posted.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'resend-auth' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url, init);
    };

    try {
      await withApp(
        {
          SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY,
          RESEND_API_KEY: 'test-key', FORM_FROM: 'Paramount Shipping <hello@paramountshipping.com>',
          PUBLIC_SITE_URL: 'https://paramountshipping.com',
        },
        async (base) => {
          // There is no way to register. Tracking needs no account, so a
          // sign-up would put a confirmation email in front of something the
          // visitor could already see.
          const register = await req(base, 'POST', '/api/portal/register', {
            email: 'new@example.com', password: 'a-long-enough-one',
          });
          assert.strictEqual(register.status, 404, 'there is no sign-up route');
          assert.strictEqual(posted.length, 0, 'and nothing was sent');
          assert.ok(!sb.users.has('new@example.com'), 'and no account was made');

          // Reset, for the accounts the desk opened, is ours to send.
          const known = await req(base, 'POST', '/api/portal/reset', { email: 'Already@Example.com' });
          assert.strictEqual(known.status, 202, JSON.stringify(known.body));
          assert.strictEqual(posted.length, 1, 'one email, sent by us');

          const mail = posted[0];
          assert.deepStrictEqual(mail.to, ['already@example.com'], 'the address is normalised');
          assert.strictEqual(mail.from, 'Paramount Shipping <hello@paramountshipping.com>', 'from our domain');
          assert.match(mail.subject, /Set a new password/);
          assert.match(mail.html, /auth\/v1\/verify\?token=/, 'carrying the link Supabase minted');
          assert.match(mail.html, /redirect_to=https%3A%2F%2Fparamountshipping\.com%2Fportal/, 'that comes back to the portal');
          assert.match(mail.text, /auth\/v1\/verify/, 'and a text part for clients that want one');

          // Supabase was asked to mint, never to send.
          assert.deepStrictEqual(sb.generatedLinks, [{ type: 'recovery', email: 'already@example.com' }]);

          // An address with no account is answered exactly the same way, and
          // sent nothing. The response must not say which it was.
          posted.length = 0;
          const unknown = await req(base, 'POST', '/api/portal/reset', { email: 'nobody@example.com' });
          assert.strictEqual(unknown.status, 202);
          assert.strictEqual(posted.length, 0, 'an unknown address is sent nothing');
          assert.strictEqual(
            unknown.body.message.replace('nobody@example.com', 'x'),
            known.body.message.replace('already@example.com', 'x'),
            'and reads exactly like one that was'
          );

          const bad = await req(base, 'POST', '/api/portal/reset', { email: 'not-an-address' });
          assert.strictEqual(bad.status, 422);
          console.log('  ok  no sign-up, and the reset tells nobody who has an account');
        }
      );
    } finally {
      global.fetch = realFetch;
      sb.close();
    }
  }

  /* ---- photos: a customer asks, the desk uploads, the tracker shows it ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    sb.createUser('desk@paramount.test', 'pw-desk', { admin: true });
    const staff = (await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: mock.ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'desk@paramount.test', password: 'pw-desk' }),
    }).then((r) => r.json())).access_token;

    // Enough of a JPEG for the type check, which reads the leading bytes.
    const jpeg = (size) => {
      const buf = Buffer.alloc(size, 7);
      buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; buf[3] = 0xe0;
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    };

    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, RESEND_API_KEY: '' },
      async (base) => {
        const asStaff = (method, path, body) =>
          fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staff}` },
            body: body ? JSON.stringify(body) : undefined,
          }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

        const made = await asStaff('POST', '/api/shipments', {
          shipper_name: 'Vestberg Components AB', receiver_name: 'Okonkwo Trading Ltd',
          origin_city: 'Gothenburg', destination_city: 'Lagos', mode: 'ocean_freight',
        });
        const { id, tracking_number: number } = made.body.shipment;

        /* -- anyone with the number may ask ------------------------------ */
        const ask = (body, n = number) => req(base, 'POST', `/api/track/${n}/photo-request`, body);

        const first = await ask({ email: 'Ada@Example.com', note: 'The seal, please.' });
        assert.strictEqual(first.status, 201, first.text);
        assert.strictEqual(first.body.request.open, true);
        assert.strictEqual(sb.db.photo_requests.rows.length, 1);
        assert.strictEqual(sb.db.photo_requests.rows[0].email, 'ada@example.com', 'addresses are folded');

        const again = await ask({ email: 'ada@example.com' });
        assert.strictEqual(again.status, 200);
        assert.strictEqual(again.body.duplicate, true);
        assert.strictEqual(sb.db.photo_requests.rows.length, 1, 'asking twice is one request');

        const anonymous = await ask({});
        assert.strictEqual(anonymous.status, 201);
        assert.strictEqual(sb.db.photo_requests.rows.length, 2, 'someone else holding the number is another');

        assert.strictEqual((await ask({ email: 'not-an-address' })).status, 422);
        assert.strictEqual((await ask({ website: 'http://spam.test' })).status, 201);
        assert.strictEqual(sb.db.photo_requests.rows.length, 2, 'the honeypot files nothing');
        assert.strictEqual((await ask({}, 'PMT-2026-4F7K2QX9')).status, 404);
        assert.strictEqual((await ask({}, 'nonsense')).status, 422);
        console.log('  ok  anyone holding the number can ask for a photo, once');

        const waiting = await req(base, 'GET', `/api/track/${number}`);
        assert.strictEqual(waiting.body.shipment.photo_request.open, true);
        assert.deepStrictEqual(waiting.body.shipment.photos, []);
        assert.ok(!/ada@example\.com/i.test(waiting.text), 'who asked is never on the public page');
        console.log('  ok  the tracking page says a photo is on its way, and not who asked');

        /* -- the desk sees who is waiting --------------------------------- */
        const listed = await asStaff('GET', '/api/shipments');
        assert.strictEqual(listed.body.shipments.find((r) => r.id === id).photo_requested, true);
        assert.strictEqual((await req(base, 'GET', `/api/shipments/${id}/photos`)).status, 401, 'photos are desk-only here');
        const gallery = await asStaff('GET', `/api/shipments/${id}/photos`);
        assert.strictEqual(gallery.body.requests.length, 2);
        console.log('  ok  the desk list flags a consignment someone is waiting on');

        /* -- only real images go up --------------------------------------- */
        const svg = `data:image/jpeg;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
        const disguised = await asStaff('POST', `/api/shipments/${id}/photos`, { image: svg });
        assert.strictEqual(disguised.status, 422);
        assert.strictEqual(disguised.body.error, 'invalid_image');
        assert.strictEqual((await asStaff('POST', `/api/shipments/${id}/photos`, {})).status, 422);
        console.log('  ok  a file is judged by its bytes, not by what it says it is');

        /* -- uploading answers everyone who asked ------------------------- */
        // 1.5 MB: over the ordinary 1 MB body limit, inside the photo one.
        const up = await asStaff('POST', `/api/shipments/${id}/photos`, {
          image: jpeg(1.5 * 1024 * 1024),
          caption: 'Loaded at Gothenburg, seal 448120',
        });
        assert.strictEqual(up.status, 201, JSON.stringify(up.body));
        assert.strictEqual(up.body.answered, 2);
        assert.ok(sb.db.photo_requests.rows.every((r) => r.status === 'done' && r.fulfilled_at));
        const stored = [...sb.storage.get('consignment-photos').keys()];
        assert.strictEqual(stored.length, 1);
        assert.ok(stored[0].startsWith(`${id}/`) && stored[0].endsWith('.jpg'), stored[0]);
        const served = await fetch(up.body.photo.url);
        assert.strictEqual(served.status, 200, 'the public address serves the image');
        assert.strictEqual(served.headers.get('content-type'), 'image/jpeg');
        console.log('  ok  an upload lands in the bucket and answers every open request');

        const shown = await req(base, 'GET', `/api/track/${number}`);
        assert.strictEqual(shown.body.shipment.photos.length, 1);
        assert.strictEqual(shown.body.shipment.photos[0].caption, 'Loaded at Gothenburg, seal 448120');
        assert.strictEqual(shown.body.shipment.photos[0].url, up.body.photo.url);
        assert.strictEqual(shown.body.shipment.photo_request.open, false);
        const relisted = await asStaff('GET', '/api/shipments');
        assert.strictEqual(relisted.body.shipments.find((r) => r.id === id).photo_requested, false);
        console.log('  ok  the photo is on the tracking page and the request is closed');

        const huge = await asStaff('POST', `/api/shipments/${id}/photos`, { image: jpeg(3.2 * 1024 * 1024) });
        assert.strictEqual(huge.status, 413);
        console.log('  ok  an image past the limit is refused as too large');

        /* -- and it can be taken down ------------------------------------ */
        const photoId = up.body.photo.id;
        assert.strictEqual((await asStaff('DELETE', `/api/shipments/${id}/photos/${photoId}`)).status, 200);
        assert.strictEqual(sb.storage.get('consignment-photos').size, 0, 'the file goes with the row');
        assert.strictEqual((await req(base, 'GET', `/api/track/${number}`)).body.shipment.photos.length, 0);
        assert.strictEqual((await asStaff('DELETE', `/api/shipments/${id}/photos/${photoId}`)).status, 404);
        console.log('  ok  removing a photo takes it off the page and out of the bucket');
      }
    );
    sb.close();
  }

  /* ---- photos on a project that has not run 0006 ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    sb.createUser('desk@paramount.test', 'pw-desk', { admin: true });
    const staff = (await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: mock.ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'desk@paramount.test', password: 'pw-desk' }),
    }).then((r) => r.json())).access_token;
    delete sb.db.shipment_photos;
    delete sb.db.photo_requests;

    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, RESEND_API_KEY: '' },
      async (base) => {
        const asStaff = (method, path, body) =>
          fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staff}` },
            body: body ? JSON.stringify(body) : undefined,
          }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

        const made = await asStaff('POST', '/api/shipments', {
          shipper_name: 'S', receiver_name: 'R', origin_city: 'Gothenburg', destination_city: 'Lagos',
        });
        const { id, tracking_number: number } = made.body.shipment;

        const tracked = await req(base, 'GET', `/api/track/${number}`);
        assert.strictEqual(tracked.status, 200, 'tracking does not depend on the photo tables');
        assert.deepStrictEqual(tracked.body.shipment.photos, []);
        assert.strictEqual((await asStaff('GET', '/api/shipments')).status, 200, 'nor does the desk list');

        const ask = await req(base, 'POST', `/api/track/${number}/photo-request`, {});
        assert.strictEqual(ask.status, 503);
        assert.match(ask.body.message, /0006_photos\.sql/);

        const buf = Buffer.alloc(64, 1);
        buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
        const up = await asStaff('POST', `/api/shipments/${id}/photos`, { image: `data:image/jpeg;base64,${buf.toString('base64')}` });
        assert.strictEqual(up.status, 503);
        assert.match(up.body.message, /0006_photos\.sql/);
        assert.strictEqual(sb.storage.get('consignment-photos').size, 0, 'no orphan left in the bucket');
        console.log('  ok  without 0006 tracking still works and the desk is told which file to run');
      }
    );
    sb.close();

    const bare = await mock.start({ buckets: [] });
    const bareUrl = `http://127.0.0.1:${bare.address().port}`;
    bare.createUser('desk@paramount.test', 'pw-desk', { admin: true });
    const bareStaff = (await fetch(`${bareUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: mock.ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'desk@paramount.test', password: 'pw-desk' }),
    }).then((r) => r.json())).access_token;
    await withApp(
      { SUPABASE_URL: bareUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, RESEND_API_KEY: '' },
      async (base) => {
        const post = (path, body) => fetch(base + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bareStaff}` },
          body: JSON.stringify(body),
        }).then(async (r) => ({ status: r.status, body: await r.json() }));
        const made = await post('/api/shipments', {
          shipper_name: 'S', receiver_name: 'R', origin_city: 'Gothenburg', destination_city: 'Lagos',
        });
        const buf = Buffer.alloc(64, 1);
        buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
        const up = await post(`/api/shipments/${made.body.shipment.id}/photos`, { image: `data:image/jpeg;base64,${buf.toString('base64')}` });
        assert.strictEqual(up.status, 503);
        assert.strictEqual(up.body.error, 'bucket_missing');
        assert.match(up.body.message, /consignment-photos[\s\S]*0006_photos\.sql/);
        console.log('  ok  a project without the bucket is told how to make it');
      }
    );
    bare.close();
  }

  /* ---- photos without Supabase, on the local files ---- */
  {
    const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'paramount-photos-'));
    await withApp(
      { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '', VITE_SUPABASE_URL: '', DATA_DIR: dir, RESEND_API_KEY: '' },
      async (base) => {
        const store = require(ROOT + '/src/utils/shipmentStore');
        const photoStore = require(ROOT + '/src/utils/photoStore');
        const made = await store.create({ shipper_name: 'S', receiver_name: 'R', origin_city: 'Tema', destination_city: 'Lagos' });

        const ask = await req(base, 'POST', `/api/track/${made.tracking_number}/photo-request`, { email: 'kofi@example.com' });
        assert.strictEqual(ask.status, 201, ask.text);
        assert.strictEqual((await req(base, 'GET', `/api/track/${made.tracking_number}`)).body.shipment.photo_request.open, true);

        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
        await photoStore.addPhoto(made.id, { dataUrl: `data:image/png;base64,${png.toString('base64')}`, caption: 'At Tema' });
        assert.strictEqual((await photoStore.fulfilRequests(made.id)).length, 1);

        const shown = (await req(base, 'GET', `/api/track/${made.tracking_number}`)).body.shipment;
        assert.strictEqual(shown.photos.length, 1);
        assert.match(shown.photos[0].url, /^data:image\/png;base64,/);
        assert.strictEqual(shown.photo_request.open, false);
        console.log('  ok  without Supabase the whole photo loop runs on local files');
      }
    );
    delete process.env.DATA_DIR;
    require('fs').rmSync(dir, { recursive: true, force: true });
  }

  /* ---- email: what actually leaves for Resend ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    sb.createUser('desk@paramount.test', 'pw-desk', { admin: true });
    const staff = (await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: mock.ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'desk@paramount.test', password: 'pw-desk' }),
    }).then((r) => r.json())).access_token;

    // Resend, stood in for at the network edge: every message the server
    // hands it is kept, exactly as sent, and it answers as Resend does.
    const sent = [];
    let answer = () => new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200 });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const target = typeof input === 'string' ? input : input.url;
      if (target === 'https://api.resend.com/emails') {
        sent.push({ auth: init.headers.Authorization, ...JSON.parse(init.body) });
        return answer();
      }
      return realFetch(input, init);
    };
    const mailTo = (address) => sent.filter((m) => [].concat(m.to).includes(address));

    try {
      await withApp(
        {
          SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY,
          RESEND_API_KEY: 're_test_key',
          FORM_FROM: 'Paramount Shipping <desk@paramountshipping.test>',
          FORM_TO: 'ops@paramountshipping.test',
          SITE_URL: 'https://www.paramountshipping.test',
        },
        async (base) => {
          const asStaff = (method, path, body) =>
            fetch(base + path, {
              method,
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staff}` },
              body: body ? JSON.stringify(body) : undefined,
            }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

          /* -- booking: the customer gets their number --------------------- */
          const made = await asStaff('POST', '/api/shipments', {
            shipper_name: 'Vestberg Components AB', shipper_email: 'ship@example.com',
            receiver_name: 'Okonkwo Trading Ltd', receiver_email: 'rcv@example.com',
            origin_city: 'Gothenburg', destination_city: 'Lagos', mode: 'ocean_freight',
          });
          const { id, tracking_number: number } = made.body.shipment;
          const booked = mailTo('rcv@example.com')[0];
          assert.ok(booked, 'the consignee is emailed on booking: ' + JSON.stringify(sent.map((m) => m.to)));
          assert.deepStrictEqual([...booked.to].sort(), ['rcv@example.com', 'ship@example.com']);
          assert.strictEqual(booked.from, 'Paramount Shipping <desk@paramountshipping.test>');
          assert.strictEqual(booked.auth, 'Bearer re_test_key');
          assert.match(booked.subject, new RegExp(number));
          assert.match(booked.text, new RegExp(`https://www\\.paramountshipping\\.test/\\?number=${number}#track`));
          assert.strictEqual(mailTo('ops@paramountshipping.test').length, 1, 'and the desk hears about it');
          console.log('  ok  booking emails the tracking number to the shipper and consignee');

          /* -- a hold: the customer is told where and why ------------------- */
          sent.length = 0;
          const held = await asStaff('POST', `/api/shipments/${id}/events`, {
            status: 'on_hold', location: 'Suez, Egypt', lat: 29.97, lng: 32.55,
            note: 'Waiting on a corrected certificate of origin.',
          });
          assert.strictEqual(held.status, 201);
          assert.strictEqual(held.body.notified.ok, true, JSON.stringify(held.body.notified));
          const holdMail = mailTo('rcv@example.com')[0];
          assert.match(holdMail.subject, new RegExp(`${number}: On hold — Suez, Egypt`));
          assert.match(holdMail.text, /Note: Waiting on a corrected certificate of origin\./);
          const released = await asStaff('POST', `/api/shipments/${id}/events`, {
            status: 'in_transit', location: 'Suez, Egypt', note: 'Certificate accepted.',
          });
          assert.strictEqual(released.body.notified.ok, true);
          assert.match(sent[sent.length - 1].subject, /In transit/);
          console.log('  ok  holding and releasing email the customer, with the reason');

          // An internal note stays internal: nothing leaves.
          sent.length = 0;
          await asStaff('POST', `/api/shipments/${id}/events`, { status: 'in_transit', note: 'desk only', internal: true });
          assert.strictEqual(sent.length, 0, 'an internal movement sends nothing');

          /* -- a photo: the desk is told, then the customer ------------------ */
          sent.length = 0;
          await req(base, 'POST', `/api/track/${number}/photo-request`, { email: 'ada@example.com', note: 'The seal.' });
          const deskAsk = mailTo('ops@paramountshipping.test')[0];
          assert.ok(deskAsk, 'the desk is emailed a photo request');
          assert.match(deskAsk.subject, new RegExp(`Photo requested: ${number}`));
          assert.strictEqual(deskAsk.reply_to, 'ada@example.com', 'replying goes to whoever asked');
          assert.match(deskAsk.text, /The seal\./);

          sent.length = 0;
          const jpeg = Buffer.alloc(2048, 3);
          jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff;
          const up = await asStaff('POST', `/api/shipments/${id}/photos`, {
            image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, caption: 'Sealed',
          });
          assert.strictEqual(up.status, 201);
          assert.strictEqual(up.body.notified.recipients, 1);
          const ready = mailTo('ada@example.com')[0];
          assert.match(ready.subject, new RegExp(`Photo of your consignment ${number}`));
          assert.match(ready.text, new RegExp(`\\?number=${number}#track`));
          assert.strictEqual(ready.html, undefined, 'a plain message, not the monospace block');
          console.log('  ok  a photo request emails the desk, and the upload emails whoever asked');

          /* -- the desk's own test button ------------------------------------ */
          sent.length = 0;
          assert.strictEqual((await req(base, 'POST', '/api/emails/test', {})).status, 401, 'desk only');
          const test = await asStaff('POST', '/api/emails/test', {});
          assert.strictEqual(test.status, 200, JSON.stringify(test.body));
          assert.deepStrictEqual(sent[0].to, ['ops@paramountshipping.test'], 'blank goes to the notification address');
          assert.match(test.body.message, /sent as Paramount Shipping <desk@paramountshipping\.test> to ops@paramountshipping\.test/);
          const toOther = await asStaff('POST', '/api/emails/test', { to: 'me@example.com' });
          assert.strictEqual(toOther.status, 200);
          assert.deepStrictEqual(sent[1].to, ['me@example.com']);

          // Resend refusing is reported with its own reason and what to do.
          answer = () => new Response(JSON.stringify({
            statusCode: 403, name: 'validation_error',
            message: 'The paramountshipping.test domain is not verified. Please, add and verify your domain on https://resend.com/domains',
          }), { status: 403 });
          const refused = await asStaff('POST', '/api/emails/test', {});
          assert.strictEqual(refused.status, 200);
          assert.strictEqual(refused.body.ok, false);
          assert.match(refused.body.message, /domain is not verified/);
          assert.match(refused.body.hint, /Verify that domain/);
          console.log('  ok  the desk test email reports what Resend said, and what to do about it');
        }
      );
    } finally {
      globalThis.fetch = realFetch;
      ['FORM_FROM', 'FORM_TO', 'SITE_URL', 'RESEND_API_KEY'].forEach((k) => delete process.env[k]);
      sb.close();
    }

    // With no key at all the button says so rather than failing silently.
    const bare = await mock.start({});
    const bareUrl = `http://127.0.0.1:${bare.address().port}`;
    bare.createUser('desk@paramount.test', 'pw-desk', { admin: true });
    const bareStaff = (await fetch(`${bareUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: mock.ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'desk@paramount.test', password: 'pw-desk' }),
    }).then((r) => r.json())).access_token;
    await withApp(
      { SUPABASE_URL: bareUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, RESEND_API_KEY: '', FORM_TO: 'ops@paramountshipping.test' },
      async (base) => {
        const res = await fetch(base + '/api/emails/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bareStaff}` },
          body: '{}',
        }).then(async (r) => ({ status: r.status, body: await r.json() }));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ok, false);
        assert.strictEqual(res.body.error, 'no_api_key');
        assert.match(res.body.hint, /RESEND_API_KEY is not set/);
        console.log('  ok  without a Resend key the test email says exactly that');
      }
    );
    delete process.env.FORM_TO;
    bare.close();
  }

  /* ---- tracking numbers ---- */
  {
    const tracking = require(ROOT + '/src/utils/tracking');
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) {
      const n = tracking.generate();
      assert.ok(tracking.isTrackingNumber(n), n);
      seen.add(n);
    }
    assert.strictEqual(seen.size, 500, 'generated numbers must not repeat');

    // The alphabet leaves out the characters people confuse when reading a
    // number down a phone line.
    assert.ok(!/[ILOU]/.test(tracking.ALPHABET));

    assert.strictEqual(tracking.normalise(' pmt-2026-4f7k2qx9 '), 'PMT-2026-4F7K2QX9');
    assert.strictEqual(tracking.normalise('pmt20264f7k2qx9'), 'PMT-2026-4F7K2QX9');
    assert.strictEqual(tracking.findInText('any news on PMT 2026 4F7K2QX9 today?'), 'PMT-2026-4F7K2QX9');
    assert.strictEqual(tracking.findInText('no number here'), '');
    assert.strictEqual(tracking.isTrackingNumber('PMT-2026-ILOU2QX9'), false, 'the excluded letters are not valid');
    console.log('  ok  tracking numbers are unique, unambiguous and forgiving to type');
  }

  console.log('\nserver suite passed');
  process.exit(0);
})().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
