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
      /*
       * Revalidate every time, and let the ETag answer 304 when nothing has
       * changed.
       *
       * This used to be `max-age=30`, which meant a browser that had loaded
       * any page in the last half minute served the old contact details out of
       * its own cache without asking — so an edit at the desk could sit
       * invisible for thirty seconds on exactly the pages someone was looking
       * at. That is the opposite of what this endpoint is for.
       *
       * `no-cache` does not mean "do not cache": it means "ask first". The
       * response is a few hundred bytes, the answer is usually a 304 with no
       * body, and siteSettings keeps its own short cache so the round trip
       * rarely reaches the database.
       */
      res.setHeader('Cache-Control', 'no-cache');
    }
    return res.json(siteSettings.publicView(settings));
  } catch (err) {
    return next(err);
  }
};
