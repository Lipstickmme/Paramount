'use strict';

/**
 * Prove every API route is reachable on Vercel.
 *
 * Locally one Express app answers every /api path. On Vercel a request first
 * has to match a file under api/, and the filesystem router compiles each
 * bracketed segment of a file name to exactly one path segment — `[...name]`
 * included. A route deeper than any file reaches is a 404 from the edge that
 * Express never sees, and every test still passes, because the tests talk to
 * Express directly. Holding a consignment, recording a movement and opening
 * one in the portal all shipped broken that way.
 *
 * This lists the routes Express actually has, turns api/ into the patterns
 * Vercel builds from it, and fails when a route matches none of them. It also
 * refuses the file layouts Vercel's own detector rejects at deploy time: two
 * files that differ only in a bracketed name, such as [id].js beside
 * [...rest].js.
 *
 * Run: node scripts/check-vercel-routes.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'api');

/* ------------------------------------------------ what Express answers --- */

/** The static prefix a router was mounted at, read back from its pattern. */
function mountPath(layer) {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const source = layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/');
  if (/[()[\]*+?|$^\\]/.test(source)) {
    throw new Error(`Cannot read the mount path of /${layer.regexp.source}/; mount routers on plain strings.`);
  }
  return source;
}

function routes(stack, prefix, out) {
  stack.forEach((layer) => {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      paths.forEach((p) => {
        if (typeof p !== 'string') throw new Error(`Route under ${prefix} uses a pattern, not a string path.`);
        Object.keys(layer.route.methods).forEach((method) => {
          out.push({ method: method.toUpperCase(), path: (prefix + p).replace(/\/+$/, '') || '/' });
        });
      });
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      routes(layer.handle.stack, prefix + mountPath(layer), out);
    }
  });
  return out;
}

/* --------------------------------------------- what Vercel routes to --- */

function files(dir, rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return files(path.join(dir, entry.name), next);
    return /\.(js|cjs|mjs|ts)$/.test(entry.name) ? [next] : [];
  });
}

/** The pattern Vercel's filesystem API builds from one file under api/. */
function pattern(file) {
  const parts = `api/${file}`.replace(/\.(js|cjs|mjs|ts)$/, '').split('/');
  if (parts[parts.length - 1] === 'index') parts.pop();
  const source = parts
    .map((part) => (/^\[[^\]]+\]$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^/${source}$`);
}

/** Vercel's conflicting_file_path check: bracketed names do not count. */
function conflicts(list) {
  const seen = new Map();
  const found = [];
  list.forEach((file) => {
    const shape = file.replace(/\.(js|cjs|mjs|ts)$/, '').replace(/\/index$/, '').replace(/\[[^\]]*\]/g, '1');
    if (seen.has(shape)) found.push(`api/${seen.get(shape)} and api/${file} resolve to the same path`);
    else seen.set(shape, file);
  });
  return found;
}

/* ---------------------------------------------------------------- run --- */

function check() {
  const app = require(path.join(root, 'src/api-app'));
  const table = routes(app._router.stack, '', []);
  const list = files(apiDir);
  const patterns = list.map((file) => ({ file, re: pattern(file) }));

  const problems = conflicts(list);
  const seen = new Set();
  table.forEach(({ method, path: route }) => {
    if (!route.startsWith('/api')) return;
    const sample = route.replace(/:[A-Za-z_]\w*/g, 'sample');
    const key = `${method} ${route}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!patterns.some(({ re }) => re.test(sample))) {
      problems.push(`${key} has no file under api/ that Vercel would route it to`);
    }
  });
  return { routes: seen.size, files: list.length, problems };
}

if (require.main === module) {
  const { routes: count, files: fileCount, problems } = check();
  if (problems.length) {
    console.error('Vercel route check failed:');
    problems.forEach((line) => console.error(`  - ${line}`));
    console.error('\nAdd a file under api/ at that depth that re-exports src/api-app (see api/inbound/resend.js).');
    process.exit(1);
  }
  console.log(`Vercel route check: all ${count} API routes reach one of ${fileCount} function files.`);
  // The app holds timers (rate limiter sweeps); nothing else is waiting.
  process.exit(0);
}

module.exports = { check, pattern, conflicts };
