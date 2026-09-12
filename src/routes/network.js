'use strict';

const router = require('express').Router();
const network = require('../controllers/networkController');

router.get('/', network.list);
router.get('/:id', network.get);

module.exports = router;
