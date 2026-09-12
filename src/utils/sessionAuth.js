'use strict';

/**
 * Who is making this request?
 *
 * Most of the site decides that in Postgres: the browser talks to PostgREST
 * under the caller's own session and row level security answers the question.
 * Three things cannot work that way — sending mail needs the Resend key,
 * booking a consignment needs to mint a tracking number, and the portal needs
 * to find consignments by email address across a table the customer may not
 * read — so those routes re-establish server side what the policies would have
 * enforced. This module is that check, in one place.
 *
 * Supabase itself validates the token's signature and expiry; re-implementing
 * that here would be a second thing to keep correct as keys rotate.
 */

const config = require('./config');
const { getSupabase } = require('./supabase');

function bearerToken(headers) {
  const raw = (headers && (headers.authorization || headers.Authorization)) || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : '';
}

/**
 * The user behind a request's bearer token.
 *
 * @returns {Promise<{ok: true, user: object}|{ok: false, status: number, reason: string}>}
 */
async function resolveUser(req) {
  const token = bearerToken(req.headers);
  if (!token) return { ok: false, status: 401, reason: 'missing_token' };

  const url = config.supabaseUrl();
  const anonKey = config.supabaseAnonKey();
  if (!url || !anonKey || !getSupabase()) {
    return { ok: false, status: 503, reason: 'supabase_not_configured' };
  }

  let user;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, status: 401, reason: 'invalid_token' };
    user = await res.json();
  } catch (err) {
    console.warn('[paramount] auth service unreachable:', err.message);
    return { ok: false, status: 503, reason: 'auth_unreachable' };
  }

  // Anonymous sessions are real sessions: the chat widget signs visitors in
  // with one, so a visitor holds a valid token and must not pass as a person.
  if (!user || !user.id || user.is_anonymous) {
    return { ok: false, status: 401, reason: 'invalid_token' };
  }

  return { ok: true, user };
}

/** True once the account's address has been proved to belong to whoever holds it. */
const isEmailConfirmed = (user) =>
  Boolean(user && (user.email_confirmed_at || user.confirmed_at));

/** Confirms the caller is on the `admins` table. */
async function requireAdmin(req) {
  const session = await resolveUser(req);
  if (!session.ok) return session;

  const rows = await getSupabase().select(
    'admins',
    `select=user_id&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`
  );
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, status: 403, reason: 'not_an_admin' };
  }

  return { ok: true, user: session.user };
}

/**
 * Confirms the caller is a signed-in person, staff or customer.
 *
 * Whether their address is confirmed is reported rather than enforced, because
 * it decides only one thing: whether consignments may be matched to them by
 * email. Claiming by tracking number is safe either way, so an unconfirmed
 * account still gets a working portal.
 */
async function requireCustomer(req) {
  const session = await resolveUser(req);
  if (!session.ok) return session;

  const email = String(session.user.email || '').trim().toLowerCase();
  if (!email) return { ok: false, status: 403, reason: 'no_email' };

  return {
    ok: true,
    user: session.user,
    email,
    emailConfirmed: isEmailConfirmed(session.user),
  };
}

module.exports = { bearerToken, resolveUser, requireAdmin, requireCustomer, isEmailConfirmed };
