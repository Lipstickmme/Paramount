'use strict';

/**
 * The gazetteer, for the booking form's typeahead and its lane suggestions.
 *
 * Reference data, like /api/network: it is in the repository rather than the
 * database, so it changes with a deploy and can be cached hard. Nothing here
 * reads or writes a consignment, so nothing here needs a session.
 */

const places = require('../utils/places');

/** GET /api/places?q=rotter — what the desk is probably typing. */
exports.search = (req, res) => {
  const q = String(req.query.q || '').trim();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (!q) return res.json({ places: [] });
  return res.json({ places: places.search(q, req.query.limit) });
};

/**
 * GET /api/places/lane?from=Shanghai&to=Rotterdam[&mode=ocean_freight]
 *
 * Everything the form can fill in once it knows the two ends: the mode this
 * lane usually books, the distance, the course, and a transit time to date the
 * booking from. Planning figures — the response says so, and the desk edits
 * whatever it disagrees with before saving.
 */
exports.lane = (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  if (!from || !to) {
    return res.status(400).json({
      error: 'missing_places',
      message: 'Give both ends of the lane: ?from=Shanghai&to=Rotterdam.',
    });
  }

  const lane = places.suggestLane(from, to, req.query.mode);
  res.setHeader('Cache-Control', 'public, max-age=86400');

  // A place we have no coordinates for is not an error: the desk typed a city
  // the gazetteer does not carry, the request worked, and the answer is that
  // there is no suggestion. Answering 404 would put a red line in the console
  // of a form that is behaving exactly as designed.
  if (!lane) {
    const missing = places.find(from) ? to : from;
    return res.json({
      lane: null,
      unknown: missing,
      message: `We have no coordinates for ${missing}. Type a nearby port, or enter the coordinates by hand.`,
    });
  }

  return res.json({
    ...lane,
    basis: 'Planning figures from the lane and the mode, not a carrier quote.',
  });
};
