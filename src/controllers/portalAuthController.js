'use strict';

/**
 * Registration and password reset for the customer portal.
 *
 * These two exist so the mail comes from us rather than from Supabase — see
 * src/utils/authMail.js for why that is worth a round trip. Signing *in* is
 * unchanged and still goes straight from the page to GoTrue: it sends no mail,
 * so there is nothing to intercept, and putting a password through our server
 * when it does not have to pass through would be worse, not better.
 *
 * Both answer the same thing whatever happened, because the difference between
 * "we sent you a link" and "there is no account here" is a way of asking us who
 * our customers are. The visitor is told what to do next; the log knows more.
 */

const authMail = require('../utils/authMail');
const config = require('../utils/config');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

/** The address the confirmation link comes back to. */
function portalUrl(req) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configured) return `${configured.replace(/\/+$/, '')}/portal`;
  // Behind a proxy the original host is in the forwarded headers; Express only
  // trusts them when `trust proxy` is set, which app.js does for the platform.
  return `${req.protocol}://${req.get('host')}/portal`;
}

/**
 * The one answer both routes give.
 *
 * Deliberately says "if": it is true whether or not anything was sent, and it
 * is the sentence that keeps the endpoint from confirming who has an account.
 */
const NEUTRAL = (email, what) =>
  `If ${email} can receive mail, ${what} is on its way. Check the inbox, and the spam folder.`;

/* -------------------------------------------------------------- register --- */

/** POST /api/portal/register — create an account and mail the confirmation. */
exports.register = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!EMAIL_RE.test(email)) {
      return res.status(422).json({
        error: 'invalid_email',
        message: 'Enter the email address the consignment is booked to.',
        fields: { email: 'That does not look like an email address.' },
      });
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(422).json({
        error: 'weak_password',
        message: `Use at least ${MIN_PASSWORD} characters.`,
        fields: { password: `At least ${MIN_PASSWORD} characters.` },
      });
    }

    if (!config.supabaseServiceKey()) {
      return res.status(503).json({
        error: 'accounts_unavailable',
        message: 'Accounts are not available on this deployment yet. You can still track any consignment with its number.',
      });
    }

    const result = await authMail.sendSignUp({ email, password, redirectTo: portalUrl(req) });

    if (!result.ok) {
      console.warn('[paramount] portal register failed:', result.error, result.message || '');
      return res.status(502).json({
        error: 'signup_failed',
        message: 'We could not set that up just now. Try again in a minute, or email the desk.',
      });
    }

    // `existing` and `delivered` stay out of the response on purpose.
    return res.status(202).json({ ok: true, message: NEUTRAL(email, 'a confirmation link') });
  } catch (err) {
    return next(err);
  }
};

/* ----------------------------------------------------------------- reset --- */

/** POST /api/portal/reset — mail a password-reset link. */
exports.reset = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(422).json({
        error: 'invalid_email',
        message: 'Enter the address on the account.',
        fields: { email: 'That does not look like an email address.' },
      });
    }

    if (!config.supabaseServiceKey()) {
      return res.status(503).json({
        error: 'accounts_unavailable',
        message: 'Accounts are not available on this deployment yet.',
      });
    }

    // Unknown addresses fall through to the same answer, having sent nothing.
    await authMail.sendPasswordReset({ email, redirectTo: portalUrl(req) });
    return res.status(202).json({ ok: true, message: NEUTRAL(email, 'a reset link') });
  } catch (err) {
    return next(err);
  }
};
