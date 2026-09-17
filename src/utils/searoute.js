'use strict';

/**
 * A sea route between two places, rather than a line through the middle of Asia.
 *
 * The great circle from Shanghai to Rotterdam crosses Siberia. Drawn on a chart
 * it puts a container ship in a forest, which is the kind of detail that tells a
 * customer the rest of the page is decoration too.
 *
 * The fleet already sails a real lane network — 20 ports and 60 named waypoints
 * in src/data/fleet.json, strung together by each vessel's route — so this turns
 * that into a graph and finds the shortest way through it. Consignments then
 * follow the same water the ships do: Suez, Malacca, Panama, the Cape.
 *
 * It is a coarse network on purpose. The point is a route that is recognisably
 * right, not a passage plan; the alternative is a straight line that is
 * recognisably wrong.
 */

const fleet = require('../data/fleet.json');
const { distanceNm } = require('./fleet');

/* --------------------------------------------------------------- graph --- */

const nodes = new Map();
Object.entries(fleet.ports).forEach(([code, p]) => nodes.set(code, { code, lat: p.lat, lng: p.lng, name: p.name }));
Object.entries(fleet.waypoints).forEach(([code, p]) => {
  if (!nodes.has(code)) nodes.set(code, { code, lat: p.lat, lng: p.lng, name: p.name });
});

/** Undirected, weighted by great-circle distance: ships sail both ways. */
const edges = new Map();
const link = (a, b) => {
  if (a === b || !nodes.has(a) || !nodes.has(b)) return;
  const nm = distanceNm(nodes.get(a), nodes.get(b));
  if (!edges.has(a)) edges.set(a, new Map());
  if (!edges.has(b)) edges.set(b, new Map());
  edges.get(a).set(b, nm);
  edges.get(b).set(a, nm);
};

fleet.vessels.forEach((vessel) => {
  const route = vessel.route || [];
  for (let i = 1; i < route.length; i += 1) link(route[i - 1], route[i]);
  // Deliberately no edge closing the loop back to the first call. A service
  // that ends at Rotterdam and starts at Shanghai sails home the way it came;
  // joining the two ends directly would put a 4,900 nm edge across Siberia
  // into the graph, and every Asia-Europe route would then take it.
});

/* ------------------------------------------------------------ shortest --- */

/** Dijkstra. The graph is 80 nodes, so a plain scan for the next one is fine. */
function shortest(from, to) {
  if (from === to) return [from];
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();

  for (;;) {
    let here = null;
    let best = Infinity;
    dist.forEach((d, code) => {
      if (!done.has(code) && d < best) {
        best = d;
        here = code;
      }
    });
    if (here == null) return null;       // unreachable
    if (here === to) break;
    done.add(here);

    (edges.get(here) || new Map()).forEach((nm, next) => {
      if (done.has(next)) return;
      const through = best + nm;
      if (through < (dist.has(next) ? dist.get(next) : Infinity)) {
        dist.set(next, through);
        prev.set(next, here);
      }
    });
  }

  const path = [to];
  while (prev.has(path[0])) path.unshift(prev.get(path[0]));
  return path;
}

/** The lane node closest to a point, and how far off the network it is. */
function nearest(point) {
  let best = null;
  let bestNm = Infinity;
  nodes.forEach((node) => {
    const nm = distanceNm(point, node);
    if (nm < bestNm) {
      bestNm = nm;
      best = node;
    }
  });
  return { node: best, nm: bestNm };
}

/**
 * The polyline a consignment follows, as { lat, lng } points.
 *
 * Falls back to the direct line when the lane network has nothing useful to
 * add: a short hop, or one end so far from any lane that routing through it
 * would be a longer lie than the straight line.
 */
const DIRECT_NM = 400;       // below this the network is noise
const OFF_NETWORK_NM = 1500; // further than this from a lane, and it is a guess

function route(origin, destination) {
  const direct = [origin, destination];
  if (!origin || !destination) return direct;
  if (distanceNm(origin, destination) < DIRECT_NM) return direct;

  const a = nearest(origin);
  const b = nearest(destination);
  if (!a.node || !b.node) return direct;
  if (a.nm > OFF_NETWORK_NM || b.nm > OFF_NETWORK_NM) return direct;
  if (a.node.code === b.node.code) return direct;

  const path = shortest(a.node.code, b.node.code);
  if (!path) return direct;

  const via = path.map((code) => {
    const node = nodes.get(code);
    return { lat: node.lat, lng: node.lng, name: node.name, code };
  });

  // Trim a lane node the route starts or ends practically on top of, so the
  // line does not double back on itself leaving the quay.
  if (via.length && distanceNm(origin, via[0]) < 40) via.shift();
  if (via.length && distanceNm(destination, via[via.length - 1]) < 40) via.pop();

  return [origin, ...via, destination];
}

/** Total length of a polyline, in nautical miles. */
function length(points) {
  let nm = 0;
  for (let i = 1; i < points.length; i += 1) nm += distanceNm(points[i - 1], points[i]);
  return nm;
}

module.exports = { route, length, nearest, nodes };
