'use strict';

/**
 * Portal sign-up and password-reset mail, sent by us rather than by Supabase.
 *
 * Supabase will happily send these itself, and for a prototype that is the
 * right answer. For a live site it is the wrong one: its built-in mailer is
 * shared, rate-limited to a handful of messages an hour, sends from a Supabase
 * address that has nothing to do with this company, and its templates look
 * nothing like the rest of the site. A customer's first email from a shipping
 * line should not be the one piece of it that looks like somebody else's.
 *
 * So the browser no longer calls GoTrue's /signup and /recover. It calls this
 * server, which:
 *
 *   1. asks Supabase's admin API to *mint* the link without sending anything
 *      (POST /auth/v1/admin/generate_link), and
 *   2. puts that link in an email of our own, through Resend, using the same
 *      sender and settings every other message on this site goes out with.
 *
 * Supabase still owns the token, the expiry and the verification — only the
 * envelope changes. Nothing here can create a confirmed account or hand out a
 * session; `generate_link` returns a URL and nothing else.
 *
 * The service role key never leaves the server, which is why this cannot live
 * in the page.
 */

const config = require('./config');
const notify = require('./notify');

/* ----------------------------------------------------------------- mint --- */

/**
 * Ask Supabase for an action link, without sending mail.
 *
 * `type` is GoTrue's: 'signup' creates the user and returns a confirmation
 * link, 'recovery' returns a password-reset link for an existing one,
 * 'magiclink' a sign-in link. The shape of the response has moved between
 * GoTrue versions — older builds return `action_link` at the top level, newer
 * ones nest it under `properties` — so both are read.
 */
async function generateLink(type, { email, password, redirectTo }) {
  const url = config.supabaseUrl();
  const key = config.supabaseServiceKey();
  if (!url || !key) return { ok: false, error: 'supabase_not_configured' };

  const payload = { type, email };
  if (password) payload.password = password;
  if (redirectTo) payload.redirect_to = redirectTo;

  let res;
  let body = {};
  try {
    res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    console.warn('[paramount] generate_link failed:', err.message);
    return { ok: false, error: 'network' };
  }

  if (!res.ok) {
    // GoTrue's own wording, kept: the caller decides what the visitor is told,
    // and "already registered" in particular must not reach them.
    const message = body.msg || body.message || body.error_description || `status_${res.status}`;
    return { ok: false, status: res.status, error: body.error_code || body.code || 'generate_link_failed', message };
  }

  const link = (body.properties && body.properties.action_link) || body.action_link || null;
  if (!link) return { ok: false, error: 'no_action_link' };
  return { ok: true, link, user: body.user || (body.properties && body.properties.user) || null };
}

/* -------------------------------------------------------------- the mail --- */

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

/**
 * One template for both messages.
 *
 * Deliberately plain HTML — tables, inline styles, no webfont, no image. Mail
 * clients are not browsers, half of them will show the text part anyway, and a
 * confirmation link that renders in every client beats one that looks lovely in
 * three of them. The navy and the oxide red are the site's, hard-coded, because
 * a CSS custom property means nothing in an inbox.
 */
function shell({ heading, lede, action, link, footer }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f2f5fa">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5fa;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f2;border-radius:14px">
        <tr><td style="padding:28px 30px 0">
          <div style="font:600 13px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#1a6ea8">Paramount Shipping</div>
          <h1 style="margin:16px 0 0;font:700 23px/1.25 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0c1f3d">${esc(heading)}</h1>
          <p style="margin:14px 0 0;font:15px/1.65 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#44566f">${esc(lede)}</p>
        </td></tr>
        <tr><td style="padding:26px 30px 6px">
          <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#a8341c;color:#ffffff;font:600 15px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;text-decoration:none">${esc(action)}</a>
        </td></tr>
        <tr><td style="padding:14px 30px 26px">
          <p style="margin:0;font:13px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6e8098">
            If the button does not work, copy this into your browser:<br>
            <span style="color:#1a6ea8;word-break:break-all">${esc(link)}</span>
          </p>
          <p style="margin:16px 0 0;font:13px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6e8098">${esc(footer)}</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font:12px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#8496ad">
        Tracking a single consignment needs no account at all.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

const plain = ({ heading, lede, action, link, footer }) =>
  `${heading}\n\n${lede}\n\n${action}:\n${link}\n\n${footer}\n`;

/* ------------------------------------------------------------- the flows --- */

/**
 * Register an address, and mail it the confirmation link.
 *
 * An address that already has an account is *not* reported as such — that
 * would turn this endpoint into a way of asking whether somebody banks with
 * us. It gets a different email instead, saying somebody tried to register it
 * and offering the reset link, and the caller returns the same neutral answer
 * either way.
 */
async function sendSignUp({ email, password, redirectTo }) {
  const minted = await generateLink('signup', { email, password, redirectTo });

  if (minted.ok) {
    const copy = {
      heading: 'Confirm your address',
      lede: 'You asked for a Paramount Shipping account. Confirm this address and every consignment booked to or from it appears in your portal.',
      action: 'Confirm my address',
      link: minted.link,
      footer: 'If this was not you, ignore this message — no account is created until the link is used.',
    };
    const mail = await notify.send({
      to: email,
      subject: 'Confirm your Paramount Shipping account',
      text: plain(copy),
      html: shell(copy),
    });
    return { ok: true, delivered: mail.ok, mail };
  }

  // Already registered: say nothing about it here, and help them there.
  if (/already/i.test(minted.message || '') || minted.status === 422) {
    const mail = await sendAlreadyRegistered({ email, redirectTo });
    return { ok: true, delivered: mail.ok, existing: true, mail };
  }

  return { ok: false, error: minted.error, message: minted.message };
}

/** The mail an existing account gets when somebody re-registers its address. */
async function sendAlreadyRegistered({ email, redirectTo }) {
  const minted = await generateLink('recovery', { email, redirectTo });
  if (!minted.ok) return { ok: false, error: minted.error };
  const copy = {
    heading: 'You already have an account',
    lede: 'Somebody just tried to register this address with Paramount Shipping. It already has an account, so nothing changed. If that was you, set a new password below and sign in.',
    action: 'Set a new password',
    link: minted.link,
    footer: 'If it was not you, ignore this message. Your password has not changed.',
  };
  return notify.send({
    to: email,
    subject: 'Your Paramount Shipping account',
    text: plain(copy),
    html: shell(copy),
  });
}

/**
 * Mail a password-reset link.
 *
 * An address with no account is answered exactly like one that has: the same
 * message, the same timing, no mail. The caller must not distinguish them.
 */
async function sendPasswordReset({ email, redirectTo }) {
  const minted = await generateLink('recovery', { email, redirectTo });
  if (!minted.ok) return { ok: true, delivered: false, unknown: true };

  const copy = {
    heading: 'Set a new password',
    lede: 'Somebody asked to reset the password on your Paramount Shipping account. This link works once, and expires.',
    action: 'Set a new password',
    link: minted.link,
    footer: 'If this was not you, ignore this message. Your password has not changed.',
  };
  const mail = await notify.send({
    to: email,
    subject: 'Set a new password for Paramount Shipping',
    text: plain(copy),
    html: shell(copy),
  });
  return { ok: true, delivered: mail.ok, mail };
}

/** Whether this deployment can send auth mail at all. */
const configured = () =>
  Boolean(config.supabaseUrl() && config.supabaseServiceKey() && process.env.RESEND_API_KEY);

module.exports = { sendSignUp, sendPasswordReset, generateLink, configured };
