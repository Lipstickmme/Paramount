'use strict';

/**
 * Customer portal routes. Every handler checks the caller's session itself, so
 * mounting order cannot accidentally leave one open.
 */

const router = require('express').Router();
const portal = require('../controllers/portalController');

router.get('/shipments', portal.list);
router.get('/shipments/:number', portal.get);
router.post('/claims', portal.claim);
router.delete('/claims/:number', portal.unclaim);

module.exports = router;
