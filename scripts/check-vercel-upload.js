'use strict';

/**
 * Simulate what Vercel uploads and prove the build still works.
 *
 * .vercelignore uses .gitignore matching, where an unanchored pattern such as
 * "data/" matches at ANY depth. That once excluded src/data as well as the
 * root data directory, and the deploy failed on a missing JSON file that was
 * present locally. This reproduces the upload so that can't happen unnoticed.
 *
 * Two things have to survive it:
 *
 *   1. every JSON the server or the build requires, and
 *   2. every asset a built page actually points at.
 *
 * The second matters because assets/img holds both the uploaded originals —
 * which are excluded, being source files with web-sized twins — and the
 * placeholders the pages fall back to. A slot resolving to an original rather
 * than its derivative would look right locally and 404 in production.
 *
 * Run: node scripts/check-vercel-upload.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const ignoreFile = path.join(root, '.vercelignore');

function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** Files .vercelignore would exclude, using git's own matcher. */
function excluded(files) {
  if (!fs.existsSync(ignoreFile)) return new Set();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vercelignore-'));
  execFileSync('git', ['init', '-q', tmp]);
  fs.copyFileSync(ignoreFile, path.join(tmp, '.gitignore'));
  const out = execFileSync('git', ['check-ignore', '--stdin'], {
    cwd: tmp,
    input: files.join('\n'),
    encoding: 'utf8',
    // check-ignore exits 1 when nothing matches
  // eslint-disable-next-line no-empty-function
  }).toString();
  fs.rmSync(tmp, { recursive: true, force: true });
  return new Set(out.split('\n').filter(Boolean));
}

const all = tracked();
let skip;
try {
  skip = excluded(all);
} catch (err) {
  skip = new Set(); // nothing matched
}
const uploaded = all.filter((f) => !skip.has(f));

// Every JSON the server or build requires must survive the upload.
const required = [];
for (const f of all) {
  if (!f.startsWith('src/')) continue;
  if (!/\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const re = /require\(['"](\.[^'"]+\.json)['"]\)/g;
  let m;
  while ((m = re.exec(src))) {
    required.push(path.relative(root, path.resolve(path.dirname(path.join(root, f)), m[1])));
  }
}

const missing = [...new Set(required)].filter((f) => skip.has(f) || !all.includes(f));

// Every /assets/… path the built pages, the stylesheets and the scripts point
// at. Caught from the HTML rather than from the source that generated it, so a
// path assembled at build time is checked as the browser will request it.
const referenced = new Set();
const ASSET_RE = /["'(]\s*(\/assets\/[A-Za-z0-9_./-]+?\.[A-Za-z0-9]{2,5})/g;
for (const f of all) {
  if (!/^public\/.*\.(html|css|js)$/.test(f)) continue;
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  let m;
  while ((m = ASSET_RE.exec(src))) referenced.add('public' + m[1]);
}
const dangling = [...referenced].filter((f) => !uploaded.includes(f)).sort();

console.log(`tracked: ${all.length}  uploaded: ${uploaded.length}  excluded: ${skip.size}`);
console.log(`required JSON referenced by src: ${[...new Set(required)].length}`);
console.log(`assets referenced by built pages: ${referenced.size}`);

if (missing.length) {
  console.error('\nFAIL: .vercelignore excludes files the build requires:');
  missing.forEach((f) => console.error('  ' + f));
  console.error('\nAnchor the pattern with a leading slash so it only matches the repo root.');
  process.exit(1);
}

if (dangling.length) {
  console.error('\nFAIL: built pages point at files the deploy would not carry:');
  dangling.forEach((f) => console.error('  ' + f));
  console.error('\nEither the file is untracked, or .vercelignore excludes it. An upload in');
  console.error('public/assets/img is a source file: run scripts/build-photos.py and let the');
  console.error('page use the derived crop in public/assets/photo.');
  process.exit(1);
}

console.log('OK: every JSON the build requires, and every asset the pages point at, survives .vercelignore');
