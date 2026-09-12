'use strict';

/**
 * The hubs, lanes and headline numbers behind the network page and the map on
 * the home page. Editorial content, so it is served from src/data rather than
 * the database: it changes with a deploy, not from the desk.
 */

const network = require('../data/network.json');
const industries = require('../data/industries.json');

exports.list = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.json({ ...network, industries });
};

exports.get = (req, res) => {
  const hub = network.hubs.find((h) => h.id === req.params.id);
  if (!hub) return res.status(404).json({ error: 'not_found', message: 'No such hub.' });
  res.setHeader('Cache-Control', 'public, max-age=600');
  return res.json(hub);
};
