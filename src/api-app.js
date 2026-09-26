'use strict';

/**
 * API-only Express app.
 *
 * On Vercel the static pages are served from the CDN and only /api/* reaches
 * this function, so there is no static hosting or page routing here.
 * Locally, src/app.js serves both the pages and this same API router.
 */

const express = require('express');

const rateLimiter = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const apiRoutes = require('./routes');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// `verify` stashes the exact bytes so webhook signatures can be checked. A
// consignment photo is the one body allowed to be large: it arrives as a
// resized JPEG in a data URL, and Vercel refuses anything over 4.5 MB anyway.
const PHOTO_UPLOAD = /^\/api\/shipments\/[^/]+\/photos\/?$/;
const keepRaw = (req, res, buf) => { req.rawBody = buf; };
const jsonSmall = express.json({ limit: '1mb', verify: keepRaw });
const jsonPhoto = express.json({ limit: '4mb', verify: keepRaw });
app.use((req, res, next) => (PHOTO_UPLOAD.test(req.path) ? jsonPhoto : jsonSmall)(req, res, next));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Signed provider webhooks: verified by signature, not rate limited.
app.use('/api/inbound', require('./routes/inbound'));
// The same endpoint under the address the Resend webhook was first pointed
// at, so mail sent there is filed rather than refused with a 404.
app.post('/api/inbound-email', require('./controllers/inboundController').resend);

app.use('/api', rateLimiter, apiRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `No API route for ${req.method} ${req.path}` });
});

app.use(errorHandler);

module.exports = app;
