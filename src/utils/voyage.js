'use strict';

/**
 * Where a consignment is between scans.
 *
 * A tracking event is a fact: somebody or some carrier feed wrote it, with a
 * time and a place. Between two of them there is nothing, and on an ocean leg
 * "nothing" can last a fortnight — which is exactly the stretch a customer
 * spends wondering whether their cargo is moving.
 *
 * So this fills the gap the only honest way available: from the last recorded
 * position, along the route to the destination, at the speed that mode plans
 * for, against the clock. That is dead reckoning, and it is what a navigator
 * did for four hundred years before satellites. It is an *estimate*, it is
 * labelled as one everywhere it is shown, and the moment a real scan arrives
 * the estimate is thrown away and the scan is used instead.
 *
 * Two rules keep it from lying:
 *
 *   It never passes the destination. Dead reckoning that sails a box past its
 *   discharge port is worse than no position at all.
 *
 *   It never contradicts the promised date. Where an estimated delivery exists
 *   the marker is paced to arrive on it, because that date is what the customer
 *   was told and the picture has to agree with the words.
 *
 *   It never sails over land. Sea legs follow the lane network in searoute.js —
 *   Malacca, Suez, Panama — rather than the great circle, which for Shanghai to
 *   Rotterdam runs across Siberia.
 */

const { distanceNm, interpolate, bearing } = require('./fleet');
const searoute = require('./searoute');

/** Planned speeds, in knots. The same figures the lane suggestions quote. */
const SPEEDS = {
  air_freight: 430,
  express_courier: 380,
  ocean_freight: 17,
  rail_freight: 35,
  road_haulage: 32,
  warehousing: 32,
};

const num = (value) => (value == null || value === '' ? null : Number(value));
const point = (lat, lng) => {
  const a = num(lat);
  const b = num(lng);
  return a == null || b == null || Number.isNaN(a) || Number.isNaN(b) ? null : { lat: a, lng: b };
};

/** The most recent event that actually carries a position. */
function lastFix(events) {
  const fixes = (events || [])
    .filter((e) => point(e.lat, e.lng) && e.occurred_at)
    .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  const latest = fixes[fixes.length - 1];
  if (!latest) return null;
  return {
    ...point(latest.lat, latest.lng),
    at: new Date(latest.occurred_at).getTime(),
    location: latest.location || null,
  };
}

/**
 * The consignment's position now, and the route it is on.
 *
 * Returns null when there is not enough to say anything — no origin, no
 * destination, or coordinates that never got filled in. A missing map is
 * better than an invented one.
 */
function position(shipment, events, now = Date.now()) {
  if (!shipment) return null;

  const origin = point(shipment.origin_lat, shipment.origin_lng);
  const destination = point(shipment.destination_lat, shipment.destination_lng);
  if (!origin || !destination) return null;

  const mode = shipment.mode || 'ocean_freight';
  const speedKn = SPEEDS[mode] || SPEEDS.ocean_freight;
  const status = shipment.status;
  const totalNm = distanceNm(origin, destination);

  const finished = status === 'delivered';
  const stopped = status === 'cancelled' || status === 'on_hold';
  const notStarted = status === 'pending';

  const fix = lastFix(events);
  const anchor = fix || {
    ...origin,
    at: new Date(shipment.departed_at || shipment.picked_up_at || shipment.created_at || now).getTime(),
    location: [shipment.origin_city, shipment.origin_country].filter(Boolean).join(', ') || null,
  };

  const base = {
    origin,
    destination,
    mode,
    total_nm: Math.round(totalNm),
    speed_kn: speedKn,
    course: Math.round(bearing(origin, destination)),
    anchor: { lat: anchor.lat, lng: anchor.lng, at: new Date(anchor.at).toISOString(), location: anchor.location },
  };

  // Delivered, cancelled or held: it is where it was last seen, and it is not
  // moving. Nothing to dead-reckon, so nothing is invented.
  if (finished) {
    const done = mode === 'ocean_freight' ? searoute.route(origin, destination) : [origin, destination];
    return {
      ...base,
      ...destination,
      route: done.map(({ lat, lng, name }) => (name ? { lat, lng, name } : { lat, lng })),
      route_nm: Math.round(measure(done).pop()),
      moving: false,
      source: 'delivered',
      progress: 1,
      remaining_nm: 0,
    };
  }
  if (stopped || notStarted) {
    const here = notStarted ? origin : { lat: anchor.lat, lng: anchor.lng };
    const held = mode === 'ocean_freight' ? searoute.route(origin, destination) : [origin, destination];
    const heldMarks = measure(held);
    const total = heldMarks[heldMarks.length - 1];
    const done = notStarted ? 0 : alongAt(held, heldMarks, here);
    return {
      ...base,
      ...here,
      route: held.map(({ lat, lng, name }) => (name ? { lat, lng, name } : { lat, lng })),
      route_nm: Math.round(total),
      moving: false,
      source: notStarted ? 'origin' : 'held',
      progress: total < 0.5 ? 1 : done / total,
      remaining_nm: Math.round(total - done),
    };
  }

  // The water it actually follows, and where along it the last fix sits.
  const line = mode === 'ocean_freight' ? searoute.route(origin, destination) : [origin, destination];
  const marks = measure(line);
  const totalLine = marks[marks.length - 1];
  const anchorAlong = alongAt(line, marks, anchor);
  const legNm = Math.max(0, totalLine - anchorAlong);

  base.route = line.map(({ lat, lng, name }) => (name ? { lat, lng, name } : { lat, lng }));
  base.route_nm = Math.round(totalLine);

  if (legNm < 0.5) {
    return { ...base, ...destination, moving: false, source: 'arrived', progress: 1, remaining_nm: 0 };
  }

  const eta = shipment.estimated_delivery ? new Date(shipment.estimated_delivery).getTime() : null;
  const elapsedHours = Math.max(0, (now - anchor.at) / 3600000);

  // Paced to the promised date where there is one, and to the planned speed
  // where there is not. `basis` says which, because the difference is the
  // difference between a promise and an average.
  let share;
  let basis;
  if (eta && eta > anchor.at) {
    share = (now - anchor.at) / (eta - anchor.at);
    basis = 'eta';
  } else {
    share = (elapsedHours * speedKn) / legNm;
    basis = 'speed';
  }
  // Never past the destination: a box that arrives early waits at the quay.
  share = Math.max(0, Math.min(1, share));

  const along = anchorAlong + legNm * share;
  const here = pointAt(line, marks, along);

  return {
    ...base,
    lat: here.lat,
    lng: here.lng,
    moving: share < 1,
    source: 'estimated',
    basis,
    course: Math.round(here.course),
    progress: Math.max(0, Math.min(1, along / totalLine)),
    leg_nm: Math.round(legNm),
    remaining_nm: Math.round(totalLine - along),
    // What the page needs to keep the marker moving between polls without
    // asking the server again: the anchor, the target and the clock.
    anchor_along_nm: Math.round(anchorAlong),
    eta: eta ? new Date(eta).toISOString() : null,
  };
}

/* ---------------------------------------------------- along a polyline --- */

/** Cumulative distance to each vertex, so a point can be found by distance. */
function measure(points) {
  const marks = [0];
  for (let i = 1; i < points.length; i += 1) {
    marks.push(marks[i - 1] + distanceNm(points[i - 1], points[i]));
  }
  return marks;
}

/** The point `nm` along a measured polyline, and the course it is making. */
function pointAt(points, marks, nm) {
  const total = marks[marks.length - 1];
  const want = Math.max(0, Math.min(total, nm));
  let i = 1;
  while (i < marks.length - 1 && marks[i] < want) i += 1;
  const legNm = marks[i] - marks[i - 1];
  const t = legNm < 1e-6 ? 0 : (want - marks[i - 1]) / legNm;
  const here = interpolate(points[i - 1], points[i], t);
  return { ...here, course: bearing(points[i - 1], points[i]) };
}

/**
 * How far along the line a loose point sits.
 *
 * A recorded scan is a real position and will not be exactly on the lane, so it
 * is matched to the nearest vertex rather than projected onto a segment: at
 * this scale the difference is a few miles and the extra maths would be
 * precision the rest of the estimate does not have.
 */
function alongAt(points, marks, target) {
  let best = 0;
  let bestNm = Infinity;
  points.forEach((p, i) => {
    const nm = distanceNm(p, target);
    if (nm < bestNm) {
      bestNm = nm;
      best = marks[i];
    }
  });
  return best;
}

module.exports = { position, SPEEDS };
