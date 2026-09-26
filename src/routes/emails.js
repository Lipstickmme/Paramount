'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/emailController');

router.post('/reply', ctrl.reply);
// Admin only: one message through the same path customer mail takes.
router.post('/test', ctrl.test);

module.exports = router;
