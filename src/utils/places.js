'use strict';

/**
 * The gazetteer, and what the desk can infer from a pair of places.
 *
 * Booking a consignment used to mean typing a city, then its country, then two
 * coordinates looked up somewhere else, then guessing a transit time. All of
 * that is derivable from two place names, so this module derives it: the form
 * asks for the lane and fills in the rest, and the desk corrects whatever it
 * disagrees with before saving.
 *
 * Nothing here decides anything the desk cannot overrule. A suggestion is a
 * default in a box, not a value the server enforces.
 */

const { places } = require('../data/places.json');
const { distanceNm, bearing } = require('./fleet');

/* ------------------------------------------------------------- lookup --- */

const normalise = (s) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // "Malmö" typed as "malmo" still matches
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const index = places.map((place) => ({
  ...place,
  _name: normalise(place.name),
  _country: normalise(place.country),
  _locode: place.locode.toLowerCase(),
}));

/**
 * Typeahead. Ranked so that what the person is most likely typing comes first:
 * an exact LOCODE, then a city whose name starts with the query, then one that
 * contains it, then a country match.
 */
function search(query, limit = 8) {
  const q = normalise(query);
  if (!q) return [];
  const scored = [];

  for (const place of index) {
    let score = null;
    if (place._locode === q.replace(/ /g, '')) score = 0;
    else if (place._name === q) score = 1;
    else if (place._name.startsWith(q)) score = 2;
    else if (place._name.includes(q)) score = 3;
    else if (place._country.startsWith(q)) score = 4;
    else if (place._country.includes(q)) score = 5;
    if (score !== null) scored.push({ place, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name))
    .slice(0, Math.max(1, Math.min(25, Number(limit) || 8)))
    .map(({ place }) => publicView(place));
}

/** One place, by LOCODE or by name. Used to resolve what a form submitted. */
function find(term) {
  const q = normalise(term);
  if (!q) return null;
  const flat = q.replace(/ /g, '');
  const hit =
    index.find((p) => p._locode === flat) ||
    index.find((p) => p._name === q) ||
    index.find((p) => p._name.startsWith(q));
  return hit ? publicView(hit) : null;
}

const publicView = ({ name, country, iso2, lat, lng, locode, kinds, region, landmass, coast }) => ({
  name, country, iso2, lat, lng, locode, kinds, region, landmass, coast,
});

/* ---------------------------------------------------------- inference --- */

/**
 * How each mode actually moves, door to door.
 *
 * `knots` is the speed the leg is planned at — a vessel's service speed, a
 * freighter's block speed, a truck's average including the driver's rest. The
 * fixed days are everything that is not motion: collection, terminal handling,
 * customs, the last mile. Both are the planning figures the desk quotes from,
 * not a promise, which is why the form lets them be edited.
 */
const MODES = {
  air_freight:     { knots: 430, fixedDays: 2.0, label: 'Air freight' },
  ocean_freight:   { knots: 17,  fixedDays: 6.0, label: 'Ocean freight' },
  rail_freight:    { knots: 35,  fixedDays: 4.0, label: 'Rail freight' },
  road_haulage:    { knots: 32,  fixedDays: 1.0, label: 'Road haulage' },
  express_courier: { knots: 380, fixedDays: 1.0, label: 'Express courier' },
  warehousing:     { knots: 32,  fixedDays: 1.0, label: 'Warehousing & fulfilment' },
};

/*
 * A real route is longer than the great circle between its ends, and for sea
 * freight it is a lot longer: the great circle from Shanghai to Rotterdam runs
 * across Siberia, while the ship goes round India and through Suez — 4,820
 * nautical miles against about 10,500.
 *
 * One flat factor cannot express that, because the Pacific is open water and
 * the ship really does more or less follow the great circle. So sea routes are
 * factored by which two basins the lane joins. The numbers come from published
 * port-to-port distances on the main trades, rounded; they are planning
 * figures, and the desk edits the date if the booking says otherwise.
 */
const SEA_DETOUR = {
  'asia|europe': 2.05,        // Suez
  'europe|mideast': 2.3,      // Suez, and the great circle cuts over Anatolia
  'africa|europe': 1.4,
  'europe|namerica-atl': 1.15,
  'europe|namerica': 1.15,
  'europe|samerica': 1.2,
  'europe|oceania': 1.45,
  'asia|mideast': 1.25,
  'africa|asia': 1.35,
  'asia|namerica-pac': 1.08,   // trans-Pacific: near enough a great circle
  'asia|namerica-atl': 1.8,    // through Panama, and three weeks longer for it
  'europe|namerica-pac': 1.9,  // also through Panama, the other way
  'asia|namerica': 1.08,
  'asia|samerica': 1.2,
  'asia|oceania': 1.15,
  'africa|mideast': 1.4,
  'mideast|namerica-atl': 1.7,
  'mideast|namerica-pac': 1.9,
  'mideast|namerica': 1.6,
  'mideast|samerica': 1.45,
  'mideast|oceania': 1.2,
  'africa|namerica': 1.25,
  'africa|samerica': 1.15,
  'africa|oceania': 1.25,
  'namerica|samerica': 1.35,   // Panama, or round the Horn for the big ships
  'namerica|oceania': 1.15,
  'oceania|samerica': 1.15,
};
const SEA_SAME_BASIN = 1.25;

/** Land and air routes bend far less, so one factor each is honest enough. */
const DETOUR = { rail_freight: 1.35, road_haulage: 1.32, air_freight: 1.05, express_courier: 1.05, warehousing: 1.3 };

/* A North American port is not one basin but two, so it is keyed by its coast
   where it has one — falling back to the plain region, which is what an inland
   hub and everywhere else in the world use. */
const basin = (place) =>
  place.region === 'namerica' && place.coast
    ? `namerica-${place.coast === 'pacific' ? 'pac' : 'atl'}`
    : place.region;

function detourFor(mode, origin, destination) {
  if (mode !== 'ocean_freight') return DETOUR[mode] || 1.2;
  if (origin.region === destination.region) return SEA_SAME_BASIN;
  const pair = [basin(origin), basin(destination)].sort().join('|');
  if (SEA_DETOUR[pair]) return SEA_DETOUR[pair];
  const plain = [origin.region, destination.region].sort().join('|');
  return SEA_DETOUR[plain] || 1.4;
}

const has = (place, kind) => Array.isArray(place.kinds) && place.kinds.includes(kind);

/*
 * Rail networks: sets of landmasses with a through route a container can
 * actually ride. Two of them carry the traffic this desk books — the
 * Asia-Europe block trains, and North American intermodal. The Middle East and
 * India are deliberately absent: there is no through rail out of either, so
 * proposing it would be proposing something nobody can book.
 */
const RAIL_NETWORKS = [
  new Set(['europe', 'east-asia', 'indochina']),
  new Set(['namerica']),
];
const railLinked = (a, b) =>
  a.landmass === b.landmass || RAIL_NETWORKS.some((net) => net.has(a.landmass) && net.has(b.landmass));

/* Road needs the same landmass, full stop. That is the whole point of the
   field: Auckland and Sydney are 1,164 nm apart and share a region, and a lorry
   still cannot make the trip. */
const roadLinked = (a, b) => a.landmass === b.landmass;

const ROAD_LIMIT_NM = 1600;   // about two days' driving with the rests
const RAIL_LIMIT_NM = 6500;   // Chengdu to Duisburg is 4,250

/**
 * The mode this lane probably wants.
 *
 * Deliberately simple, and deliberately conservative: it proposes what most of
 * this traffic actually books, and the desk changes it when the cargo says
 * otherwise. The order is the argument —
 *
 *   1. close enough to drive, and connected by land, so drive it;
 *   2. still on one landmass, so put it on a train rather than round a coast;
 *   3. crossing water with a real rail link and no port at one end, so train;
 *   4. a seaport at both ends, so ship it;
 *   5. otherwise fly it.
 *
 * Step 3 checks for a seaport precisely because Shanghai to Rotterdam is on the
 * block-train network and still goes by sea: when both ends can take a ship,
 * the ship wins.
 */
function suggestMode(origin, destination) {
  if (!origin || !destination) return 'ocean_freight';
  const nm = distanceNm(origin, destination);
  const seaBoth = has(origin, 'sea') && has(destination, 'sea');
  const sameLand = roadLinked(origin, destination);

  if (sameLand && nm < ROAD_LIMIT_NM) return 'road_haulage';
  if (sameLand && nm < RAIL_LIMIT_NM) return 'rail_freight';
  if (!seaBoth && railLinked(origin, destination) && nm < RAIL_LIMIT_NM) return 'rail_freight';
  if (seaBoth) return 'ocean_freight';
  return 'air_freight';
}

/** Transit in days for a lane on a mode, rounded to something quotable. */
function transitDays(origin, destination, mode) {
  const spec = MODES[mode] || MODES.ocean_freight;
  if (!origin || !destination) return Math.ceil(spec.fixedDays);
  const nm = distanceNm(origin, destination) * detourFor(mode, origin, destination);
  const moving = nm / spec.knots / 24;
  return Math.max(1, Math.round(moving + spec.fixedDays));
}

/**
 * Everything the booking form can fill in once it knows the lane.
 *
 * Returned as plain values so the form can drop them straight into its boxes.
 * `confidence` is what it is: these are planning figures, and the caller is
 * expected to say so rather than present them as facts.
 */
function suggestLane(originTerm, destinationTerm, modeWanted) {
  const origin = typeof originTerm === 'string' ? find(originTerm) : originTerm;
  const destination = typeof destinationTerm === 'string' ? find(destinationTerm) : destinationTerm;
  if (!origin || !destination) return null;

  const mode = MODES[modeWanted] ? modeWanted : suggestMode(origin, destination);
  const spec = MODES[mode];
  const greatCircle = distanceNm(origin, destination);
  const routed = greatCircle * detourFor(mode, origin, destination);
  const days = transitDays(origin, destination, mode);

  return {
    origin,
    destination,
    mode,
    mode_label: spec.label,
    distance_nm: Math.round(greatCircle),
    routed_nm: Math.round(routed),
    course: Math.round(bearing(origin, destination)),
    transit_days: days,
    planned_speed_kn: spec.knots,
    // Both ends are seaports on an intercontinental lane, so a box on a ship
    // is the obvious default — the form uses this to pick a container size.
    containerised: mode === 'ocean_freight' || mode === 'rail_freight',
  };
}

module.exports = { search, find, suggestLane, suggestMode, transitDays, MODES, places };
