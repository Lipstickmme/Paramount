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
        MAILBOX_ADDRESS: 'Paramount Logistics <ops@paramount.test>',
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
        sb.db.site_settings.rows[0].phone = '+31 (0)20 111 2222';
        // Settings are cached for a few seconds, since every page load reads
        // them; `?fresh=1` is the read that skips it.
        const cached = await req(base, 'GET', '/api/site');
        assert.strictEqual(cached.body.email, defaults.email, 'the cached read is still the old value');
        const after = await req(base, 'GET', '/api/site?fresh=1');
        assert.strictEqual(after.body.email, 'desk@example.com');
        assert.strictEqual(after.body.phone, '+31 (0)20 111 2222');
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
        MAILBOX_ADDRESS: 'Paramount Logistics <ops@paramount.test>',
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

        const tampered = body.replace('Ada Kolen', 'Mallory Vane');
        const bad = await post(tampered, 'msg_2', ts, sign(SECRET, 'msg_2', ts, body));
        assert.strictEqual(bad.status, 401);
        // Named so a provider's delivery log says which of the failures it was.
        assert.strictEqual((await bad.json()).reason, 'signature_mismatch');
        assert.strictEqual(sb.db.email_messages.rows.length, 1, 'nothing filed from an unverified post');
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
        assert.strictEqual(sentMail[0].from, 'Paramount Logistics <ops@paramount.test>');
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
