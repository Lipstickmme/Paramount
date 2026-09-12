'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/chatController');

router.get('/', ctrl.greeting);
router.post('/message', ctrl.postMessage);
router.post('/notify', ctrl.notifyMessage);
router.get('/:sessionId', ctrl.getSession);

module.exports = router;
