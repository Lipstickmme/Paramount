'use strict';

/**
 * Rate requests from /quote.
 *
 * Same contract as the contact form: validated, rate limited, written down, and
 * raised with the desk by email or webhook — with persistence and notification
 * both best effort, so neither can lose the other.
 */

const crypto = require('crypto');
const storage = require('../utils/storage');
const notify = require('../utils/notify');
const tracking = require('../utils/tracking');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str, max) {
  return String(str == null ? '' : str).trim().slice(0, max);
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A date the customer can actually ship on: a real date, not in the past. */
function readyDate(value) {
  const raw = clean(value, 40);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

exports.create = async (req, res, next) => {
  try {
    const name = clean(req.body.name, 120);
    const email = clean(req.body.email, 200);
    const phone = clean(req.body.phone, 60);
    const company = clean(req.body.company, 160);
    const mode = tracking.isMode(req.body.mode) ? req.body.mode : '';
    const origin = clean(req.body.origin, 160);
    const destination = clean(req.body.destination, 160);
    const cargoType = clean(req.body.cargoType || req.body.cargo_type, 160);
    const dimensions = clean(req.body.dimensions, 160);
    const incoterms = clean(req.body.incoterms, 20);
    const message = clean(req.body.message, 4000);

    const errors = {};
    if (name.length < 2) errors.name = 'Please enter your name.';
    if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.';
    if (origin.length < 2) errors.origin = 'Where does the cargo start?';
    if (destination.length < 2) errors.destination = 'Where is it going?';
    if (!mode) errors.mode = 'Choose a service.';

    if (Object.keys(errors).length) {
      return res.status(422).json({ error: 'validation_error', fields: errors });
    }

    // Honeypot: bots fill hidden fields. Silently accept, but drop.
    const trap = clean(req.body.website, 200);

    const record = {
      id: crypto.randomUUID(),
      name,
      email,
      phone: phone || null,
      company: company || null,
      mode,
      origin,
      destination,
      cargoType: cargoType || null,
      weightKg: positive(req.body.weightKg || req.body.weight_kg),
      pieces: positive(req.body.pieces) ? Math.round(positive(req.body.pieces)) : null,
      dimensions: dimensions || null,
      readyDate: readyDate(req.body.readyDate || req.body.ready_date),
      incoterms: incoterms || null,
      message: message || null,
      receivedAt: new Date().toISOString(),
      ip: req.ip || null,
    };

    let stored = null;
    if (!trap) {
      try {
        await storage.quotes.append(record);
        stored = 'quote_requests';
      } catch (err) {
        // 0003_shipments.sql brings the table. Without it the request still
        // reaches a human by email rather than being silently dropped.
        console.warn('[paramount] quote_requests unavailable:', err.message);
      }
      await notify.quote(record);
    }

    return res.status(201).json({
      ok: true,
      id: record.id,
      stored,
      message: 'Thank you. A Paramount lane specialist will come back to you with rates and transit times.',
    });
  } catch (err) {
    return next(err);
  }
};
