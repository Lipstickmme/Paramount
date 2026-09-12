'use strict';

const chatStore = require('../utils/chatStore');
const notify = require('../utils/notify');

function clean(str, max) {
  return String(str == null ? '' : str).trim().slice(0, max);
}

// Lightweight rule-based responder. This is the seam where a real agent,
// a human hand-off, or a third-party desk (Intercom, etc.) would plug in.
function autoReply(text) {
  const t = text.toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));

  if (has('hello', 'hi ', 'hey', 'good morning', 'good afternoon') || t === 'hi') {
    return "Hi, you're through to Merkel Constructions. What are you building, and how can we help?";
  }
  if (has('career', 'job', 'hiring', 'vacancy', 'apply', 'position', 'role')) {
    return 'We are hiring across structural, civil, mechanical and digital teams. You can see open roles on our Careers page, or tell me which discipline interests you.';
  }
  if (has('quote', 'cost', 'price', 'fee', 'budget')) {
    return 'Fees depend on scope and stage. If you share a short project brief along with your email, a principal engineer will come back to you with a considered response.';
  }
  if (has('project', 'portfolio', 'work', 'reference', 'example')) {
    return 'You can browse selected projects on our Projects page, spanning towers, bridges, industrial plant and transit. Is there a sector you would like to see?';
  }
  if (has('bridge', 'structural', 'seismic', 'civil', 'mechanical', 'hvac', 'bim', 'digital twin', 'facade')) {
    return 'That is squarely in our wheelhouse. Share a few details about the project and where it gets difficult, and we will point you to the right engineer.';
  }
  if (has('contact', 'call', 'phone', 'email', 'meet', 'speak')) {
    return 'The fastest route is the contact page, or email studio@merkelconstructions.com. Leave your email here and we will reach out within two working days.';
  }
  if (has('thanks', 'thank you', 'cheers', 'great')) {
    return 'Any time. Anything else I can help with?';
  }
  return "Thanks for the message. A member of the studio will follow up. If you leave your email and a one-line brief, we'll route it to the right engineer.";
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

    // Stay quiet once a member of the studio has picked the conversation up.
    let handedOver = false;
    try {
      handedOver = await chatStore.isHandedOver(sessionId);
    } catch (err) {
      console.error('[merkel] chat handover check failed:', err.message);
    }

    const reply = handedOver ? null : { role: 'agent', text: autoReply(text), at: new Date(Date.now() + 1).toISOString() };
    if (reply) messages.push(reply);

    let stored = true;
    try {
      await chatStore.append(sessionId, messages);
    } catch (err) {
      stored = false;
      console.error('[merkel] failed to persist chat message:', err.message);
    }

    // Route the visitor's message to the inbox so a human can pick it up.
    await notify.chatMessage(chatStore.sessionUuid(sessionId), text);

    // Both sides come back, so the widget draws the visitor's own message from
    // the same source it draws everything else and cannot double it up.
    return res.status(201).json({ ok: true, stored, messages });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/chat/notify
 *
 * Companion to the browser-written path. The visitor's own message is already
 * in the database, written by their browser under row level security; this
 * raises the flag by email and, until a human takes over, posts the holding
 * reply with the service role so it reaches them over realtime.
 */
exports.notifyMessage = async (req, res, next) => {
  try {
    const sessionId = clean(req.body.sessionId, 64);
    const text = clean(req.body.text, 2000);

    if (!chatStore.isUuid(sessionId)) {
      return res.status(422).json({ error: 'invalid_session', message: 'Missing or malformed session id.' });
    }
    if (text.length < 1) {
      return res.status(422).json({ error: 'empty_message', message: 'Message cannot be empty.' });
    }

    let replied = false;
    try {
      if (!(await chatStore.isHandedOverById(sessionId))) {
        await chatStore.appendById(sessionId, [{ role: 'agent', text: autoReply(text), at: new Date().toISOString() }]);
        replied = true;
      }
    } catch (err) {
      console.error('[merkel] failed to post chat reply:', err.message);
    }

    await notify.chatMessage(sessionId, text);

    return res.status(202).json({ ok: true, replied });
  } catch (err) {
    return next(err);
  }
};

/** GET /api/chat/:sessionId */
exports.getHistory = async (req, res, next) => {
  try {
    const sessionId = clean(req.params.sessionId, 64);
    if (!chatStore.isValidId(sessionId)) {
      return res.status(422).json({ error: 'invalid_session', message: 'Malformed session id.' });
    }
    let convo = { messages: [] };
    try {
      convo = await chatStore.load(sessionId);
    } catch (err) {
      // A storage fault should cost the visitor their history, not the widget.
      console.error('[merkel] failed to load chat history:', err.message);
    }
    return res.json({ sessionId, messages: convo.messages });
  } catch (err) {
    return next(err);
  }
};
