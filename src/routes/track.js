'use strict';

const router = require('express').Router();
const tracking = require('../controllers/trackingController');

// `reference` first: otherwise it is read as a tracking number.
router.get('/reference', tracking.reference);

// Both shapes answer identically. The POST exists so the form on the home page
// can submit without putting the number in a URL, and the GET so a tracking
// link can be emailed.
router.post('/', tracking.lookup);
router.get('/:number', tracking.lookup);

// Anyone holding the number may ask to see the cargo. The /track limiter this
// router sits behind is what keeps it from being used to spam the desk.
router.post('/:number/photo-request', tracking.requestPhoto);

module.exports = router;
