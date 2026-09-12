'use strict';

/**
 * The customer portal.
 *
 * A signed-in customer sees every consignment of theirs in one place. Which
 * ones are theirs is decided two ways, and the distinction is the whole
 * security model of this file:
 *
 *   - Claimed: they entered the tracking number. Holding the number is already
 *     what public tracking accepts as proof, so this grants nothing new.
 *   - Matched: the consignment carries their email address as shipper or
 *     consignee. Only ever applied to an address Supabase has confirmed —
 *     otherwise registering someone else's address would hand over their
 *     consignments.
 *
 * Everything returned goes through the same public projection the tracking page
 * uses, so the portal cannot leak a field /track would not.
 */

const shipments = require('../utils/shipmentStore');
const tracking = require('../utils/tracking');
const siteSettings = require('../utils/siteSettings');
const { requireCustomer } = require('../utils/sessionAuth');

const REASONS = {
  missing_token: 'Sign in to see your consignments.',
  invalid_token: 'That session has expired. Sign in again.',
  no_email: 'This account has no email address, so there is nothing to match consignments against.',
  supabase_not_configured: 'Accounts are not available on this deployment.',
  auth_unreachable: 'Could not reach the sign-in service. Try again in a moment.',
};

/**
 * The caller, and what the portal will do for them.
 *
 * Answers the request itself when there is no one signed in, so each route can
 * bail on a falsy return rather than repeating the error shape.
 */
async function gate(req, res) {
  const settings = await siteSettings.read();
  if (!settings.portal_enabled) {
    res.status(404).json({ error: 'portal_disabled', message: 'The customer portal is not available.' });
    return null;
  }

  const session = await requireCustomer(req);
  if (!session.ok) {
    res.status(session.status).json({
      error: session.reason,
      message: REASONS[session.reason] || 'Not permitted.',
    });
    return null;
  }

  return {
    userId: session.user.id,
    email: session.email,
    emailConfirmed: session.emailConfirmed,
    // Both have to agree: the address is proved, and the business wants
    // addresses to link at all.
    matchEmail: session.emailConfirmed && settings.portal_email_matching,
  };
}

/** The card the portal lists: the public view, plus how it got there. */
async function summarise({ row, via }) {
  const events = await shipments.listEvents(row.id);
  const view = shipments.toPublic(row, events);
  view.via = via;
  view.last_event = view.events[0] || null;
  // The list does not need the whole history behind every card.
  delete view.events;
  return view;
}

/* ------------------------------------------------------------------ list --- */

/** GET /api/portal/shipments */
exports.list = async (req, res, next) => {
  try {
    const who = await gate(req, res);
    if (!who) return undefined;

    const rows = await shipments.listForCustomer(who);
    const list = await Promise.all(rows.map(summarise));

    const counts = list.reduce(
      (acc, s) => {
        if (s.is_delivered) acc.delivered += 1;
        else if (s.status === 'exception' || s.status === 'on_hold') acc.attention += 1;
        else if (s.status !== 'cancelled') acc.active += 1;
        return acc;
      },
      { active: 0, delivered: 0, attention: 0 }
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      account: {
        email: who.email,
        emailConfirmed: who.emailConfirmed,
        // Said plainly, because it changes what the customer sees: without a
        // confirmed address only claimed consignments appear.
        emailMatching: who.matchEmail,
      },
      count: list.length,
      counts,
      shipments: list,
    });
  } catch (err) {
    return next(err);
  }
};

/* ---------------------------------------------------------------- detail --- */

/** GET /api/portal/shipments/:number — the full timeline, if it is theirs. */
exports.get = async (req, res, next) => {
  try {
    const who = await gate(req, res);
    if (!who) return undefined;

    const number = tracking.normalise(req.params.number);
    const shipment = number ? await shipments.getByTrackingNumber(number) : null;

    // A consignment that exists but is not theirs, and one that does not exist,
    // answer identically: the portal must not become a way to test numbers.
    if (!shipment || !(await shipments.customerCanSee(who, shipment))) {
      return res.status(404).json({
        error: 'not_found',
        message: 'That consignment is not on your account. Add it with its tracking number.',
      });
    }

    const events = await shipments.listEvents(shipment.id);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, shipment: shipments.toPublic(shipment, events) });
  } catch (err) {
    return next(err);
  }
};

/* ---------------------------------------------------------------- claims --- */

/**
 * POST /api/portal/claims
 *
 * Add a consignment to the account by its tracking number. Deliberately the
 * same answer for a number that does not exist and one that does: this route is
 * rate limited like the rest of the API, but it should not be a cheaper oracle
 * than /api/track either way.
 */
exports.claim = async (req, res, next) => {
  try {
    const who = await gate(req, res);
    if (!who) return undefined;

    const raw = (req.body && (req.body.trackingNumber || req.body.tracking_number || req.body.number)) || '';
    const number = tracking.normalise(raw);

    if (!number || !tracking.isTrackingNumber(number)) {
      return res.status(422).json({
        error: 'malformed_tracking_number',
        message: `That is not a Paramount tracking number. They look like ${tracking.PREFIX}-${new Date().getFullYear()}-4F7K2QX9.`,
      });
    }

    const shipment = await shipments.getByTrackingNumber(number);
    if (!shipment) {
      return res.status(404).json({
        error: 'not_found',
        message: 'No consignment found for that number. Check it against your paperwork.',
        trackingNumber: number,
      });
    }

    const label = req.body && req.body.label ? String(req.body.label).trim().slice(0, 120) : null;
    try {
      await shipments.claim(who.userId, shipment.id, label);
    } catch (err) {
      // Without the table there is nowhere to record it, and saying so beats a
      // 500 that reads like the consignment is the problem.
      if (!shipments.isMissingTable(err)) throw err;
      return res.status(503).json({
        error: 'claims_unavailable',
        message: 'Consignments cannot be added to accounts on this deployment yet. Please contact the desk.',
      });
    }

    const events = await shipments.listEvents(shipment.id);
    const view = shipments.toPublic(shipment, events);
    view.via = 'claim';
    view.last_event = view.events[0] || null;
    delete view.events;

    return res.status(201).json({ ok: true, shipment: view });
  } catch (err) {
    return next(err);
  }
};

/**
 * DELETE /api/portal/claims/:number
 *
 * Take a consignment off the account. It removes the claim only: a consignment
 * that also matches the customer's address stays visible, and the consignment
 * itself is never touched.
 */
exports.unclaim = async (req, res, next) => {
  try {
    const who = await gate(req, res);
    if (!who) return undefined;

    const number = tracking.normalise(req.params.number);
    const shipment = number ? await shipments.getByTrackingNumber(number) : null;
    if (!shipment) {
      return res.status(404).json({ error: 'not_found', message: 'No consignment found for that number.' });
    }

    await shipments.removeClaim(who.userId, shipment.id);
    return res.json({ ok: true, removed: shipment.tracking_number });
  } catch (err) {
    return next(err);
  }
};
