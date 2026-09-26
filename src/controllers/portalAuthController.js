'use strict';

/**
 * Password reset for the customer portal.
 *
 * This exists so the mail comes from us rather than from Supabase — see
 * src/utils/authMail.js for why that is worth a round trip. Signing *in* is
 * unchanged and still goes straight from the page to GoTrue: it sends no mail,
 * so there is nothing to intercept, and putting a password through our server
 * when it does not have to pass through would be worse, not better.
 *
 * There is no registration route. Tracking a consignment needs no account at
 * all — the number is the credential — so the only accounts are the ones the
 * desk opens, and a self-service sign-up would put a confirmation email in
 * front of something the visitor could already see. What is left is the
 * password reset those accounts still need.
 *
 * It answers the same thing whatever happened, because the difference between
 * "we sent you a link" and "there is no account here" is a way of asking us who
 * our customers are. The visitor is told what to do next; the log knows more.
 */

const authMail = require('../utils/authMail');
const config = require('../utils/config');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
const NEUTRAL = (email) =>
  `If ${email} has an account, a reset link is on its way. Check the inbox, and the spam folder.`;

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
    return res.status(202).json({ ok: true, message: NEUTRAL(email) });
  } catch (err) {
    return next(err);
  }
};
