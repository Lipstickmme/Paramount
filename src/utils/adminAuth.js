'use strict';

/**
 * Kept as its own name because that is what the routes needing staff say they
 * need. The check itself, and the customer equivalent beside it, live in
 * sessionAuth.js.
 */

const { requireAdmin } = require('./sessionAuth');

module.exports = { requireAdmin };
