'use strict';

/**
 * Where the fleet is, right now.
 *
 * Positions are not stored. Each vessel has a voyage — a departure, an ETA and
 * a list of ports it routes through — and a position is worked out from how
 * much of that voyage has elapsed at the moment of asking. So the map moves on
 * its own, every reload is different, and there is no clock to keep in sync.
 *
 * Legs are interpolated along a great circle rather than a straight line on the
 * plate, because a straight line between Shanghai and Rotterdam runs over
 * Siberia and looks wrong to anyone who has seen a chart.
 *
 * ---------------------------------------------------------------------------
 * Plugging in a real AIS feed
 * ---------------------------------------------------------------------------
 * This module is the seam. `readFleet()` is the only place vessel data is
 * sourced; replace its body with a call to your AIS provider (MarineTraffic,
 * Spire, VesselFinder, an inbound webhook you store yourself) and return the
 * same shape — `{ vessels: [...], ports: {...} }` with the fields
 * `positionOf()` reads. Everything downstream, including the map, is unchanged.
 * Nothing here calls out to the network, so the site has no key to hold and no
 * upstream to be down.
 */

const data = require('../data/fleet.json');

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const EARTH_KM = 6371;
const KM_PER_NM = 1.852;

/** Vessel classes, and how the map colours them. */
const TYPES = {
  container: { label: 'Container', tone: 'container' },
  bulk: { label: 'Bulk carrier', tone: 'bulk' },
  tanker: { label: 'Tanker', tone: 'tanker' },
  reefer: { label: 'Reefer', tone: 'reefer' },
  roro: { label: 'Ro-Ro', tone: 'roro' },
  general: { label: 'General cargo', tone: 'general' },
};

/**
 * Where a vessel is in its voyage cycle, from the wall clock alone.
 *
 * A voyage takes exactly as long as its route and its speed say it does, which
 * is the point: the marker then travels at the speed the panel reports, and an
 * hour of watching moves it by that many miles. The turnaround alongside is
 * added on, and the whole cycle repeats — so, unlike a fixture with fixed dates
 * in it, the fleet is still sailing next year. The per-vessel `phase` offsets
 * each one into a different part of the cycle, so they are never all at sea at
 * once and never all in port.
 *
 * @param {number} routeNm the whole voyage, in nautical miles
 * @returns {{progress: number, inPort: boolean, departedAt: Date, eta: Date}}
 */
function voyageClock(vessel, routeNm, speedKn, now = Date.now()) {
  const day = 86400000;
  const seaMs = Math.max(day * 0.25, (routeNm / Math.max(1, speedKn)) * 3600000);
  const portMs = Math.max(0, Number(vessel.turnaroundDays) || 0) * day;
  const cycleMs = seaMs + portMs;

  const phase = ((Number(vessel.phase) || 0) % 1 + 1) % 1;
  const t = (now / cycleMs + phase) % 1;
  const seaShare = seaMs / cycleMs;

  const inPort = t >= seaShare;
  const progress = inPort ? 1 : t / seaShare;

  // Anchored to the real clock, so the times shown are the times a customer
  // would be quoted: sailed this many days ago, due on this date.
  const departedAt = new Date(now - progress * seaMs - (inPort ? (t - seaShare) * cycleMs : 0));
  const eta = new Date(departedAt.getTime() + seaMs);

  return { progress, inPort, departedAt, eta };
}

/* ------------------------------------------------------------ geometry --- */

/** Great-circle distance in nautical miles. */
function distanceNm(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return ((2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))) / KM_PER_NM);
}

/**
 * A point `t` of the way from `a` to `b` along the great circle between them.
 * Spherical linear interpolation: the two points become vectors, the vectors
 * are rotated into each other, and the result comes back as a lat/long.
 */
function interpolate(a, b, t) {
  const φ1 = a.lat * RAD;
  const λ1 = a.lng * RAD;
  const φ2 = b.lat * RAD;
  const λ2 = b.lng * RAD;

  const dLat = φ2 - φ1;
  const dLng = λ2 - λ1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLng / 2) ** 2;
  const δ = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  if (δ === 0) return { lat: a.lat, lng: a.lng };

  const A = Math.sin((1 - t) * δ) / Math.sin(δ);
  const B = Math.sin(t * δ) / Math.sin(δ);

  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);

  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG,
    lng: Math.atan2(y, x) * DEG,
  };
}

/** Initial bearing from one point to another, in degrees true. */
function bearing(a, b) {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lng - a.lng) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** Degrees as a chart would print them: 51°57.0'N. */
function formatLatitude(lat) {
  const hemisphere = lat >= 0 ? 'N' : 'S';
  const abs = Math.abs(lat);
  const degrees = Math.floor(abs);
  return `${degrees}°${((abs - degrees) * 60).toFixed(1)}'${hemisphere}`;
}

function formatLongitude(lng) {
  const hemisphere = lng >= 0 ? 'E' : 'W';
  const abs = Math.abs(lng);
  const degrees = Math.floor(abs);
  return `${degrees}°${((abs - degrees) * 60).toFixed(1)}'${hemisphere}`;
}

/** 041° becomes NE, which is what a person reads off a card. */
function compassPoint(deg) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(deg / 22.5) % 16];
}

/* -------------------------------------------------------------- voyage --- */

/**
 * The track a vessel follows, as points.
 *
 * Ports and sea waypoints are resolved from the same list of codes, and each
 * point knows which it is: the map labels the ports it calls at and leaves the
 * turning points in the middle of an ocean unlabelled.
 */
function waypoints(vessel, ports, seaway = {}) {
  const codes = vessel.route && vessel.route.length ? vessel.route : [vessel.from, vessel.to];
  return codes
    .map((code) => {
      if (ports[code]) return { code, kind: 'port', ...ports[code] };
      if (seaway[code]) return { code, kind: 'waypoint', ...seaway[code] };
      return null;
    })
    .filter(Boolean);
}

/**
 * Where a vessel is, and everything a bridge would report with it.
 *
 * Progress is measured in distance rather than in legs: a voyage whose first
 * leg is three times the second should be a third of the way along at a third
 * of the distance, not at the halfway point of leg one.
 */
function positionOf(vessel, ports, now = Date.now(), seaway = {}) {
  const route = waypoints(vessel, ports, seaway);

  const legs = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    const nm = distanceNm(route[i], route[i + 1]);
    legs.push({ from: route[i], to: route[i + 1], nm, start: total });
    total += nm;
  }

  // One speed for the whole voyage and for the readout, so they cannot
  // disagree. The offset is steady per vessel rather than jittering on every
  // request — a speed that changes each time you look is a bug, not a sea state.
  const drift = ((Number(vessel.imo) % 17) - 8) / 10;
  const cruising = Math.max(6, vessel.serviceSpeed + drift);
  const { progress, inPort, departedAt, eta } = voyageClock(vessel, total, cruising, now);

  const travelled = total * progress;
  const leg = legs.find((l) => travelled <= l.start + l.nm) || legs[legs.length - 1];
  const along = leg.nm > 0 ? Math.max(0, Math.min(1, (travelled - leg.start) / leg.nm)) : 1;

  const here = interpolate(leg.from, leg.to, along);
  const course = bearing(here, leg.to);

  // The next *port*, not the next turning point: "next: Mid-Atlantic" is a
  // waypoint in the middle of an ocean and means nothing to a customer.
  const legIndex = legs.indexOf(leg);
  const ahead = route.slice(legIndex + 1);
  const nextCall = ahead.find((p) => p.kind === 'port') || route[route.length - 1];

  const speed = inPort ? 0 : cruising;

  return {
    lat: Number(here.lat.toFixed(4)),
    lng: Number(here.lng.toFixed(4)),
    latitude: formatLatitude(here.lat),
    longitude: formatLongitude(here.lng),
    course: inPort ? 0 : Math.round(course),
    compass: inPort ? '—' : compassPoint(course),
    speed: Number(speed.toFixed(1)),
    progress: Number(progress.toFixed(4)),
    status: inPort ? 'In port, discharging' : 'Under way using engine',
    inPort,
    nextPort: inPort ? route[route.length - 1] : nextCall,
    destination: route[route.length - 1],
    // Where it is on the water, for the panel: the leg it is sailing.
    leg: { from: leg.from.name, to: leg.to.name },
    distanceToGoNm: Math.round(total - travelled),
    distanceRunNm: Math.round(travelled),
    routeNm: Math.round(total),
    departedAt: departedAt.toISOString(),
    eta: eta.toISOString(),
    // The whole route, so the map can draw the line the vessel is following.
    track: route.map((p) => ({ code: p.code, name: p.name, lat: p.lat, lng: p.lng, kind: p.kind })),
    calls: (vessel.calls || []).map((code) => ports[code]).filter(Boolean)
      .map((p) => ({ name: p.name, country: p.country })),
  };
}

/* --------------------------------------------------------------- fleet --- */

/**
 * The source of vessel data. Swap this one function for a live AIS feed.
 * @returns {{vessels: Array, ports: Object}}
 */
function readFleet() {
  return { vessels: data.vessels, ports: data.ports, waypoints: data.waypoints };
}

/** Every vessel with its position resolved, ready to draw. */
function snapshot(now = Date.now()) {
  const { vessels, ports, waypoints: seaway } = readFleet();

  const list = vessels.map((vessel) => {
    const type = TYPES[vessel.type] || TYPES.general;
    const position = positionOf(vessel, ports, now, seaway);
    return {
      id: vessel.id,
      name: vessel.name,
      type: vessel.type,
      typeLabel: type.label,
      tone: type.tone,
      imo: vessel.imo,
      mmsi: vessel.mmsi,
      callsign: vessel.callsign,
      flag: vessel.flag,
      flagCode: vessel.flagCode,
      built: vessel.built,
      class: vessel.class,
      capacityTeu: vessel.capacityTeu || null,
      dwt: vessel.dwt,
      loa: vessel.loa,
      beam: vessel.beam,
      draught: vessel.draught,
      serviceSpeed: vessel.serviceSpeed,
      voyage: vessel.voyage,
      cargo: vessel.cargo,
      master: vessel.master,
      ...position,
    };
  });

  return {
    generatedAt: new Date(now).toISOString(),
    types: Object.entries(TYPES).map(([id, t]) => ({ id, label: t.label, tone: t.tone })),
    ports,
    count: list.length,
    underway: list.filter((v) => !v.inPort).length,
    vessels: list,
  };
}

module.exports = {
  TYPES,
  snapshot,
  readFleet,
  positionOf,
  distanceNm,
  interpolate,
  bearing,
  formatLatitude,
  formatLongitude,
  compassPoint,
  voyageClock,
};
