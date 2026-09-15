'use strict';

const router = require('express').Router();
const fleet = require('../controllers/fleetController');

router.get('/', fleet.snapshot);
router.get('/:id', fleet.get);

module.exports = router;
