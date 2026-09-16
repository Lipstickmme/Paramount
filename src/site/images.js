'use strict';

/**
 * Resolves the page-level image slots at build time.
 *
 * Every slot names the files it would rather have and the placeholder it uses
 * until one of them exists, so adding real photography is a file drop rather
 * than a code change: put the named file into public/assets/img/ in any common
 * format and the next build picks it up. src/data/images.json lists the names.
 */

const fs = require('fs');
const path = require('path');

const data = require('../data/images.json');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
// Preference order, best format first. WebP wins, so a converted copy is used
// in place of a heavy original without anyone having to delete the original.
const EXTENSIONS = ['.webp', '.avif', '.jpg', '.jpeg', '.png', '.svg'];
// /assets/photo/ first: the derived, web-sized crops beat a loose original.
const DIRS = ['/assets/photo/', '/assets/img/', '/assets/slides/'];

const found = [];

/**
 * Every candidate file, indexed by lower-cased name.
 *
 * Case-insensitive on purpose: an upload named Hero-1.PNG has to be found on
 * Linux, where the deploy runs, not only on the machine it was named on.
 */
const index = new Map();
DIRS.forEach((dir) => {
  const abs = path.join(PUBLIC_DIR, dir);
  let entries = [];
  try {
    entries = fs.readdirSync(abs);
  } catch (err) {
    return;
  }
  entries.forEach((file) => {
    const key = `${dir}${file.toLowerCase()}`;
    if (!index.has(key)) index.set(key, `${dir}${file}`);
  });
});

/** The first file that actually exists for any of these base names. */
function lookUp(names) {
  for (const name of names || []) {
    for (const dir of DIRS) {
      for (const ext of EXTENSIONS) {
        const hit = index.get(`${dir}${name}${ext}`.toLowerCase());
        if (hit) return hit;
      }
    }
  }
  return null;
}

function resolve(spec) {
  if (typeof spec === 'string') return spec;
  const hit = lookUp(spec.prefer);
  if (hit) found.push(hit);
  return hit || spec.fallback;
}

const images = {};
Object.entries(data.slots).forEach(([slot, spec]) => {
  images[slot] = resolve(spec);
});

/** One slim banner per page, so no two pages open on the same photograph. */
images.banners = {};
Object.entries(data.banners || {}).forEach(([slot, spec]) => {
  images.banners[slot] = resolve(spec);
});

/** The banner for a page, falling back to the landing page's. */
images.forBanner = (slot) => images.banners[slot] || images.banners.home;

/** One per service id, so a service card can carry its own artwork. */
images.services = {};
Object.entries(data.serviceSlots || {}).forEach(([id, spec]) => {
  images.services[id] = resolve(spec);
});

/** The artwork for a service, falling back to the generic freight placeholder. */
images.forService = (id) => images.services[id] || images.network;

/** What the build should report: which real images were picked up, if any. */
images._resolved = found;

module.exports = images;
