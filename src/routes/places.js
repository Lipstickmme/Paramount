'use strict';

const router = require('express').Router();
const places = require('../controllers/placesController');

router.get('/', places.search);
router.get('/lane', places.lane);

module.exports = router;
