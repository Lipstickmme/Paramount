'use strict';

/**
 * Minimal Supabase (PostgREST) client over fetch. No SDK dependency.
 *
 * Server-side only: it uses the service-role key, which bypasses row level
 * security and must never reach the browser. Returns null when Supabase is
 * not configured so callers fall back to another storage backend.
 *
 * Accepts VITE_SUPABASE_URL as well, so a project set up for a Vite frontend
 * can reuse the same value.
 */

const config = require('./config');

let client;
let resolved = false;

function getSupabase() {
  if (resolved) return client;
  resolved = true;

  const rawUrl = config.supabaseUrl();
  const key = config.supabaseServiceKey();

  if (!rawUrl || !key) {
    client = null;
    return client;
  }

  const base = `${rawUrl.replace(/\/+$/, '')}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  client = {
    async insert(table, rows) {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
      });
      if (!res.ok) {
        throw new Error(`supabase insert ${table} failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      return true;
    },

    /**
     * Insert, tolerating a row that is already there.
     *
     * PostgREST maps `resolution=ignore-duplicates` to ON CONFLICT DO NOTHING
     * against the primary key, so this is how a caller that already knows the
     * id can make sure a parent row exists before writing children to it.
     */
    async upsert(table, rows) {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
      });
      if (!res.ok) {
        throw new Error(`supabase upsert ${table} failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      return true;
    },

    /** Insert and return the created rows (needed when we want the new id). */
    async insertReturning(table, rows) {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
      });
      if (!res.ok) {
        throw new Error(`supabase insert ${table} failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      return res.json();
    },

    async select(table, query = '') {
      const res = await fetch(`${base}/${table}${query ? `?${query}` : ''}`, { headers });
      if (!res.ok) {
        throw new Error(`supabase select ${table} failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      return res.json();
    },
  };

  console.log('[merkel] storage: Supabase');
  return client;
}

module.exports = { getSupabase };
