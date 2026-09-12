'use strict';

const chatStore = require('../utils/chatStore');
const notify = require('../utils/notify');
const tracking = require('../utils/tracking');
const shipments = require('../utils/shipmentStore');
const siteSettings = require('../utils/siteSettings');

function clean(str, max) {
  return String(str == null ? '' : str).trim().slice(0, max);
}

/**
 * If the visitor quoted a tracking number, answer with the actual position of
 * the actual consignment.
 *
 * This is the one thing a logistics chat is really asked, and the data is
 * already here, so the widget answers it rather than promising a human will.
 * Only the customer-facing projection is used, so the chat cannot leak a field
 * the tracking page would not show.
 */
async function trackingAnswer(text) {
  const number = tracking.findInText(text);
  if (!number) return null;

  let shipment;
  try {
    shipment = await shipments.getByTrackingNumber(number);
  } catch (err) {
    console.warn('[paramount] chat tracking lookup failed:', err.message);
    return null;
  }

  if (!shipment) {
    return `I could not find ${number} on our system. Check it against your paperwork — ours look like ${tracking.PREFIX}-${new Date().getFullYear()}-4F7K2QX9 — or leave your email and the desk will trace it.`;
  }

  let events = [];
  try {
    events = await shipments.listEvents(shipment.id);
  } catch (err) {
    /* the headline is still worth sending without the last scan */
  }

  const view = shipments.toPublic(shipment, events);
  const last = view.events[0];
  const eta = view.estimated_delivery
    ? new Date(view.estimated_delivery).toUTCString().replace('GMT', 'UTC')
    : 'not yet confirmed';

  return [
    `${view.tracking_number} is ${view.status_label.toLowerCase()}.`,
    view.current_location ? `Last scan: ${view.current_location}${last && last.occurred_at ? ` on ${new Date(last.occurred_at).toUTCString().replace('GMT', 'UTC')}` : ''}.` : null,
    `Route: ${view.origin_city} to ${view.destination_city}.`,
    view.is_delivered ? null : `Estimated delivery: ${eta}.`,
    `Full timeline: /track?number=${encodeURIComponent(view.tracking_number)}`,
  ].filter(Boolean).join(' ');
}

/**
 * Lightweight rule-based responder for everything else. This is the seam where
 * a real agent, a human hand-off, or a third-party desk would plug in.
 */
function autoReply(text) {
  const t = text.toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));

  if (has('hello', 'hi ', 'hey', 'good morning', 'good afternoon') || t === 'hi') {
    return "You're through to Paramount Logistics. Quote a tracking number and I'll tell you exactly where it is, or tell me what you need moved.";
  }
  if (has('track', 'where is', 'status', 'delivery date', 'eta', 'arrive')) {
    return `Send me the tracking number — they look like ${tracking.PREFIX}-${new Date().getFullYear()}-4F7K2QX9 — and I'll pull up the live timeline. If you have lost it, the desk can find it from the booking reference or the consignee's address.`;
  }
  if (has('quote', 'rate', 'price', 'cost', 'how much', 'tariff')) {
    return 'Rates depend on lane, mode and cargo. Give me the origin, destination, weight and readiness date — or use the quote form — and a lane specialist comes back with rates and transit times.';
  }
  if (has('customs', 'clearance', 'duty', 'import', 'export', 'hs code')) {
    return 'We hold brokerage in-house at every gateway. Tell me the origin, destination and commodity, and we will tell you what paperwork the lane needs before the cargo moves.';
  }
  if (has('air', 'ocean', 'sea', 'road', 'rail', 'courier', 'warehouse', 'storage', 'fulfil')) {
    return 'That is one of ours. Air, ocean, road, rail, express and contract warehousing all run on the same file and the same tracking number — what is the lane?';
  }
  if (has('damage', 'claim', 'lost', 'missing', 'late', 'delay')) {
    return 'I am sorry — that should not happen. Give me the tracking number and a line on what went wrong, and I will put it straight in front of the control tower.';
  }
  if (has('contact', 'call', 'phone', 'email', 'speak', 'human', 'agent')) {
    return 'The desk is on the contact page, and the control tower is staffed 24/7. Leave your email here and a person picks this conversation up.';
  }
  if (has('thanks', 'thank you', 'cheers', 'great')) {
    return 'Any time. Anything else I can look up?';
  }
  return 'Thanks — a member of the team will follow up. If it is about a consignment, send the tracking number and I can answer straight away.';
}

/**
 * POST /api/chat/message
 *
 * Fallback path: used when the browser cannot reach Supabase itself (not
 * configured, or the client library failed to load). The server holds the
 * service role, so it writes both sides of the exchange.
 */
exports.postMessage = async (req, res, next) => {
  try {
    const sessionId = clean(req.body.sessionId, 64);
    const text = clean(req.body.text, 2000);

    if (!chatStore.isValidId(sessionId)) {
      return res.status(422).json({ error: 'invalid_session', message: 'Missing or malformed session id.' });
    }
    if (text.length < 1) {
      return res.status(422).json({ error: 'empty_message', message: 'Message cannot be empty.' });
    }

    const now = new Date().toISOString();
    const messages = [{ role: 'user', text, at: now }];

    // Stay quiet once a member of the team has picked the conversation up.
    let handedOver = false;
    try {
      handedOver = await chatStore.isHandedOver(sessionId);
    } catch (err) {
      console.warn('[paramount] could not read hand-over state:', err.message);
    }

    if (!handedOver) {
      const answer = (await trackingAnswer(text)) || autoReply(text);
      messages.push({ role: 'agent', text: answer, at: new Date().toISOString() });
    }

    // Whether the exchange was written down is reported back, because a chat
    // that answers but does not persist looks identical to the visitor and is
    // not identical at all to the desk.
    let stored = false;
    try {
      await chatStore.append(sessionId, messages);
      stored = true;
    } catch (err) {
      console.error('[paramount] failed to persist chat:', err.message);
    }

    await notify.chatMessage(sessionId, text);

    return res.status(201).json({ ok: true, stored, sessionId, messages });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/chat/notify
 *
 * The Supabase path: the visitor's own browser wrote the message, so all that
 * is left is to raise it with the desk and, while nobody has taken the
 * conversation over, write the holding reply that the browser cannot author
 * for itself (only an admin may insert an agent row).
 */
exports.notifyMessage = async (req, res, next) => {
  try {
    const sessionId = clean(req.body.sessionId, 64);
    const text = clean(req.body.text, 2000);

    if (!chatStore.isUuid(sessionId)) {
      return res.status(422).json({ error: 'invalid_session', message: 'Missing or malformed session id.' });
    }
    if (!text) {
      return res.status(422).json({ error: 'empty_message', message: 'Message cannot be empty.' });
    }

    let handedOver = false;
    try {
      handedOver = await chatStore.isHandedOverById(sessionId);
    } catch (err) {
      console.warn('[paramount] could not read hand-over state:', err.message);
    }

    let reply = null;
    if (!handedOver) {
      reply = (await trackingAnswer(text)) || autoReply(text);
      try {
        await chatStore.appendById(sessionId, [{ role: 'agent', text: reply, at: new Date().toISOString() }]);
      } catch (err) {
        console.warn('[paramount] could not write the holding reply:', err.message);
        reply = null;
      }
    }

    await notify.chatMessage(sessionId, text);
    // 202: the message itself was written by the browser, so this only
    // acknowledges that the desk has been told and the holding reply is in.
    return res.status(202).json({ ok: true, replied: Boolean(reply) });
  } catch (err) {
    return next(err);
  }
};

/** GET /api/chat/:sessionId — history for the fallback path. */
exports.getSession = async (req, res, next) => {
  try {
    const sessionId = clean(req.params.sessionId, 64);
    if (!chatStore.isValidId(sessionId)) {
      return res.status(422).json({ error: 'invalid_session', message: 'Malformed session id.' });
    }
    const convo = await chatStore.load(sessionId);
    return res.json({ ok: true, ...convo });
  } catch (err) {
    return next(err);
  }
};

/** GET /api/chat — the greeting the widget opens with, from the settings row. */
exports.greeting = async (req, res, next) => {
  try {
    const settings = await siteSettings.read();
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      enabled: settings.chat_enabled,
      agent: settings.chat_agent_name || settings.company_name,
      greeting:
        settings.chat_greeting ||
        "You're through to Paramount Logistics. Quote a tracking number and I'll tell you exactly where it is.",
      away: settings.chat_away_message || '',
    });
  } catch (err) {
    return next(err);
  }
};

// The route this used to be mounted under, kept so a stale reference fails
// loudly at require time rather than at the first visitor's message.
module.exports.getHistory = exports.getSession;
module.exports.autoReply = autoReply;
module.exports.trackingAnswer = trackingAnswer;
