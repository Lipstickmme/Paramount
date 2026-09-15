'use strict';

/**
 * API router. Mounts feature routers under /api.
 */

const router = require('express').Router();

const system = require('../controllers/systemController');

router.get('/health', system.health);
router.get('/public-config', system.publicConfig);
router.get('/site', require('../controllers/siteController').get);

// Public tracking: the route the home page's search box lands on. It carries
// its own tighter limit, so walking the number space runs out long before an
// ordinary visitor does.
router.use('/track', require('../middleware/rateLimiter').trackLimiter, require('./track'));
// Desk-only. Each handler checks the caller's session for itself.
router.use('/shipments', require('./shipments'));
// Customers, signed in to their own account.
router.use('/portal', require('./portal'));

// The live fleet behind the tracker on the home page.
router.use('/fleet', require('./fleet'));

router.use('/services', require('./services'));
router.use('/network', require('./network'));
router.use('/team', require('./team'));
router.use('/careers', require('./careers'));
router.use('/leadership', require('./leadership'));
router.use('/quotes', require('./quotes'));
router.use('/contact', require('./contact'));
router.use('/applications', require('./applications'));
router.use('/chat', require('./chat'));
router.use('/emails', require('./emails'));

module.exports = router;
