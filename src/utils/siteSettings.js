'use strict';

/**
 * How the business is configured: the public contact details, the addresses
 * notifications go to, and how the chat widget behaves.
 *
 * Pages are built with the values in src/data/site.json, so the static HTML is
 * correct on its own. The desk can then change any of them; the change is
 * stored in `site_settings` and picked up on the next page load or the next
 * notification, with no rebuild and no deploy.
 *
 * Email fields shadow the environment rather than replacing it: a blank in the
 * database means "use FORM_TO / FORM_FROM / MAILBOX_ADDRESS". So a deployment
 * works before anyone opens the settings tab, and a value set at the desk wins
 * once it is there.
 *
 * A database that has not run 0004_settings.sql simply has fewer columns and
 * the defaults stand.
 */

const defaults = require('../data/site.json');
const config = require('./config');
const { getSupabase } = require('./supabase');

const TABLE = 'site_settings';
const ROW_ID = 'default';

/** Public details, printed on the pages. */
const PUBLIC_FIELDS = [
  'company_name', 'tagline', 'address', 'email', 'phone',
  'support_phone', 'emergency_phone', 'whatsapp', 'hours',
];

/** Delivery settings. Never sent to the browser except to the desk itself. */
const EMAIL_FIELDS = [
  'notify_email', 'from_email', 'reply_to', 'email_signature',
];

const EMAIL_FLAGS = [
  'auto_reply', 'notify_on_shipment_update', 'notify_on_shipment_created',
];

const CHAT_FIELDS = ['chat_greeting', 'chat_agent_name', 'chat_away_message'];
const CHAT_FLAGS = ['chat_enabled', 'chat_notify'];

const FIELDS = [...PUBLIC_FIELDS, ...EMAIL_FIELDS, ...CHAT_FIELDS];
const FLAGS = [...EMAIL_FLAGS, ...CHAT_FLAGS];

/** Flags that stay on unless the desk deliberately turns them off. */
const FLAG_DEFAULTS = {
  auto_reply: true,
  notify_on_shipment_update: true,
  notify_on_shipment_created: true,
  chat_enabled: true,
  chat_notify: String(process.env.CHAT_NOTIFY || 'on').toLowerCase() !== 'off',
};

// Settings are read on nearly every request. One short-lived cache keeps that
// from becoming a database round trip per page view, while still letting an
// edit at the desk reach the site within a few seconds.
const TTL_MS = 15000;
let cache = null;
let cachedAt = 0;

/**
 * Only the fields we own, trimmed.
 *
 * A blank stays blank rather than falling back, because most of these are
 * optional: the site prints them once they are set at the desk and leaves the
 * row out entirely until then.
 */
function normalise(values) {
  const out = {};
  FIELDS.forEach((key) => {
    const supplied = values && values[key] != null ? String(values[key]).trim() : '';
    out[key] = supplied || defaults[key] || '';
  });
  FLAGS.forEach((key) => {
    const supplied = values && values[key];
    out[key] = supplied == null ? FLAG_DEFAULTS[key] : Boolean(supplied);
  });
  return out;
}

async function read({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < TTL_MS) return cache;

  const supabase = getSupabase();
  let settings;

  if (!supabase) {
    settings = { ...normalise(defaults), source: 'defaults' };
  } else {
    try {
      const rows = await supabase.select(TABLE, `select=*&id=eq.${ROW_ID}&limit=1`);
      settings = rows.length
        ? { ...normalise(rows[0]), source: 'database' }
        : { ...normalise(defaults), source: 'defaults' };
    } catch (err) {
      // The table arrives with 0001_init.sql and widens with 0004_settings.sql.
      // Without either, the site still has every detail it needs.
      settings = { ...normalise(defaults), source: 'defaults' };
    }
  }

  cache = settings;
  cachedAt = Date.now();
  return settings;
}

/** Drop the cache after a write at the desk, so the change is live at once. */
function invalidate() {
  cache = null;
  cachedAt = 0;
}

/**
 * Just the details that belong on a public page.
 *
 * `source` comes along because it answers the question people actually have at
 * /api/site: are these the values the desk set, or the ones the site was built
 * with? It names where they came from, never what they are.
 */
function publicView(settings) {
  const out = {};
  PUBLIC_FIELDS.forEach((key) => {
    out[key] = settings[key] || '';
  });
  out.chat_enabled = settings.chat_enabled;
  out.chat_greeting = settings.chat_greeting || '';
  out.chat_agent_name = settings.chat_agent_name || settings.company_name || '';
  out.source = settings.source || 'defaults';
  return out;
}

/**
 * The addresses a notification should actually use, database first and the
 * environment behind it.
 */
async function mail() {
  const settings = await read();
  return {
    to: settings.notify_email || config.formTo(),
    from: settings.from_email || config.formFrom(),
    replyTo: settings.reply_to || '',
    signature: settings.email_signature || '',
    autoReply: settings.auto_reply,
    onShipmentCreated: settings.notify_on_shipment_created,
    onShipmentUpdate: settings.notify_on_shipment_update,
  };
}

module.exports = {
  read,
  mail,
  invalidate,
  normalise,
  publicView,
  defaults,
  FIELDS,
  FLAGS,
  PUBLIC_FIELDS,
  EMAIL_FIELDS,
  EMAIL_FLAGS,
  CHAT_FIELDS,
  CHAT_FLAGS,
  FLAG_DEFAULTS,
  TABLE,
  ROW_ID,
};
