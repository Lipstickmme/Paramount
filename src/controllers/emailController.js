'use strict';

/**
 * Replying to company mail from the desk.
 *
 * The rest of the dashboard writes to Supabase straight from the browser, but a
 * reply has to leave through Resend, whose key is server-only. So this is a
 * route rather than a direct table write, and it checks admin membership itself
 * before doing anything.
 */

const config = require('../utils/config');
const notify = require('../utils/notify');
const siteSettings = require('../utils/siteSettings');
const { requireAdmin } = require('../utils/adminAuth');
const { getSupabase } = require('../utils/supabase');

const MAX_BODY = 20000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The From header for a reply, always carrying a display name.
 *
 * Mail clients fall back to the local part of the address when there is none,
 * so a reply from ops@paramountlogistics.com shows in the recipient's
 * inbox as "ops" rather than the company name.
 */
function senderIdentity() {
  const configured = config.mailboxAddress() || config.formFrom();
  const { name, email } = config.parseAddress(configured);
  if (!email) return configured;
  return name ? configured : `${config.studioName()} <${email}>`;
}

/** Keep one "Re: " on the front, however the subject arrived. */
function replySubject(subject) {
  const base = String(subject || '').replace(/^((re|fwd|fw)\s*:\s*)+/i, '').trim();
  return base ? `Re: ${base}` : 'Re: your message';
}

exports.reply = async (req, res, next) => {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.reason, message: 'Sign in as an admin to reply.' });
    }

    const threadId = String((req.body && req.body.threadId) || '').trim();
    const body = String((req.body && req.body.body) || '').trim();

    if (!UUID.test(threadId)) {
      return res.status(422).json({ error: 'invalid_thread', message: 'threadId must be a thread uuid.' });
    }
    if (!body) {
      return res.status(422).json({ error: 'empty_body', message: 'A reply needs some text.' });
    }
    if (body.length > MAX_BODY) {
      return res.status(422).json({ error: 'body_too_long', message: `Replies are limited to ${MAX_BODY} characters.` });
    }

    const supabase = getSupabase();
    if (!supabase) {
      return res.status(503).json({ error: 'no_storage', message: 'Supabase is not configured.' });
    }

    const threads = await supabase.select(
      'email_threads',
      `select=id,subject,participant_email&id=eq.${encodeURIComponent(threadId)}&limit=1`
    );
    if (!Array.isArray(threads) || !threads.length) {
      return res.status(404).json({ error: 'no_thread', message: 'That conversation no longer exists.' });
    }
    const thread = threads[0];

    // Threading the reply onto the correspondent's last message is what puts it
    // inside their existing conversation instead of starting a new one.
    let inReplyTo = null;
    const previous = await supabase.select(
      'email_messages',
      `select=message_id&thread_id=eq.${encodeURIComponent(threadId)}&direction=eq.inbound` +
        '&order=created_at.desc&limit=1'
    );
    if (Array.isArray(previous) && previous.length) inReplyTo = previous[0].message_id || null;

    const from = senderIdentity();
    const subject = replySubject(thread.subject);

    // The signature is a setting rather than something the agent retypes, but
    // it is not forced on a reply that already ends with it.
    const settings = await siteSettings.read();
    const signature = String(settings.email_signature || '').trim();
    const outgoing = signature && !body.endsWith(signature) ? `${body}\n\n${signature}` : body;

    const sent = await notify.send({
      to: thread.participant_email,
      from,
      subject,
      text: outgoing,
      // Written by a person, so it goes as plain text rather than the monospace
      // block the automated notifications use.
      html: false,
      headers: inReplyTo ? { 'In-Reply-To': inReplyTo, References: inReplyTo } : undefined,
    });

    if (!sent.ok) {
      return res.status(502).json({
        error: 'send_failed',
        reason: sent.error,
        message: 'Resend would not accept the reply. Check RESEND_API_KEY and that FORM_FROM is on a verified domain.',
      });
    }

    // Recorded after a confirmed send, so the thread never shows a reply that
    // did not leave.
    await supabase.insert('email_messages', {
      thread_id: threadId,
      direction: 'outbound',
      from_email: config.parseAddress(from).email,
      from_name: config.parseAddress(from).name || null,
      to_email: thread.participant_email,
      subject,
      body_text: outgoing,
      message_id: sent.id || null,
      in_reply_to: inReplyTo,
    });

    return res.status(201).json({ ok: true, threadId, messageId: sent.id || null });
  } catch (err) {
    return next(err);
  }
};

/**
 * What to do about a send that failed, in the desk's words.
 *
 * Resend's own message is passed through as well; this is the step that
 * follows from it, since "domain is not verified" does not say where to go.
 */
function hintFor(result) {
  const detail = String(result.detail || '');
  if (result.error === 'no_api_key') {
    return 'RESEND_API_KEY is not set on this deployment. Add it in Vercel, Settings, Environment Variables, then redeploy.';
  }
  if (result.error === 'no_recipient') {
    return 'There is nobody to send to. Type an address here, or set the notification address above (or FORM_TO in Vercel).';
  }
  if (/only send testing emails|your own email/i.test(detail) || /resend\.dev/i.test(String(result.from || ''))) {
    return 'Mail is going out as Resend\u2019s shared test sender, which only delivers to the Resend account owner. Set FORM_FROM (or the From setting above) to an address on your verified domain.';
  }
  if (/domain/i.test(detail) && /verif/i.test(detail)) {
    return `Resend will not send as ${result.from}. Verify that domain (the part after the @) in Resend, Domains, or change the From address to one on a domain that is verified.`;
  }
  if (result.status === 401 || result.status === 403 || /api key/i.test(detail)) {
    return 'Resend did not accept the API key. Check RESEND_API_KEY in Vercel, then redeploy.';
  }
  if (result.status === 429) return 'Resend is rate limiting this account. Wait a minute and try again.';
  return 'Resend refused the message. Its reason is above.';
}

/**
 * POST /api/emails/test
 *
 * Send one message through exactly the path customer notifications take —
 * the same key, sender and settings — and report what Resend said. The desk
 * can then see "mail works" or the reason it does not, without booking a
 * consignment to find out.
 */
exports.test = async (req, res, next) => {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.reason, message: 'Sign in as an admin to send a test email.' });
    }

    const to = String((req.body && req.body.to) || '').trim();
    if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(422).json({ error: 'invalid_email', message: 'That address does not look right.' });
    }

    const result = await notify.send({
      to: to || undefined,
      subject: 'Paramount Shipping: test email',
      html: false,
      text: [
        'This is a test from the Paramount Shipping operations desk.',
        '',
        'If you are reading it, customer notifications — booking confirmations,',
        'movement updates, holds and photo alerts — can reach an inbox too.',
        '',
        `Sent ${new Date().toUTCString()}.`,
      ].join('\n'),
    });

    if (result.ok) {
      return res.json({
        ok: true,
        id: result.id || null,
        from: result.from,
        to: result.to,
        message: `Resend accepted it${result.id ? ` (id ${result.id})` : ''}. It was sent as ${result.from} to ${[].concat(result.to).join(', ')}. If it has not arrived in a minute or two, look in spam, then at Resend, Emails, for its delivery status.`,
      });
    }
    // 200: the request did its job, which was to find out. The outcome is in
    // `ok`, and a failed send is not an error in the page that asked.
    return res.status(200).json({
      ok: false,
      error: result.error,
      detail: result.detail || null,
      from: result.from || null,
      to: result.to || null,
      message: result.detail ? `Resend said: ${result.detail}` : `Not sent (${result.error}).`,
      hint: hintFor(result),
    });
  } catch (err) {
    return next(err);
  }
};
