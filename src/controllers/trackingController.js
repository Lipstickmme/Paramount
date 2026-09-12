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
const tracking = require('../utils/tracking');

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

    const events = await shipments.listEvents(shipment.id);
    const view = shipments.toPublic(shipment, events);

    // A consignment that is still moving should not be cached; a delivered one
    // will not change again.
    res.setHeader('Cache-Control', view.is_delivered ? 'public, max-age=300' : 'no-store');
    return res.json({ ok: true, shipment: view });
  } catch (err) {
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

module.exports = { lookup, reference };
