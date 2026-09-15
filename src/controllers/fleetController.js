'use strict';

/**
 * GET /api/fleet
 *
 * Where the fleet is now. Public: a vessel's position, class and voyage are
 * what any AIS receiver on a hilltop can already see, and the panel is the
 * point of the home page.
 *
 * Deliberately not cached for long — the positions are computed per request
 * from the clock, so a cached response is a stopped clock.
 */

const fleet = require('../utils/fleet');

exports.snapshot = (req, res, next) => {
  try {
    const data = fleet.snapshot();
    res.setHeader('Cache-Control', 'public, max-age=20');
    return res.json(data);
  } catch (err) {
    return next(err);
  }
};

/** GET /api/fleet/:id — one vessel, for a deep link into the tracker. */
exports.get = (req, res, next) => {
  try {
    const data = fleet.snapshot();
    const vessel = data.vessels.find((v) => v.id === req.params.id);
    if (!vessel) return res.status(404).json({ error: 'not_found', message: 'No such vessel.' });
    res.setHeader('Cache-Control', 'public, max-age=20');
    return res.json({ ok: true, vessel, generatedAt: data.generatedAt });
  } catch (err) {
    return next(err);
  }
};
