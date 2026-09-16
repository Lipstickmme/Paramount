'use strict';

/**
 * The desk's side of tracking: create a consignment, correct its details,
 * record where it has got to.
 *
 * Every route here is staff-only. The dashboard reads most tables straight from
 * PostgREST under the signed-in user, where row level security decides what it
 * may see — but writing a shipment cannot work that way, because minting the
 * tracking number and emailing the customer both need something the browser
 * must not hold. So the whole shipment lifecycle goes through the server, and
 * requireAdmin re-establishes here what the policies enforce there.
 */

const shipments = require('../utils/shipmentStore');
const tracking = require('../utils/tracking');
const notify = require('../utils/notify');
const { requireAdmin } = require('../utils/adminAuth');

const MAX_TEXT = 2000;

/** Trim, cap, and treat an empty string as "not supplied". */
function text(value, max = 240) {
  if (value == null) return undefined;
  const out = String(value).trim().slice(0, max);
  return out || null;
}

/**
 * An email address, folded to lower case.
 *
 * The portal finds a customer's consignments by matching this against the
 * address on their account, and that comparison happens in the database, which
 * does not fold case for us. Normalising on the way in is what makes
 * `ADA@example.com` on the booking and `ada@example.com` on the account the
 * same person.
 */
function email(value, max = 200) {
  const out = text(value, max);
  return out ? out.toLowerCase() : out;
}

function number(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function integer(value) {
  const n = number(value);
  return n === undefined ? undefined : Math.max(0, Math.round(n));
}

/** An ISO timestamp, or undefined if the input is not a date at all. */
function timestamp(value) {
  if (value == null || value === '') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function coordinate(value, limit) {
  const n = number(value);
  if (n === undefined) return undefined;
  return Math.abs(n) <= limit ? n : undefined;
}

/**
 * A request body as columns.
 *
 * Anything the client sends that is not listed is dropped rather than passed
 * through, so a stray field cannot reach the database, and `undefined` means
 * "leave as it was" while `null` means "clear it".
 */
function toColumns(body = {}) {
  const out = {
    mode: tracking.isMode(body.mode) ? body.mode : undefined,
    status: tracking.isStatus(body.status) ? body.status : undefined,
    service_level: text(body.service_level, 60),

    shipper_name: text(body.shipper_name, 160),
    shipper_company: text(body.shipper_company, 160),
    shipper_email: email(body.shipper_email),
    shipper_phone: text(body.shipper_phone, 60),
    shipper_address: text(body.shipper_address, 400),

    receiver_name: text(body.receiver_name, 160),
    receiver_company: text(body.receiver_company, 160),
    receiver_email: email(body.receiver_email),
    receiver_phone: text(body.receiver_phone, 60),
    receiver_address: text(body.receiver_address, 400),

    origin_city: text(body.origin_city, 120),
    origin_country: text(body.origin_country, 120),
    origin_lat: coordinate(body.origin_lat, 90),
    origin_lng: coordinate(body.origin_lng, 180),

    destination_city: text(body.destination_city, 120),
    destination_country: text(body.destination_country, 120),
    destination_lat: coordinate(body.destination_lat, 90),
    destination_lng: coordinate(body.destination_lng, 180),

    current_location: text(body.current_location, 200),
    current_lat: coordinate(body.current_lat, 90),
    current_lng: coordinate(body.current_lng, 180),

    package_type: text(body.package_type, 60),
    pieces: integer(body.pieces),
    weight_kg: number(body.weight_kg),
    volume_cbm: number(body.volume_cbm),
    dimensions: text(body.dimensions, 120),
    contents: text(body.contents, MAX_TEXT),
    declared_value: number(body.declared_value),
    currency: text(body.currency, 8),

    carrier: text(body.carrier, 120),
    vessel_or_flight: text(body.vessel_or_flight, 120),
    container_no: text(body.container_no, 60),
    payment_mode: text(body.payment_mode, 40),
    payment_status: text(body.payment_status, 40),
    freight_cost: number(body.freight_cost),
    incoterms: text(body.incoterms, 20),
    reference: text(body.reference, 120),
    special_handling: text(body.special_handling, 240),
    instructions: text(body.instructions, MAX_TEXT),
    internal_notes: text(body.internal_notes, MAX_TEXT),
    signed_by: text(body.signed_by, 160),

    picked_up_at: timestamp(body.picked_up_at),
    departed_at: timestamp(body.departed_at),
    estimated_delivery: timestamp(body.estimated_delivery),
    delivered_at: timestamp(body.delivered_at),
  };

  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

/** Staff gate. Answers the request itself when the caller is not staff. */
async function gate(req, res) {
  const auth = await requireAdmin(req);
  if (auth.ok) return auth;
  const messages = {
    missing_token: 'Sign in to the desk first.',
    invalid_token: 'That session is not valid. Sign in again.',
    not_an_admin: 'That account is not on the desk.',
    supabase_not_configured: 'The database is not connected, so shipments cannot be stored.',
    auth_unreachable: 'Could not reach the authentication service. Try again.',
  };
  res.status(auth.status).json({ error: auth.reason, message: messages[auth.reason] || 'Not permitted.' });
  return auth;
}

/* ------------------------------------------------------------------ list --- */

/** GET /api/shipments */
exports.list = async (req, res, next) => {
  try {
    const auth = await gate(req, res);
    if (!auth.ok) return undefined;

    const rows = await shipments.list({
      status: req.query.status,
      query: req.query.q || req.query.query,
      limit: req.query.limit,
    });
    return res.json({ ok: true, count: rows.length, shipments: rows });
  } catch (err) {
    return next(err);
  }
};

/** GET /api/shipments/:id — the full row plus its whole event history. */
exports.get = async (req, res, next) => {
  try {
    const auth = await gate(req, res);
    if (!auth.ok) return undefined;

    const shipment = await shipments.getById(req.params.id);
    if (!shipment) return res.status(404).json({ error: 'not_found', message: 'No such consignment.' });

    const events = await shipments.listEvents(shipment.id, { includeInternal: true });
    return res.json({ ok: true, shipment, events });
  } catch (err) {
    return next(err);
  }
};

/* ---------------------------------------------------------------- create --- */

/**
 * POST /api/shipments
 *
 * Mints the tracking number and opens the timeline with a first event, so a
 * consignment is never shown to a customer as an empty history. The customer is
 * emailed their number when the desk has an address for them and the setting is
 * on; a failed send is reported back but does not undo the booking.
 */
exports.create = async (req, res, next) => {
  try {
    const auth = await gate(req, res);
    if (!auth.ok) return undefined;

    const columns = toColumns(req.body);
    const required = ['shipper_name', 'receiver_name', 'origin_city', 'destination_city'];
    const missing = required.filter((key) => !columns[key]);
    if (missing.length) {
      return res.status(422).json({
        error: 'missing_fields',
        message: `Still needed: ${missing.join(', ').replace(/_/g, ' ')}.`,
        fields: missing,
      });
    }

    // A supplied number is honoured (importing from another system) but must
    // still be a Paramount number, or tracking links for it will not resolve.
    const supplied = req.body.tracking_number ? tracking.normalise(req.body.tracking_number) : '';
    if (supplied && !tracking.isTrackingNumber(supplied)) {
      return res.status(422).json({
        error: 'malformed_tracking_number',
        message: `A supplied number must look like ${tracking.PREFIX}-${new Date().getFullYear()}-4F7K2QX9. Leave it blank and one will be generated.`,
      });
    }
    if (supplied && (await shipments.getByTrackingNumber(supplied))) {
      return res.status(409).json({
        error: 'tracking_number_taken',
        message: 'A consignment already carries that tracking number.',
      });
    }

    const created = await shipments.create(columns, { trackingNumber: supplied || undefined });

    // Open the history. Without this the first thing a customer sees after
    // booking is a status with no event behind it.
    const { shipment } = await shipments.addEvent(created.id, {
      status: created.status || 'pending',
      location: columns.current_location || [columns.origin_city, columns.origin_country].filter(Boolean).join(', '),
      lat: columns.origin_lat,
      lng: columns.origin_lng,
      note: req.body.event_note || 'Booking registered with Paramount Shipping.',
      occurred_at: created.created_at,
    });

    const mail = await notify.shipmentCreated(shipment || created);
    return res.status(201).json({ ok: true, shipment: shipment || created, notified: mail });
  } catch (err) {
    return next(err);
  }
};

/* ---------------------------------------------------------------- update --- */

/** PATCH /api/shipments/:id — corrections. Movement goes through /events. */
exports.update = async (req, res, next) => {
  try {
    const auth = await gate(req, res);
    if (!auth.ok) return undefined;

    const existing = await shipments.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found', message: 'No such consignment.' });

    const columns = toColumns(req.body);
    delete columns.status; // a status change is a movement; it needs an event.

    const shipment = await shipments.update(existing.id, columns);
    return res.json({ ok: true, shipment });
  } catch (err) {
    return next(err);
  }
};

/** DELETE /api/shipments/:id */
exports.remove = async (req, res, next) => {
  try {
    const auth = await gate(req, res);
    if (!auth.ok) return undefined;

    const existing = await shipments.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found', message: 'No such consignment.' });

    await shipments.remove(existing.id);
    return res.json({ ok: true, deleted: existing.tracking_number });
  } catch (err) {
    return next(err);
  }
};

/* ---------------------------------------------------------------- events --- */

/** GET /api/shipments/:id/events */
exports.events = async (req, res, next) => {
  try {
    const auth = await gate(req, res);
    if (!auth.ok) return undefined;

    const shipment = await shipments.getById(req.params.id);
    if (!shipment) return res.status(404).json({ error: 'not_found', message: 'No such consignment.' });

    const rows = await shipments.listEvents(shipment.id, { includeInternal: true });
    return res.json({ ok: true, events: rows });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/shipments/:id/events
 *
 * How a consignment moves. The event is the record; the shipment's own status
 * and position are rolled up from it, so the customer's timeline and the desk's
 * list can never disagree.
 */
exports.addEvent = async (req, res, next) => {
  try {
    const auth = await gate(req, res);
    if (!auth.ok) return undefined;

    const shipment = await shipments.getById(req.params.id);
    if (!shipment) return res.status(404).json({ error: 'not_found', message: 'No such consignment.' });

    const status = req.body.status;
    if (!tracking.isStatus(status)) {
      return res.status(422).json({
        error: 'invalid_status',
        message: `Unknown status. One of: ${tracking.STATUSES.map((s) => s.id).join(', ')}.`,
      });
    }

    const result = await shipments.addEvent(shipment.id, {
      status,
      location: text(req.body.location, 200),
      lat: coordinate(req.body.lat, 90),
      lng: coordinate(req.body.lng, 180),
      note: text(req.body.note, MAX_TEXT),
      internal: Boolean(req.body.internal),
      occurred_at: timestamp(req.body.occurred_at),
    });

    // An internal note is for the desk; the customer is not told about it.
    const mail = result.event && !result.event.internal
      ? await notify.shipmentUpdated(result.shipment, result.event)
      : { ok: false, error: 'internal_event' };

    return res.status(201).json({ ok: true, event: result.event, shipment: result.shipment, notified: mail });
  } catch (err) {
    return next(err);
  }
};

module.exports.toColumns = toColumns;
