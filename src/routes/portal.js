'use strict';

/**
 * Customer portal routes. Every handler checks the caller's session itself, so
 * mounting order cannot accidentally leave one open.
 */

const router = require('express').Router();
const portal = require('../controllers/portalController');
const auth = require('../controllers/portalAuthController');
const { authLimiter } = require('../middleware/rateLimiter');

// Resetting sends an email, so it carries its own tight limit and takes no
// session. There is no register route: tracking needs no account, and the
// accounts that do exist are opened by the desk.
router.post('/reset', authLimiter, auth.reset);

router.get('/shipments', portal.list);
router.get('/shipments/:number', portal.get);
router.post('/claims', portal.claim);
router.delete('/claims/:number', portal.unclaim);

module.exports = router;
