'use strict';

/**
 * The studio's contact details.
 *
 * Pages are built with the values in src/data/site.json, so the static HTML is
 * always correct on its own. The studio desk can then change them, and the
 * change is stored in `site_settings` and picked up by every page on its next
 * load, with no rebuild and no deploy.
 *
 * A database that has not run the migration simply has no row, and the
 * defaults stand.
 */

const defaults = require('../data/site.json');
const { getSupabase } = require('./supabase');

const TABLE = 'site_settings';
const ROW_ID = 'default';
const FIELDS = ['address', 'email', 'phone', 'hours'];

/**
 * Only the fields we own, trimmed.
 *
 * A blank stays blank rather than falling back, because the address and the
 * telephone are optional: the site shows them once they are set at the desk
 * and leaves the row out entirely until then.
 */
function normalise(values) {
  const out = {};
  FIELDS.forEach((key) => {
    const supplied = values && values[key] != null ? String(values[key]).trim() : '';
    out[key] = supplied || defaults[key] || '';
  });
  return out;
}

async function read() {
  const supabase = getSupabase();
  if (!supabase) return { ...normalise(defaults), source: 'defaults' };

  try {
    const rows = await supabase.select(TABLE, `select=*&id=eq.${ROW_ID}&limit=1`);
    if (!rows.length) return { ...normalise(defaults), source: 'defaults' };
    return { ...normalise(rows[0]), source: 'database' };
  } catch (err) {
    // The table arrives with 0001_init.sql. Without it the site still has
    // every detail it needs; it just cannot be edited from the desk.
    return { ...normalise(defaults), source: 'defaults' };
  }
}

module.exports = { read, normalise, defaults, FIELDS, TABLE, ROW_ID };
