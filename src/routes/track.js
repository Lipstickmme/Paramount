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

module.exports = router;
