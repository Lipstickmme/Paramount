'use strict';

/**
 * A deliberately strict stand-in for Supabase: PostgREST + GoTrue + the row
 * level security rules and triggers from supabase/migrations/.
 *
 * Strict is the point. It rejects a column that is not in the table, exactly
 * as Postgres does, so code that writes `role`/`text` against a schema that
 * says `sender`/`body` fails here instead of in production.
 */

const http = require('http');
const crypto = require('crypto');

const ANON_KEY = 'anon-key';
const SERVICE_KEY = 'service-key';

const uuid = () => crypto.randomUUID();

function schema() {
  return {
    admins: { columns: ['user_id', 'email', 'created_at'], rows: [] },
    enquiries: {
      columns: ['id', 'created_at', 'name', 'email', 'company', 'service', 'message', 'ip', 'status', 'notes'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), status: 'new' }),
      notNull: ['name', 'email', 'message'],
      rows: [],
    },
    site_settings: {
      columns: [
        'id', 'updated_at', 'address', 'email', 'phone', 'hours',
        'company_name', 'tagline', 'support_phone', 'whatsapp', 'emergency_phone',
        'notify_email', 'from_email', 'reply_to', 'email_signature',
        'auto_reply', 'notify_on_shipment_update', 'notify_on_shipment_created',
        'chat_enabled', 'chat_greeting', 'chat_notify', 'chat_agent_name', 'chat_away_message',
      ],
      defaults: () => ({ id: 'default', updated_at: new Date().toISOString() }),
      rows: [{
        id: 'default', updated_at: new Date().toISOString(),
        address: null, email: null, phone: null, hours: null,
        auto_reply: true, notify_on_shipment_update: true, notify_on_shipment_created: true,
        chat_enabled: true, chat_notify: true,
      }],
    },
    applications: {
      columns: ['id', 'created_at', 'name', 'email', 'phone', 'role_id', 'role_title', 'portfolio', 'experience', 'message', 'ip', 'status', 'notes'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), status: 'new' }),
      notNull: ['name', 'email', 'message'],
      rows: [],
    },
    chat_sessions: {
      columns: ['id', 'created_at', 'visitor_id', 'visitor_name', 'visitor_email', 'last_message_at', 'status', 'handled_by_agent'],
      defaults: () => ({
        id: uuid(),
        created_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        status: 'new',
        handled_by_agent: false,
      }),
      notNull: ['visitor_id'],
      rows: [],
    },
    chat_messages: {
      columns: ['id', 'created_at', 'session_id', 'sender', 'body'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString() }),
      notNull: ['session_id', 'sender', 'body'],
      check: (row) => {
        if (!['visitor', 'agent'].includes(row.sender)) {
          return 'new row for relation "chat_messages" violates check constraint "chat_messages_sender_check"';
        }
        if (!row.body || String(row.body).length > 4000) {
          return 'new row for relation "chat_messages" violates check constraint "chat_messages_body_check"';
        }
        return null;
      },
      rows: [],
    },
    shipments: {
      columns: [
        'id', 'created_at', 'updated_at', 'tracking_number', 'status', 'mode', 'service_level',
        'shipper_name', 'shipper_company', 'shipper_email', 'shipper_phone', 'shipper_address',
        'receiver_name', 'receiver_company', 'receiver_email', 'receiver_phone', 'receiver_address',
        'origin_city', 'origin_country', 'origin_lat', 'origin_lng',
        'destination_city', 'destination_country', 'destination_lat', 'destination_lng',
        'current_location', 'current_lat', 'current_lng',
        'package_type', 'pieces', 'weight_kg', 'volume_cbm', 'dimensions', 'contents',
        'declared_value', 'currency', 'carrier', 'vessel_or_flight', 'container_no',
        'payment_mode', 'payment_status', 'freight_cost', 'incoterms', 'reference',
        'special_handling', 'instructions', 'internal_notes', 'signed_by',
        'picked_up_at', 'departed_at', 'estimated_delivery', 'delivered_at', 'created_by',
      ],
      defaults: () => ({
        id: uuid(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'pending',
        mode: 'road_haulage',
        pieces: 1,
        currency: 'USD',
      }),
      notNull: ['tracking_number', 'shipper_name', 'receiver_name', 'origin_city', 'destination_city'],
      // The unique index in 0003_shipments.sql is on upper(tracking_number).
      unique: (row, rows) =>
        rows.some((r) => r !== row && String(r.tracking_number).toUpperCase() === String(row.tracking_number).toUpperCase())
          ? 'duplicate key value violates unique constraint "shipments_tracking_number_key"'
          : null,
      rows: [],
    },
    shipment_events: {
      columns: ['id', 'created_at', 'shipment_id', 'occurred_at', 'status', 'location', 'lat', 'lng', 'note', 'internal', 'created_by'],
      defaults: () => ({
        id: uuid(),
        created_at: new Date().toISOString(),
        occurred_at: new Date().toISOString(),
        internal: false,
      }),
      notNull: ['shipment_id', 'status'],
      rows: [],
    },
    quote_requests: {
      columns: ['id', 'created_at', 'name', 'email', 'phone', 'company', 'mode', 'origin', 'destination',
        'cargo_type', 'weight_kg', 'dimensions', 'pieces', 'ready_date', 'incoterms', 'message', 'ip', 'status', 'notes'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), status: 'new' }),
      notNull: ['name', 'email'],
      rows: [],
    },
    email_threads: {
      columns: ['id', 'created_at', 'last_message_at', 'subject', 'participant_email', 'participant_name', 'status'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), last_message_at: new Date().toISOString(), status: 'new' }),
      notNull: ['participant_email'],
      rows: [],
    },
    email_messages: {
      columns: ['id', 'created_at', 'thread_id', 'direction', 'from_email', 'from_name', 'to_email', 'subject', 'body_text', 'body_html', 'message_id', 'in_reply_to', 'has_attachments'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), has_attachments: false }),
      notNull: ['thread_id', 'direction', 'from_email', 'to_email'],
      rows: [],
    },
  };
}

function start({ tables, port = 0, drop = [] }) {
  const db = tables || schema();
  // `drop` simulates a database built from an older migration.
  drop.forEach((spec) => {
    const [table, column] = spec.split('.');
    if (db[table]) db[table].columns = db[table].columns.filter((c) => c !== column);
  });

  const sessions = new Map(); // access_token -> user
  const users = new Map(); // email -> { id, email, password }

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const fail = (res, status, code, message) => json(res, status, { code, message });

  function identify(req) {
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (auth === SERVICE_KEY) return { role: 'service_role' };
    if (sessions.has(auth)) return { role: 'authenticated', user: sessions.get(auth) };
    return { role: 'anon' };
  }

  const isAdmin = (who) =>
    Boolean(who.user && db.admins.rows.some((r) => r.user_id === who.user.id));

  /** The policies from 0001_init.sql, as predicates. */
  function canRead(table, row, who) {
    if (who.role === 'service_role') return true;
    if (who.role !== 'authenticated') return false;
    if (isAdmin(who)) return true;
    if (table === 'admins') return row.user_id === who.user.id;
    if (table === 'chat_sessions') return row.visitor_id === who.user.id;
    if (table === 'chat_messages') {
      const session = db.chat_sessions.rows.find((s) => s.id === row.session_id);
      return Boolean(session && session.visitor_id === who.user.id);
    }
    // shipments, shipment_events and quote_requests are staff-only: a visitor
    // reaches a consignment through /api/track, never through PostgREST.
    return false;
  }

  function canWrite(table, row, who) {
    if (who.role === 'service_role') return true;
    if (who.role !== 'authenticated') return false;
    if (table === 'chat_sessions') return row.visitor_id === who.user.id || isAdmin(who);
    if (table === 'chat_messages') {
      if (row.sender === 'agent') return isAdmin(who);
      const session = db.chat_sessions.rows.find((s) => s.id === row.session_id);
      return Boolean(session && session.visitor_id === who.user.id);
    }
    return isAdmin(who);
  }

  function matches(row, filters) {
    return filters.every(([column, op, value]) => {
      if (op !== 'eq') return true;
      return String(row[column]) === value;
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : {};

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      });
      return res.end();
    }

    /* ------------------------------------------------------------ GoTrue -- */

    if (url.pathname === '/auth/v1/signup') {
      if (!body.email) {
        if (!server.anonymousEnabled) {
          return fail(res, 422, 'anonymous_provider_disabled', 'Anonymous sign-ins are disabled');
        }
        const user = { id: uuid(), email: null, is_anonymous: true };
        const token = uuid();
        sessions.set(token, user);
        return json(res, 200, { access_token: token, refresh_token: uuid(), expires_in: 3600, user });
      }
      const user = { id: uuid(), email: body.email, is_anonymous: false };
      users.set(body.email, { ...user, password: body.password });
      return json(res, 200, { user });
    }

    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const found = users.get(body.email);
        if (!found || found.password !== body.password) {
          return fail(res, 400, 'invalid_credentials', 'Invalid login credentials');
        }
        const user = { id: found.id, email: found.email, is_anonymous: false };
        const token = uuid();
        sessions.set(token, user);
        return json(res, 200, { access_token: token, refresh_token: uuid(), expires_in: 3600, user });
      }
      return fail(res, 400, 'invalid_grant', 'Unsupported grant');
    }

    if (url.pathname === '/auth/v1/logout') {
      const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      sessions.delete(auth);
      return json(res, 204);
    }

    // Resolves a bearer token to its user. Server routes that cannot rely on
    // row level security check a caller's session here.
    if (url.pathname === '/auth/v1/user') {
      const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = sessions.get(auth);
      if (!user) return fail(res, 401, 'invalid_token', 'Invalid or expired token');
      return json(res, 200, user);
    }

    /* ---------------------------------------------------------- PostgREST -- */

    const restMatch = /^\/rest\/v1\/([A-Za-z0-9_]+)$/.exec(url.pathname);
    if (!restMatch) return fail(res, 404, 'PGRST404', `No route for ${url.pathname}`);

    const name = restMatch[1];
    const table = db[name];
    if (!table) {
      return fail(res, 404, 'PGRST205', `Could not find the table 'public.${name}' in the schema cache`);
    }

    const who = identify(req);
    const known = (column) => table.columns.includes(column);

    const filters = [];
    let select = null;
    let order = null;
    let limit = null;
    url.searchParams.forEach((value, key) => {
      if (key === 'select') select = value.split(',').map((s) => s.trim());
      else if (key === 'order') order = value;
      else if (key === 'limit') limit = Number(value);
      else if (key === 'on_conflict') void 0;
      else {
        const [op, ...rest] = value.split('.');
        filters.push([key, op, rest.join('.')]);
      }
    });

    const unknownSelect = (select || []).filter((c) => c !== '*' && !known(c));
    const unknownFilter = filters.map(([c]) => c).filter((c) => !known(c));
    const missing = unknownSelect.concat(unknownFilter)[0];
    if (missing) {
      return fail(res, 400, '42703', `column ${name}.${missing} does not exist`);
    }

    /**
     * PostgREST returns every column a select asks for, null included, rather
     * than only the keys a row happens to carry. Code that asks "does this
     * database have that column?" by looking at the keys it got back depends
     * on that, so the projection fills the declared columns in.
     */
    const project = (row) => {
      const full = {};
      table.columns.forEach((column) => {
        full[column] = row[column] === undefined ? null : row[column];
      });
      if (!select || select.includes('*')) return full;
      const out = {};
      select.forEach((c) => {
        out[c] = full[c];
      });
      return out;
    };

    if (req.method === 'GET') {
      let rows = table.rows.filter((row) => matches(row, filters) && canRead(name, row, who));
      if (order) {
        const [column, direction] = order.split('.');
        rows = rows.slice().sort((a, b) => {
          const cmp = String(a[column]).localeCompare(String(b[column]));
          return direction === 'desc' ? -cmp : cmp;
        });
      }
      if (limit) rows = rows.slice(0, limit);
      return json(res, 200, rows.map(project));
    }

    const prefer = String(req.headers.prefer || '');

    if (req.method === 'POST') {
      const incoming = Array.isArray(body) ? body : [body];
      const created = [];
      for (const input of incoming) {
        const unknown = Object.keys(input).filter((c) => !known(c));
        if (unknown.length) {
          return fail(res, 400, 'PGRST204', `Could not find the '${unknown[0]}' column of '${name}' in the schema cache`);
        }

        const row = { ...(table.defaults ? table.defaults() : {}) };
        Object.entries(input).forEach(([k, v]) => {
          if (v !== undefined) row[k] = v;
        });

        const nullish = (table.notNull || []).find((c) => row[c] === undefined || row[c] === null);
        if (nullish) {
          return fail(res, 400, '23502', `null value in column "${nullish}" of relation "${name}" violates not-null constraint`);
        }

        const violated = table.check && table.check(row);
        if (violated) return fail(res, 400, '23514', violated);

        if (name === 'chat_messages' && !db.chat_sessions.rows.some((s) => s.id === row.session_id)) {
          return fail(res, 409, '23503', `insert or update on table "chat_messages" violates foreign key constraint "chat_messages_session_id_fkey"`);
        }

        if (!canWrite(name, row, who)) {
          return fail(res, 403, '42501', `new row violates row-level security policy for table "${name}"`);
        }

        const clash = table.rows.find((r) => r.id && row.id && r.id === row.id);
        if (clash) {
          if (/ignore-duplicates/.test(prefer)) continue;
          return fail(res, 409, '23505', `duplicate key value violates unique constraint "${name}_pkey"`);
        }

        const collision = table.unique && table.unique(row, table.rows);
        if (collision) return fail(res, 409, '23505', collision);

        table.rows.push(row);
        created.push(row);

        // The roll-up trigger from 0003_shipments.sql: the newest public event
        // becomes the shipment's own status and position.
        if (name === 'shipment_events' && !row.internal) {
          const shipment = db.shipments.rows.find((s) => s.id === row.shipment_id);
          const newer = db.shipment_events.rows.some(
            (e) => e !== row && e.shipment_id === row.shipment_id && !e.internal
              && String(e.occurred_at) > String(row.occurred_at)
          );
          if (shipment && !newer) {
            shipment.status = row.status;
            if (row.location) shipment.current_location = row.location;
            if (row.lat != null) shipment.current_lat = row.lat;
            if (row.lng != null) shipment.current_lng = row.lng;
            if (row.status === 'delivered') shipment.delivered_at = row.occurred_at;
            if (row.status === 'picked_up' && !shipment.picked_up_at) shipment.picked_up_at = row.occurred_at;
            shipment.updated_at = new Date().toISOString();
          }
        }

        // The touch trigger from the migration.
        if (name === 'chat_messages') {
          const session = db.chat_sessions.rows.find((s) => s.id === row.session_id);
          if (session) {
            session.last_message_at = row.created_at;
            if (row.sender === 'visitor') session.status = 'new';
          }
        }
      }
      if (/return=representation/.test(prefer)) return json(res, 201, created.map(project));
      return json(res, 201);
    }

    if (req.method === 'PATCH') {
      const unknown = Object.keys(body).filter((c) => !known(c));
      if (unknown.length) {
        return fail(res, 400, 'PGRST204', `Could not find the '${unknown[0]}' column of '${name}' in the schema cache`);
      }
      const rows = table.rows.filter((row) => matches(row, filters) && canRead(name, row, who));
      for (const row of rows) {
        if (!canWrite(name, { ...row, ...body }, who)) {
          return fail(res, 403, '42501', `row violates row-level security policy for table "${name}"`);
        }
        Object.assign(row, body);
      }
      if (/return=representation/.test(prefer)) return json(res, 200, rows.map(project));
      return json(res, 204);
    }

    if (req.method === 'DELETE') {
      const doomed = table.rows.filter((row) => matches(row, filters) && canRead(name, row, who));
      for (const row of doomed) {
        if (!canWrite(name, row, who)) {
          return fail(res, 403, '42501', `row violates row-level security policy for table "${name}"`);
        }
      }
      db[name].rows = table.rows.filter((row) => !doomed.includes(row));
      table.rows = db[name].rows;
      // The foreign key from 0003_shipments.sql cascades.
      if (name === 'shipments') {
        const gone = new Set(doomed.map((r) => r.id));
        db.shipment_events.rows = db.shipment_events.rows.filter((e) => !gone.has(e.shipment_id));
      }
      if (/return=representation/.test(prefer)) return json(res, 200, doomed.map(project));
      return json(res, 204);
    }

    return fail(res, 405, 'PGRST405', 'Method not allowed');
  });

  server.anonymousEnabled = true;
  server.db = db;
  server.users = users;
  server.createUser = (email, password, { admin } = {}) => {
    const user = { id: uuid(), email, is_anonymous: false };
    users.set(email, { ...user, password });
    if (admin) db.admins.rows.push({ user_id: user.id, email, created_at: new Date().toISOString() });
    return user;
  };

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { start, schema, ANON_KEY, SERVICE_KEY };
