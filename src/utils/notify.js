'use strict';

/**
 * Routes enquiries, quote requests, chat messages, shipment movement and
 * inbound mail to the people who need to see them.
 *
 * Channels (independent, each a no-op until configured):
 *   1. Email via Resend  ->  RESEND_API_KEY + a recipient
 *   2. Webhook           ->  NOTIFY_WEBHOOK_URL (Slack, Discord, Zapier, desk)
 *
 * Recipients come from the settings row first and the environment behind it, so
 * the desk can redirect its own mail without a deploy (see siteSettings.mail).
 *
 * Delivery is best effort: failures are logged and never break the request, but
 * they are awaited so a serverless function does not exit mid-send.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const tracking = require('./tracking');

// Required lazily: siteSettings reads Supabase, which requires this module's
// sibling config, and a top-level cycle would leave one of them half-built.
const settings = () => require('./siteSettings');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Default recipient for site notifications, from the environment. */
function defaultTo() {
  return process.env.FORM_TO || process.env.CONTACT_NOTIFY_EMAIL || '';
}

/** Verified sender identity, from the environment. */
function defaultFrom() {
  return process.env.FORM_FROM || process.env.NOTIFY_FROM || 'Paramount Logistics <onboarding@resend.dev>';
}

/** The desk's configured delivery settings, with the environment behind them. */
async function mailSettings() {
  try {
    return await settings().mail();
  } catch (err) {
    return {
      to: defaultTo(),
      from: defaultFrom(),
      replyTo: '',
      signature: '',
      autoReply: true,
      onShipmentCreated: true,
      onShipmentUpdate: true,
    };
  }
}

/**
 * Send an email through Resend, reporting what came back.
 *
 * `headers` carries RFC 5322 headers such as In-Reply-To, which is what makes a
 * reply land inside the recipient's existing conversation rather than opening a
 * fresh one beside it.
 *
 * @param {{to?:string, from?:string, subject:string, text:string, replyTo?:string, headers?:object, html?:false|string}} opts
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
async function send(opts) {
  const apiKey = process.env.RESEND_API_KEY;
  const configured = await mailSettings();
  const to = opts.to || configured.to || defaultTo();
  if (!apiKey) return { ok: false, error: 'no_api_key' };
  if (!to) return { ok: false, error: 'no_recipient' };

  const payload = {
    from: opts.from || configured.from || defaultFrom(),
    to: String(to).split(',').map((s) => s.trim()).filter(Boolean),
    subject: opts.subject,
    text: opts.text,
  };

  // The monospace block suits the machine-formatted notifications this started
  // out serving. A message written by a person should not arrive looking like a
  // log line, and a text-only mail also scores better with spam filters, so
  // `html: false` sends without an HTML part at all.
  if (opts.html === false) {
    // nothing to add
  } else if (typeof opts.html === 'string') {
    payload.html = opts.html;
  } else {
    payload.html = `<pre style="font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(opts.text)}</pre>`;
  }

  const replyTo = opts.replyTo || configured.replyTo;
  if (replyTo) payload.reply_to = replyTo;
  if (opts.headers && Object.keys(opts.headers).length) payload.headers = opts.headers;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn('[paramount] notify email failed:', res.status, text);
      return { ok: false, error: `resend_${res.status}` };
    }
    let id;
    try { id = JSON.parse(text).id; } catch (e) { /* id is a bonus, not a requirement */ }
    return { ok: true, id };
  } catch (err) {
    console.warn('[paramount] notify email error:', err.message);
    return { ok: false, error: err.message };
  }
}

/** Fire-and-forget wrapper for callers that only care whether it left. */
async function sendEmail(opts) {
  const result = await send(opts);
  return result.ok;
}

async function sendWebhook(subject, text, data) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${subject}\n\n${text}`, content: `${subject}\n\n${text}`, subject, data }),
    });
    if (!res.ok) console.warn('[paramount] notify webhook failed:', res.status);
    return res.ok;
  } catch (err) {
    console.warn('[paramount] notify webhook error:', err.message);
    return false;
  }
}

async function notify(subject, text, data, emailOpts = {}) {
  const results = await Promise.all([
    sendEmail({ subject, text, ...emailOpts }),
    sendWebhook(subject, text, data),
  ]);
  return results.some(Boolean);
}

/* ------------------------------------------------------------ enquiries --- */

/** A new contact-form enquiry. Replies go straight back to the sender. */
function enquiry(record) {
  const lines = [
    `Name:     ${record.name}`,
    `Email:    ${record.email}`,
    `Company:  ${record.company || '-'}`,
    `Interest: ${record.service || '-'}`,
    '',
    record.message,
    '',
    `Received:  ${record.receivedAt}`,
    `Reference: ${record.id}`,
  ].join('\n');
  return notify(`New enquiry from ${record.name}`, lines, record, { replyTo: record.email });
}

/** A rate request from /quote. */
function quote(record) {
  const lines = [
    `Name:        ${record.name}`,
    `Company:     ${record.company || '-'}`,
    `Email:       ${record.email}`,
    `Phone:       ${record.phone || '-'}`,
    '',
    `Mode:        ${record.mode ? tracking.modeLabel(record.mode) : '-'}`,
    `Origin:      ${record.origin || '-'}`,
    `Destination: ${record.destination || '-'}`,
    `Cargo:       ${record.cargoType || '-'}`,
    `Weight:      ${record.weightKg ? `${record.weightKg} kg` : '-'}`,
    `Pieces:      ${record.pieces || '-'}`,
    `Dimensions:  ${record.dimensions || '-'}`,
    `Ready:       ${record.readyDate || '-'}`,
    `Incoterms:   ${record.incoterms || '-'}`,
    '',
    record.message || '(no further detail)',
    '',
    `Received:  ${record.receivedAt}`,
    `Reference: ${record.id}`,
  ].join('\n');
  return notify(`Rate request: ${record.origin || '?'} → ${record.destination || '?'}`, lines, record, {
    replyTo: record.email,
  });
}

/** A job application from /careers. Replies go straight back to the applicant. */
function application(record) {
  const lines = [
    `Role:       ${record.roleTitle}`,
    `Name:       ${record.name}`,
    `Email:      ${record.email}`,
    `Phone:      ${record.phone || '-'}`,
    `Experience: ${record.experience || '-'}`,
    `Portfolio:  ${record.portfolio || '-'}`,
    '',
    record.message,
    '',
    `Received:  ${record.receivedAt}`,
    `Reference: ${record.id}`,
  ].join('\n');
  return notify(`Application: ${record.roleTitle}`, lines, record, { replyTo: record.email });
}

/** A visitor message from the live chat. Silenced by the desk's chat setting. */
async function chatMessage(sessionId, text) {
  if (String(process.env.CHAT_NOTIFY || 'on').toLowerCase() === 'off') return false;
  try {
    const current = await settings().read();
    if (!current.chat_notify) return false;
  } catch (err) {
    /* settings unavailable: fall back to notifying, which is the safer default */
  }
  const lines = [`Session: ${sessionId}`, '', text, '', `Received: ${new Date().toISOString()}`].join('\n');
  return notify('New live chat message', lines, { sessionId, text });
}

/* ------------------------------------------------------------ shipments --- */

const when = (value) =>
  value ? new Date(value).toUTCString().replace('GMT', 'UTC') : 'to be confirmed';

const route = (s) =>
  `${[s.origin_city, s.origin_country].filter(Boolean).join(', ')} → ${[s.destination_city, s.destination_country].filter(Boolean).join(', ')}`;

/** The customer-facing copy shared by both shipment emails. */
function shipmentBody(shipment, extra = []) {
  const meta = tracking.statusMeta(shipment.status);
  return [
    `Tracking number: ${shipment.tracking_number}`,
    `Status:          ${meta.label} — ${meta.blurb}`,
    `Route:           ${route(shipment)}`,
    `Service:         ${tracking.modeLabel(shipment.mode)}${shipment.service_level ? ` (${shipment.service_level})` : ''}`,
    shipment.current_location ? `Last seen:       ${shipment.current_location}` : null,
    `Est. delivery:   ${when(shipment.estimated_delivery)}`,
    ...extra,
    '',
    'Track it any time:',
    `  ${trackingUrl(shipment.tracking_number)}`,
  ].filter((line) => line !== null).join('\n');
}

/** Absolute link to the tracking page, so it works from a mail client. */
function trackingUrl(number) {
  const base = (process.env.SITE_URL || process.env.VERCEL_URL || '').replace(/\/+$/, '');
  const origin = base ? (base.startsWith('http') ? base : `https://${base}`) : '';
  return `${origin}/track?number=${encodeURIComponent(number)}`;
}

/**
 * Everyone who should hear about a consignment: the desk, plus the shipper and
 * consignee when the booking carries addresses for them.
 */
function audience(shipment) {
  return [shipment.receiver_email, shipment.shipper_email]
    .map((a) => String(a || '').trim())
    .filter(Boolean)
    .filter((a, i, all) => all.indexOf(a) === i);
}

/** A consignment has been booked: send the customer their tracking number. */
async function shipmentCreated(shipment) {
  const configured = await mailSettings();
  const desk = notify(
    `Consignment booked: ${shipment.tracking_number}`,
    shipmentBody(shipment, [
      `Shipper:         ${shipment.shipper_name}${shipment.shipper_company ? ` (${shipment.shipper_company})` : ''}`,
      `Consignee:       ${shipment.receiver_name}${shipment.receiver_company ? ` (${shipment.receiver_company})` : ''}`,
      `Pieces / weight: ${shipment.pieces || 1} / ${shipment.weight_kg ? `${shipment.weight_kg} kg` : 'n/a'}`,
    ]),
    shipment
  );

  const to = configured.onShipmentCreated ? audience(shipment) : [];
  const customer = to.length
    ? await send({
        to: to.join(','),
        subject: `Your Paramount consignment ${shipment.tracking_number}`,
        text: [
          `Hello ${shipment.receiver_name || 'there'},`,
          '',
          'Your consignment has been registered with Paramount Logistics.',
          '',
          shipmentBody(shipment),
          '',
          configured.signature || 'Paramount Logistics',
        ].join('\n'),
      })
    : { ok: false, error: 'not_sent' };

  await desk;
  return { desk: true, customer: customer.ok, recipients: to.length };
}

/** A consignment has moved: tell the customer where it is now. */
async function shipmentUpdated(shipment, event) {
  if (!shipment) return { ok: false, error: 'no_shipment' };
  const configured = await mailSettings();
  const meta = tracking.statusMeta(event.status);

  const to = configured.onShipmentUpdate ? audience(shipment) : [];
  if (!to.length) return { ok: false, error: 'not_sent' };

  const result = await send({
    to: to.join(','),
    subject: `${shipment.tracking_number}: ${meta.label}${event.location ? ` — ${event.location}` : ''}`,
    text: [
      `Hello ${shipment.receiver_name || 'there'},`,
      '',
      `Your consignment is now: ${meta.label}.`,
      event.location ? `Location: ${event.location}` : null,
      event.note ? `Note: ${event.note}` : null,
      '',
      shipmentBody(shipment),
      '',
      configured.signature || 'Paramount Logistics',
    ].filter((line) => line !== null).join('\n'),
  });

  return { ok: result.ok, recipients: to.length, error: result.error };
}

module.exports = {
  notify,
  send,
  sendEmail,
  enquiry,
  quote,
  application,
  chatMessage,
  shipmentCreated,
  shipmentUpdated,
  trackingUrl,
  defaultTo,
  defaultFrom,
};
