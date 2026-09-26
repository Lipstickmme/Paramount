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
 * This lists the routes Express actually has, turns api/ and the rewrites in
 * vercel.json into the patterns Vercel routes by, and fails when a route
 * reaches no function. It also refuses what Vercel rejects at deploy time
 * rather than at build time, where it is easy to miss:
 *
 *   - more than twelve functions, the Hobby plan's limit per deployment. The
 *     first fix for the deep routes added a file per depth, seventeen in all;
 *     the build log looked healthy and the deploy never went live;
 *   - two files that differ only in a bracketed name, such as [id].js beside
 *     [...rest].js.
 *
 * Run: node scripts/check-vercel-routes.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'api');
/** Serverless functions per deployment on Vercel's Hobby plan. */
const FUNCTION_LIMIT = 12;

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

/** Function files: Vercel skips anything whose name starts with _ or a dot. */
function files(dir, rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (/^[_.]/.test(entry.name)) return [];
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return files(path.join(dir, entry.name), next);
    return /\.(js|cjs|mjs|ts)$/.test(entry.name) ? [next] : [];
  });
}

/**
 * A vercel.json source pattern as a RegExp. Covers the forms this project
 * uses: `:name`, `:name*`, `:name+` and a literal `(.*)`.
 */
function sourcePattern(source) {
  const out = String(source)
    .split('/')
    .map((part) => {
      if (/^:\w+\*$/.test(part)) return '(?:.*)';
      if (/^:\w+\+$/.test(part)) return '(?:.+)';
      if (/^:\w+$/.test(part)) return '[^/]+';
      if (part === '(.*)') return '.*';
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/')
    // "/api/:path*" also matches "/api" itself, as path-to-regexp does.
    .replace(/\/\(\?:\.\*\)$/, '(?:/.*)?');
  return new RegExp(`^${out}$`);
}

function rewrites() {
  const file = path.join(root, 'vercel.json');
  if (!fs.existsSync(file)) return [];
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (config.rewrites || []).map((r) => ({ source: r.source, re: sourcePattern(r.source), destination: r.destination }));
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

/**
 * Which function answers a path, as Vercel decides it: a function file whose
 * pattern matches wins outright; otherwise the first rewrite whose source
 * matches sends it to its destination, and that has to be a function.
 */
function resolve(sample, patterns, rules) {
  const direct = patterns.find(({ re }) => re.test(sample));
  if (direct) return direct.file;
  const rule = rules.find(({ re }) => re.test(sample));
  if (!rule) return null;
  const target = patterns.find(({ re }) => re.test(rule.destination.split('?')[0]));
  return target ? target.file : null;
}

function check() {
  const app = require(path.join(root, 'src/api-app'));
  const table = routes(app._router.stack, '', []);
  const list = files(apiDir);
  const patterns = list.map((file) => ({ file, re: pattern(file) }));
  const rules = rewrites();

  const problems = conflicts(list);
  if (list.length > FUNCTION_LIMIT) {
    problems.push(
      `api/ holds ${list.length} functions; Vercel's Hobby plan deploys at most ${FUNCTION_LIMIT}. ` +
        'Route more paths through a rewrite in vercel.json instead of adding files.'
    );
  }
  const seen = new Set();
  table.forEach(({ method, path: route }) => {
    if (!route.startsWith('/api')) return;
    const sample = route.replace(/:[A-Za-z_]\w*/g, 'sample');
    const key = `${method} ${route}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!resolve(sample, patterns, rules)) {
      problems.push(`${key} reaches no function: no file under api/ matches it, and no rewrite sends it to one`);
    }
  });
  return { routes: seen.size, files: list.length, problems };
}

if (require.main === module) {
  const { routes: count, files: fileCount, problems } = check();
  if (problems.length) {
    console.error('Vercel route check failed:');
    problems.forEach((line) => console.error(`  - ${line}`));
    console.error('\nEvery /api path should reach api/index.js through the rewrite in vercel.json (see api/index.js).');
    process.exit(1);
  }
  console.log(`Vercel route check: all ${count} API routes reach a function; ${fileCount} of ${FUNCTION_LIMIT} functions used.`);
  // The app holds timers (rate limiter sweeps); nothing else is waiting.
  process.exit(0);
}

module.exports = { check, pattern, conflicts, sourcePattern, resolve };
