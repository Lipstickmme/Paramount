'use strict';

/**
 * Vercel's filesystem routing compiles every bracketed segment in a file name
 * to exactly one path segment, `[...name]` included: `api/[...path].js`
 * answers /api/health but not /api/shipments/abc, and `api/x/[...rest].js`
 * answers /api/x/abc but not /api/x/abc/events. Anything deeper reaches the
 * edge router and 404s before Express sees it, with no JSON body, which the
 * pages show as a bare "Request failed (404)".
 *
 * So every depth the API uses has a file of its own, each re-exporting the
 * same app. The app routes on the original URL, so which file answers makes
 * no difference once it is running. scripts/check-vercel-routes.js fails the
 * test run if a route is added that no file here reaches.
 */

module.exports = require('../../src/api-app');
