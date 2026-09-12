'use strict';

/**
 * Consignments and their movement history.
 *
 * Supabase in production; a JSON file under DATA_DIR when it is not configured,
 * so the whole tracking flow — create a consignment, move it, look it up — can
 * be driven locally with nothing installed.
 *
 * The two backends are kept behind the same API on purpose: the controllers
 * never learn which one is in play, and the tests exercise both.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const { dataDir } = require('./paths');
const { getSupabase } = require('./supabase');
const tracking = require('./tracking');

const TABLE = 'shipments';
const EVENTS = 'shipment_events';
const CLAIMS = 'shipment_claims';
const FILE = 'shipments.json';
const CLAIMS_FILE = 'claims.json';

/** Everything the desk may set. Anything else in a payload is ignored. */
const FIELDS = [
  'status', 'mode', 'service_level',
  'shipper_name', 'shipper_company', 'shipper_email', 'shipper_phone', 'shipper_address',
  'receiver_name', 'receiver_company', 'receiver_email', 'receiver_phone', 'receiver_address',
  'origin_city', 'origin_country', 'origin_lat', 'origin_lng',
  'destination_city', 'destination_country', 'destination_lat', 'destination_lng',
  'current_location', 'current_lat', 'current_lng',
  'package_type', 'pieces', 'weight_kg', 'volume_cbm', 'dimensions', 'contents',
  'declared_value', 'currency',
  'carrier', 'vessel_or_flight', 'container_no',
  'payment_mode', 'payment_status', 'freight_cost', 'incoterms', 'reference',
  'special_handling', 'instructions', 'internal_notes', 'signed_by',
  'picked_up_at', 'departed_at', 'estimated_delivery', 'delivered_at',
];

/** Columns the public tracking response is allowed to carry. */
const PUBLIC_FIELDS = [
  'tracking_number', 'status', 'mode', 'service_level',
  'shipper_name', 'receiver_name',
  'origin_city', 'origin_country', 'destination_city', 'destination_country',
  'origin_lat', 'origin_lng', 'destination_lat', 'destination_lng',
  'current_location', 'current_lat', 'current_lng',
  'package_type', 'pieces', 'weight_kg', 'volume_cbm', 'dimensions', 'contents',
  'carrier', 'vessel_or_flight', 'reference', 'special_handling', 'instructions',
  'signed_by', 'picked_up_at', 'departed_at', 'estimated_delivery', 'delivered_at',
  'created_at', 'updated_at',
];

/** How many ids to put in one `in.()` filter. Keeps the URL well inside limits. */
const ID_BATCH = 80;

const filePath = () => path.join(dataDir(), FILE);
let writeChain = Promise.resolve();

const nowIso = () => new Date().toISOString();
const asIso = (v) => (v instanceof Date ? v.toISOString() : v || null);

/* ------------------------------------------------------------------ shape --- */

/** Drop unknown keys and undefined values; `null` is a deliberate clear. */
function pickFields(input, allowed = FIELDS) {
  const out = {};
  allowed.forEach((key) => {
    if (input && Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
      out[key] = input[key];
    }
  });
  return out;
}

/* ------------------------------------------------------------------ files --- */

async function readFile() {
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeFile(mutate) {
  const task = writeChain.then(async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    const all = await readFile();
    const result = await mutate(all);
    await fs.writeFile(filePath(), JSON.stringify(all, null, 2), 'utf8');
    return result;
  });
  writeChain = task.catch(() => {});
  return task;
}

/* ------------------------------------------------------------- roll-up --- */

/**
 * What a new event makes true of the shipment itself.
 *
 * The database has a trigger that does this as well, so a row written straight
 * into Postgres still lands correctly; doing it here too keeps the file backend
 * honest and means a caller gets the updated shipment back without a re-read.
 */
function rollUp(shipment, event) {
  const patch = { status: event.status, updated_at: nowIso() };
  if (event.location) patch.current_location = event.location;
  if (event.lat != null) patch.current_lat = event.lat;
  if (event.lng != null) patch.current_lng = event.lng;
  if (event.status === 'picked_up' && !shipment.picked_up_at) patch.picked_up_at = event.occurred_at;
  if (event.status === 'delivered') patch.delivered_at = event.occurred_at;
  return patch;
}

/** True when this event is newer than everything already recorded. */
function isNewest(events, occurredAt) {
  const at = Date.parse(occurredAt) || 0;
  return !events.some((e) => !e.internal && (Date.parse(e.occurred_at) || 0) > at);
}

/* -------------------------------------------------------------- queries --- */

/**
 * A free-text filter over the fields a desk agent would search by. Applied in
 * JavaScript for both backends: PostgREST's `or=` syntax would have to be
 * escaped by hand, and a desk never holds enough consignments for it to matter.
 */
function searchable(row) {
  return [
    row.tracking_number, row.shipper_name, row.shipper_company, row.shipper_email,
    row.receiver_name, row.receiver_company, row.receiver_email,
    row.origin_city, row.destination_city, row.reference, row.container_no,
    row.vessel_or_flight, row.carrier, row.current_location,
  ].filter(Boolean).join(' ').toLowerCase();
}

/* ---------------------------------------------------------------- create --- */

/**
 * Create a consignment, minting its tracking number.
 *
 * A caller may supply one (importing from another system); otherwise one is
 * generated. A collision is a one-in-a-trillion event, but the unique index is
 * the authority on it, so a clash simply draws again rather than trusting a
 * prior read.
 */
async function create(input, { trackingNumber } = {}) {
  const supabase = getSupabase();
  const base = pickFields(input);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const number = attempt === 0 && trackingNumber
      ? tracking.normalise(trackingNumber)
      : tracking.generate();

    const row = {
      ...base,
      tracking_number: number,
      status: base.status || 'pending',
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    if (supabase) {
      try {
        const [created] = await supabase.insertReturning(TABLE, row);
        return created;
      } catch (err) {
        // 23505 is the unique index on the tracking number.
        if (/23505|duplicate key/i.test(err.message) && !trackingNumber) continue;
        throw err;
      }
    }

    const existing = await readFile();
    if (existing.some((s) => s.tracking_number === number)) continue;
    return writeFile(async (all) => {
      const stored = { id: crypto.randomUUID(), ...row, events: [] };
      all.unshift(stored);
      return stored;
    });
  }

  throw new Error('could not allocate a unique tracking number');
}

/* ------------------------------------------------------------------ read --- */

async function list({ status, query, limit = 200 } = {}) {
  const supabase = getSupabase();
  let rows;

  if (supabase) {
    const parts = ['select=*', 'order=created_at.desc', `limit=${Math.min(Number(limit) || 200, 500)}`];
    if (status && tracking.isStatus(status)) parts.push(`status=eq.${status}`);
    rows = await supabase.select(TABLE, parts.join('&'));
  } else {
    rows = (await readFile()).map(({ events, ...rest }) => rest);
    if (status && tracking.isStatus(status)) rows = rows.filter((r) => r.status === status);
    rows = rows
      .slice()
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, Math.min(Number(limit) || 200, 500));
  }

  const needle = String(query || '').trim().toLowerCase();
  if (needle) rows = rows.filter((row) => searchable(row).includes(needle));
  return rows;
}

async function getById(id) {
  if (!id) return null;
  const supabase = getSupabase();
  if (supabase) {
    const rows = await supabase.select(TABLE, `select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] || null;
  }
  const all = await readFile();
  const hit = all.find((s) => s.id === id);
  if (!hit) return null;
  const { events, ...rest } = hit;
  return rest;
}

async function getByTrackingNumber(input) {
  const number = tracking.normalise(input);
  if (!number) return null;
  const supabase = getSupabase();
  if (supabase) {
    const rows = await supabase.select(
      TABLE,
      `select=*&tracking_number=eq.${encodeURIComponent(number)}&limit=1`
    );
    return rows[0] || null;
  }
  const all = await readFile();
  const hit = all.find((s) => String(s.tracking_number).toUpperCase() === number);
  if (!hit) return null;
  const { events, ...rest } = hit;
  return rest;
}

async function listEvents(shipmentId, { includeInternal = false } = {}) {
  const supabase = getSupabase();
  let rows;
  if (supabase) {
    rows = await supabase.select(
      EVENTS,
      `select=*&shipment_id=eq.${encodeURIComponent(shipmentId)}&order=occurred_at.desc&limit=200`
    );
  } else {
    const all = await readFile();
    const hit = all.find((s) => s.id === shipmentId);
    rows = hit && Array.isArray(hit.events) ? hit.events.slice() : [];
    rows.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  }
  return includeInternal ? rows : rows.filter((e) => !e.internal);
}

/* ---------------------------------------------------------------- write --- */

async function update(id, patch) {
  const clean = pickFields(patch);
  if (!Object.keys(clean).length) return getById(id);
  clean.updated_at = nowIso();

  const supabase = getSupabase();
  if (supabase) {
    const rows = await supabase.update(TABLE, `id=eq.${encodeURIComponent(id)}`, clean);
    return rows[0] || getById(id);
  }
  return writeFile(async (all) => {
    const hit = all.find((s) => s.id === id);
    if (!hit) return null;
    Object.assign(hit, clean);
    const { events, ...rest } = hit;
    return rest;
  });
}

/**
 * Record a movement.
 *
 * Returns both the event and the shipment as it now stands, because every
 * caller wants the second: the desk redraws the row, and the notification email
 * quotes the new status.
 */
async function addEvent(shipmentId, input) {
  const event = {
    shipment_id: shipmentId,
    status: tracking.isStatus(input.status) ? input.status : 'in_transit',
    location: input.location || null,
    lat: input.lat == null ? null : Number(input.lat),
    lng: input.lng == null ? null : Number(input.lng),
    note: input.note || null,
    internal: Boolean(input.internal),
    occurred_at: input.occurred_at || nowIso(),
  };

  const supabase = getSupabase();

  if (supabase) {
    const [created] = await supabase.insertReturning(EVENTS, event);
    const existing = await listEvents(shipmentId, { includeInternal: true });
    let shipment = await getById(shipmentId);
    if (!event.internal && isNewest(existing.filter((e) => e.id !== created.id), event.occurred_at)) {
      shipment = await update(shipmentId, rollUp(shipment || {}, event));
    }
    return { event: created, shipment };
  }

  return writeFile(async (all) => {
    const hit = all.find((s) => s.id === shipmentId);
    if (!hit) return { event: null, shipment: null };
    if (!Array.isArray(hit.events)) hit.events = [];
    const created = { id: crypto.randomUUID(), created_at: nowIso(), ...event };
    if (!event.internal && isNewest(hit.events, event.occurred_at)) {
      Object.assign(hit, rollUp(hit, event));
    }
    hit.events.unshift(created);
    const { events, ...rest } = hit;
    return { event: created, shipment: rest };
  });
}

async function remove(id) {
  const supabase = getSupabase();
  if (supabase) {
    // shipment_events cascades on the foreign key.
    await supabase.remove(TABLE, `id=eq.${encodeURIComponent(id)}`);
    return true;
  }
  return writeFile(async (all) => {
    const i = all.findIndex((s) => s.id === id);
    if (i >= 0) all.splice(i, 1);
    return i >= 0;
  });
}

/* --------------------------------------------------------------- claims --- */

const claimsPath = () => path.join(dataDir(), CLAIMS_FILE);

async function readClaims() {
  try {
    const raw = await fs.readFile(claimsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeClaims(mutate) {
  const task = writeChain.then(async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    const all = await readClaims();
    const result = await mutate(all);
    await fs.writeFile(claimsPath(), JSON.stringify(all, null, 2), 'utf8');
    return result;
  });
  writeChain = task.catch(() => {});
  return task;
}

/**
 * Attach a consignment to a customer's account.
 *
 * Claiming twice is not an error: the customer asked for it to be on their
 * account, and it is. The unique index is what makes that true on the database
 * side, and `ignore-duplicates` is what stops it being reported as a failure.
 */
async function claim(userId, shipmentId, label) {
  const row = { user_id: userId, shipment_id: shipmentId, label: label || null };
  const supabase = getSupabase();

  if (supabase) {
    await supabase.upsertOn(CLAIMS, row, 'user_id,shipment_id');
    const rows = await supabase.select(
      CLAIMS,
      `select=*&user_id=eq.${encodeURIComponent(userId)}&shipment_id=eq.${encodeURIComponent(shipmentId)}&limit=1`
    );
    return rows[0] || row;
  }

  return writeClaims(async (all) => {
    const existing = all.find((c) => c.user_id === userId && c.shipment_id === shipmentId);
    if (existing) return existing;
    const created = { id: crypto.randomUUID(), created_at: nowIso(), ...row };
    all.unshift(created);
    return created;
  });
}

/** True when an error is "that table is not in this database". */
const isMissingTable = (err) => /PGRST205|Could not find the table/i.test(String(err && err.message));

async function listClaims(userId) {
  const supabase = getSupabase();
  if (supabase) {
    try {
      return await supabase.select(
        CLAIMS,
        `select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=500`
      );
    } catch (err) {
      // 0005_portal.sql brings the table. Without it a customer still sees the
      // consignments their address matches, rather than an error page; the
      // operator is told which file is missing by /api/health?probe=1.
      if (!isMissingTable(err)) throw err;
      console.warn('[paramount] shipment_claims is missing; run supabase/migrations/0005_portal.sql');
      return [];
    }
  }
  return (await readClaims()).filter((c) => c.user_id === userId);
}

/** Remove a consignment from an account. The consignment itself is untouched. */
async function removeClaim(userId, shipmentId) {
  const supabase = getSupabase();
  if (supabase) {
    await supabase.remove(
      CLAIMS,
      `user_id=eq.${encodeURIComponent(userId)}&shipment_id=eq.${encodeURIComponent(shipmentId)}`
    );
    return true;
  }
  return writeClaims(async (all) => {
    const i = all.findIndex((c) => c.user_id === userId && c.shipment_id === shipmentId);
    if (i >= 0) all.splice(i, 1);
    return i >= 0;
  });
}

/**
 * Everything one customer may see.
 *
 * Two sources, deliberately separate: consignments they claimed with a tracking
 * number, and — only when the caller has proved the address is theirs —
 * consignments booked to or from it. Each row says which link brought it in, so
 * the portal can show the difference and only offer to remove the claims.
 *
 * @param {{userId: string, email?: string, matchEmail?: boolean}} who
 */
async function listForCustomer({ userId, email, matchEmail = false }) {
  const supabase = getSupabase();
  const address = String(email || '').trim().toLowerCase();

  const claims = await listClaims(userId);
  const claimed = new Map();

  if (claims.length) {
    if (supabase) {
      // Fetched in batches rather than one request per claim, and rather than
      // one request for all of them: an `in.()` list of a few hundred uuids
      // makes a URL long enough for a proxy to reject outright.
      const ids = claims.map((c) => c.shipment_id);
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const batch = ids.slice(i, i + ID_BATCH);
        const rows = await supabase.select(
          TABLE,
          `select=*&id=in.(${batch.map((id) => encodeURIComponent(id)).join(',')})`
        );
        rows.forEach((row) => claimed.set(row.id, row));
      }
    } else {
      const all = await readFile();
      claims.forEach((c) => {
        const hit = all.find((sh) => sh.id === c.shipment_id);
        if (hit) {
          const { events, ...rest } = hit;
          claimed.set(hit.id, rest);
        }
      });
    }
  }

  const matched = new Map();
  if (matchEmail && address) {
    if (supabase) {
      const encoded = encodeURIComponent(address);
      const [toThem, fromThem] = await Promise.all([
        supabase.select(TABLE, `select=*&receiver_email=eq.${encoded}&order=created_at.desc&limit=200`),
        supabase.select(TABLE, `select=*&shipper_email=eq.${encoded}&order=created_at.desc&limit=200`),
      ]);
      [...toThem, ...fromThem].forEach((row) => matched.set(row.id, row));
    } else {
      (await readFile()).forEach((sh) => {
        const hit = [sh.receiver_email, sh.shipper_email]
          .map((v) => String(v || '').trim().toLowerCase())
          .includes(address);
        if (hit) {
          const { events, ...rest } = sh;
          matched.set(sh.id, rest);
        }
      });
    }
  }

  // A consignment reached both ways is one consignment, and it is claimed:
  // that is the link the customer can act on.
  const rows = [];
  matched.forEach((row, id) => {
    if (!claimed.has(id)) rows.push({ row, via: 'email' });
  });
  claimed.forEach((row) => rows.push({ row, via: 'claim' }));

  return rows.sort((a, b) => String(b.row.created_at).localeCompare(String(a.row.created_at)));
}

/** True when this consignment is one the customer is allowed to open. */
async function customerCanSee({ userId, email, matchEmail = false }, shipment) {
  if (!shipment) return false;
  const address = String(email || '').trim().toLowerCase();

  if (matchEmail && address) {
    const onIt = [shipment.receiver_email, shipment.shipper_email]
      .map((v) => String(v || '').trim().toLowerCase())
      .includes(address);
    if (onIt) return true;
  }

  const claims = await listClaims(userId);
  return claims.some((c) => c.shipment_id === shipment.id);
}

/* ---------------------------------------------------------------- views --- */

/**
 * What a stranger holding the tracking number is shown.
 *
 * Everything commercial or internal — costs, payment status, the shipper's
 * contact details, desk notes — is left out here rather than at the edge, so a
 * new field is private until it is deliberately added to PUBLIC_FIELDS.
 */
function toPublic(shipment, events = []) {
  if (!shipment) return null;
  const out = {};
  PUBLIC_FIELDS.forEach((key) => {
    if (shipment[key] !== undefined) out[key] = asIso(shipment[key]);
  });

  const meta = tracking.statusMeta(shipment.status);
  out.status_label = meta.label;
  out.status_blurb = meta.blurb;
  out.status_tone = meta.tone;
  out.progress = meta.progress;
  out.mode_label = tracking.modeLabel(shipment.mode);
  out.is_delivered = shipment.status === 'delivered';

  out.events = (events || [])
    .filter((e) => !e.internal)
    .map((e) => {
      const m = tracking.statusMeta(e.status);
      return {
        occurred_at: asIso(e.occurred_at),
        status: e.status,
        status_label: m.label,
        status_tone: m.tone,
        location: e.location || null,
        lat: e.lat == null ? null : Number(e.lat),
        lng: e.lng == null ? null : Number(e.lng),
        note: e.note || null,
      };
    })
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));

  return out;
}

module.exports = {
  FIELDS,
  PUBLIC_FIELDS,
  TABLE,
  EVENTS,
  CLAIMS,
  pickFields,
  create,
  list,
  getById,
  getByTrackingNumber,
  listEvents,
  update,
  addEvent,
  remove,
  toPublic,
  claim,
  isMissingTable,
  listClaims,
  removeClaim,
  listForCustomer,
  customerCanSee,
};
