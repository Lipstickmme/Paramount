'use strict';

const router = require('express').Router();
const quotes = require('../controllers/quotesController');

router.post('/', quotes.create);

module.exports = router;
