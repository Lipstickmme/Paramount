'use strict';

/**
 * Desk-only shipment routes. Every handler gates on the caller's session
 * itself, so mounting order cannot accidentally leave one open.
 */

const router = require('express').Router();
const shipments = require('../controllers/shipmentsController');

router.get('/', shipments.list);
router.post('/', shipments.create);
router.get('/:id', shipments.get);
router.patch('/:id', shipments.update);
router.delete('/:id', shipments.remove);
router.get('/:id/events', shipments.events);
router.post('/:id/events', shipments.addEvent);
router.get('/:id/photos', shipments.photos);
router.post('/:id/photos', shipments.addPhoto);
router.delete('/:id/photos/:photoId', shipments.removePhoto);

module.exports = router;
