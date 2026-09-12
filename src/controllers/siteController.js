'use strict';

const siteSettings = require('../utils/siteSettings');

/**
 * GET /api/site
 *
 * The contact details every page hydrates itself from, plus the two chat
 * settings the widget needs before it opens. Public, and public by design:
 * these are the details printed on the pages anyway. The delivery settings —
 * where notifications go, what the signature is — are deliberately not here;
 * they reach the desk through PostgREST under an admin session.
 */
exports.get = async (req, res, next) => {
  try {
    // `?fresh=1` skips both caches. The desk uses it to confirm a change it
    // has just saved, rather than waiting out a TTL and wondering.
    const fresh = Boolean(req.query.fresh);
    const settings = await siteSettings.read({ fresh });

    if (fresh) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      // Short cache: an edit at the desk should reach the site quickly, but
      // this is read on every page load.
      res.setHeader('Cache-Control', 'public, max-age=30');
    }
    return res.json(siteSettings.publicView(settings));
  } catch (err) {
    return next(err);
  }
};
