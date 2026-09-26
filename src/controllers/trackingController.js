'use strict';

/**
 * Public tracking.
 *
 * The one route a stranger can reach a consignment through, and the only thing
 * standing between them and it is knowing the whole tracking number — so this
 * is deliberately narrow: an exact match, a customer-facing projection of the
 * row (shipmentStore.toPublic), and a 404 that says nothing about whether the
 * number is close to a real one.
 *
 * Rate limiting is applied to the whole /api namespace, which is what stops the
 * number space being walked.
 */

const shipments = require('../utils/shipmentStore');
const photos = require('../utils/photoStore');
const tracking = require('../utils/tracking');
const notify = require('../utils/notify');

/** The number out of a path segment, a query string or a posted body. */
function requestedNumber(req) {
  return (
    (req.params && req.params.number) ||
    (req.body && (req.body.trackingNumber || req.body.tracking_number || req.body.number)) ||
    (req.query && (req.query.number || req.query.q)) ||
    ''
  );
}

async function lookup(req, res, next) {
  try {
    const raw = requestedNumber(req);
    const number = tracking.normalise(raw);

    if (!number) {
      return res.status(422).json({
        error: 'missing_tracking_number',
        message: 'Enter a tracking number to see where a consignment is.',
      });
    }

    // Reject the obviously wrong shape before touching the database, and say
    // what a real one looks like: most mistyped numbers are a missing digit.
    if (!tracking.isTrackingNumber(number)) {
      return res.status(422).json({
        error: 'malformed_tracking_number',
        message: `That is not a Paramount tracking number. They look like ${tracking.PREFIX}-${new Date().getFullYear()}-4F7K2QX9.`,
        trackingNumber: number,
      });
    }

    const shipment = await shipments.getByTrackingNumber(number);
    if (!shipment) {
      return res.status(404).json({
        error: 'not_found',
        message:
          'No consignment found for that number. Check it against your paperwork, or contact the desk and we will look it up.',
        trackingNumber: number,
      });
    }

    const [events, gallery] = await Promise.all([
      shipments.listEvents(shipment.id),
      photos.publicView(shipment.id),
    ]);
    const view = { ...shipments.toPublic(shipment, events), ...gallery };

    // A consignment that is still moving should not be cached; a delivered one
    // will not change again.
    res.setHeader('Cache-Control', view.is_delivered ? 'public, max-age=300' : 'no-store');
    return res.json({ ok: true, shipment: view });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/track/:number/photo-request
 *
 * Holding the number is what lets anyone see the consignment, so it is also
 * what lets them ask to see the cargo. An address is optional and only used to
 * say the photo is up; asking twice is the same request, and the desk is
 * emailed once, when the first one opens.
 */
async function requestPhoto(req, res, next) {
  try {
    const number = tracking.normalise(requestedNumber(req));
    if (!tracking.isTrackingNumber(number)) {
      return res.status(422).json({ error: 'malformed_tracking_number', message: 'That is not a Paramount tracking number.' });
    }

    const body = req.body || {};
    // The same trap the contact form sets. A bot that fills it is told it
    // worked, and nothing is filed.
    if (String(body.website || '').trim()) return res.status(201).json({ ok: true, request: { open: true } });

    const email = String(body.email || '').trim().slice(0, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(422).json({ error: 'invalid_email', message: 'That email address does not look right. Leave it blank if you would rather not be told.' });
    }
    const note = String(body.note || '').trim().slice(0, 500) || null;

    const shipment = await shipments.getByTrackingNumber(number);
    if (!shipment) {
      return res.status(404).json({ error: 'not_found', message: 'No consignment found for that number.' });
    }
    if (shipment.status === 'cancelled') {
      return res.status(409).json({ error: 'cancelled', message: 'That consignment was cancelled, so there is nothing to photograph.' });
    }

    const result = await photos.requestPhoto(shipment.id, { email: email || null, note });
    if (result.first) {
      // Its failure is swallowed: a desk email that did not go should not tell
      // the customer their request did not either. It is filed regardless.
      await notify.photoRequested(shipment, result.request).catch(() => false);
    }

    return res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: result.duplicate,
      request: { open: true, requested_at: result.request.created_at },
      message: email
        ? 'Requested. The desk will add a photo here, and we will email you when it is up.'
        : 'Requested. The desk will add a photo here; check back on this page.',
    });
  } catch (err) {
    if (err instanceof photos.PhotoError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    return next(err);
  }
}

/** GET /api/track/reference — the stages and modes the UI labels itself with. */
function reference(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    statuses: tracking.STATUSES,
    milestones: tracking.MILESTONES,
    modes: tracking.MODES,
    prefix: tracking.PREFIX,
    example: `${tracking.PREFIX}-${new Date().getFullYear()}-4F7K2QX9`,
  });
}

module.exports = { lookup, reference, requestPhoto };
