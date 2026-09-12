'use strict';

/**
 * Tracking numbers, statuses and the shape of a shipment.
 *
 * One module so the desk, the public lookup and the emails all agree on what a
 * tracking number looks like, what the stages are called and which of them
 * counts as finished.
 */

const crypto = require('crypto');

const PREFIX = 'PMT';

/**
 * Crockford base32 without I, L, O and U.
 *
 * Tracking numbers get read down a phone line and typed off a printed label,
 * so the alphabet leaves out every character that is mistaken for another.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY_LENGTH = 8;

/** PMT-2026-4F7K2QX9 */
const PATTERN = new RegExp(`^${PREFIX}-\\d{4}-[${ALPHABET}]{${BODY_LENGTH}}$`);

/**
 * The stages a consignment moves through, in the order a customer reads them.
 *
 * `progress` drives the bar on the tracking page. `terminal` marks the stages
 * after which nothing more is expected to happen.
 */
const STATUSES = [
  { id: 'pending', label: 'Booking registered', blurb: 'Consignment registered. Awaiting collection.', progress: 8, tone: 'wait' },
  { id: 'picked_up', label: 'Collected', blurb: 'Collected from the shipper and scanned into the network.', progress: 22, tone: 'go' },
  { id: 'in_transit', label: 'In transit', blurb: 'Moving between facilities.', progress: 45, tone: 'go' },
  { id: 'at_facility', label: 'At facility', blurb: 'Arrived at a Paramount hub and awaiting the next leg.', progress: 58, tone: 'go' },
  { id: 'customs', label: 'Customs clearance', blurb: 'With the customs authority for clearance.', progress: 70, tone: 'wait' },
  { id: 'out_for_delivery', label: 'Out for delivery', blurb: 'On the final-mile vehicle today.', progress: 88, tone: 'go' },
  { id: 'delivered', label: 'Delivered', blurb: 'Delivered and signed for.', progress: 100, tone: 'done', terminal: true },
  { id: 'on_hold', label: 'On hold', blurb: 'Paused pending payment, paperwork or an address correction.', progress: 50, tone: 'warn' },
  { id: 'exception', label: 'Exception', blurb: 'Delayed. Our team is working on it.', progress: 50, tone: 'bad' },
  { id: 'cancelled', label: 'Cancelled', blurb: 'This booking was cancelled.', progress: 0, tone: 'bad', terminal: true },
];

/** The stages shown as the milestone rail; the rest are off-path states. */
const MILESTONES = ['pending', 'picked_up', 'in_transit', 'at_facility', 'out_for_delivery', 'delivered'];

const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

const MODES = [
  { id: 'air_freight', label: 'Air freight' },
  { id: 'ocean_freight', label: 'Ocean freight' },
  { id: 'road_haulage', label: 'Road haulage' },
  { id: 'rail_freight', label: 'Rail freight' },
  { id: 'express_courier', label: 'Express courier' },
  { id: 'warehousing', label: 'Warehousing & fulfilment' },
];

const MODE_BY_ID = new Map(MODES.map((m) => [m.id, m]));

const isStatus = (id) => STATUS_BY_ID.has(String(id));
const isMode = (id) => MODE_BY_ID.has(String(id));

function statusMeta(id) {
  return STATUS_BY_ID.get(String(id)) || STATUS_BY_ID.get('pending');
}

function modeLabel(id) {
  const mode = MODE_BY_ID.get(String(id));
  return mode ? mode.label : 'Freight';
}

/**
 * A fresh tracking number.
 *
 * The random part is drawn from crypto, not Math.random: two agents creating a
 * consignment in the same millisecond must not be able to collide, and the
 * number is the only thing standing between a stranger and someone else's
 * consignment details.
 */
function generate(year) {
  const y = Number(year) || new Date().getFullYear();
  const bytes = crypto.randomBytes(BODY_LENGTH);
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i += 1) {
    body += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${PREFIX}-${y}-${body}`;
}

/**
 * What the customer typed, as the database stores it.
 *
 * People paste numbers with spaces in them, type them in lower case and leave
 * the dashes out, and every one of those should find their consignment. The
 * dashes are put back when the remaining characters are the right shape.
 */
function normalise(input) {
  const raw = String(input == null ? '' : input).trim().toUpperCase();
  if (!raw) return '';
  const stripped = raw.replace(/[^A-Z0-9]/g, '');
  const bare = new RegExp(`^${PREFIX}(\\d{4})([${ALPHABET}]{${BODY_LENGTH}})$`).exec(stripped);
  if (bare) return `${PREFIX}-${bare[1]}-${bare[2]}`;
  return raw.replace(/\s+/g, '');
}

const isTrackingNumber = (value) => PATTERN.test(normalise(value));

/**
 * The first tracking-number-shaped run of characters in a sentence, so the chat
 * widget can answer "where is PMT-2026-4F7K2QX9?" without the visitor having to
 * put it on a line of its own.
 */
function findInText(text) {
  const source = String(text == null ? '' : text).toUpperCase();
  const loose = new RegExp(`${PREFIX}[-\\s]?\\d{4}[-\\s]?[${ALPHABET}]{${BODY_LENGTH}}`, 'g');
  const hit = loose.exec(source);
  return hit ? normalise(hit[0]) : '';
}

module.exports = {
  PREFIX,
  PATTERN,
  ALPHABET,
  STATUSES,
  MILESTONES,
  MODES,
  generate,
  normalise,
  isTrackingNumber,
  isStatus,
  isMode,
  statusMeta,
  modeLabel,
  findInText,
};
