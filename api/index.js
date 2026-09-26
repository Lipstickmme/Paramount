'use strict';

/**
 * The one Vercel function behind every /api/* address.
 *
 * vercel.json rewrites /api/:path* here, and a rewrite keeps the original
 * URL, so the Express app routes on the path the browser asked for exactly
 * as it does locally.
 *
 * It is one file on purpose. Vercel's filesystem routing compiles every
 * bracketed segment of a file name — `[...rest]` included — to a single path
 * segment, so reaching /api/shipments/:id/events that way took a file per
 * depth; seventeen of them passed the Hobby plan's limit of twelve functions
 * per deployment, and the deploys that carried them never went live. A
 * rewrite has neither problem. scripts/check-vercel-routes.js holds both
 * lines: every route must reach a function, and there must be at most twelve.
 */

module.exports = require('../src/api-app');
