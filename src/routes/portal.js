'use strict';

/**
 * Customer portal routes. Every handler checks the caller's session itself, so
 * mounting order cannot accidentally leave one open.
 */

const router = require('express').Router();
const portal = require('../controllers/portalController');
const auth = require('../controllers/portalAuthController');
const { authLimiter } = require('../middleware/rateLimiter');

// Registering and resetting send an email each, so they carry their own tight
// limit. They take no session — they are how somebody gets one.
router.post('/register', authLimiter, auth.register);
router.post('/reset', authLimiter, auth.reset);

router.get('/shipments', portal.list);
router.get('/shipments/:number', portal.get);
router.post('/claims', portal.claim);
router.delete('/claims/:number', portal.unclaim);

module.exports = router;
