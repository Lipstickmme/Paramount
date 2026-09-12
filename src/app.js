'use strict';

/**
 * Express application factory / configuration.
 * Assembles middleware, API routes, static hosting and error handling.
 */

const path = require('path');
const express = require('express');

const rateLimiter = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const apiRoutes = require('./routes');

const app = express();

// Trust proxy so client IPs are accurate behind a reverse proxy / load balancer.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Body parsing (built-in, no extra deps).
// `verify` stashes the exact bytes so webhook signatures can be checked.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Lightweight security headers (dependency-free).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Simple request logging.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[merkel] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// API namespace (rate limited).
// Signed provider webhooks: verified by signature, not rate limited.
app.use('/api/inbound', require('./routes/inbound'));

app.use('/api', rateLimiter, apiRoutes);

// Static frontend.
const publicDir = path.join(__dirname, '..', 'public');
app.use(
  express.static(publicDir, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      // Long cache for static media (hero slides, logos); versioned per deploy.
      if (/\.(webp|png|jpg|jpeg|svg|mp4|woff2?)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
    },
  })
);

// Clean-URL page routes. Each maps to a pre-built static HTML page.
const sendPage = (file) => (req, res) => res.sendFile(path.join(publicDir, file));

app.get('/', sendPage('index.html'));
app.get('/projects', sendPage('projects.html'));
// Project detail pages resolve the id client-side from the path.
app.get('/projects/:id', sendPage('project.html'));
app.get('/services', sendPage('services.html'));
// Service detail pages resolve the id client-side from the path.
app.get('/services/:id', sendPage('service.html'));
app.get('/careers', sendPage('careers.html'));
app.get('/apply', sendPage('apply.html'));
app.get('/contact', sendPage('contact.html'));
// Staff dashboard. Access is decided by Supabase auth on the page itself.
app.get('/admin', sendPage('admin.html'));

// Unknown non-API, non-asset GET routes get the styled 404 page.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  // Anything that looks like a file (has an extension) was not found by
  // express.static above, so let it 404 rather than returning HTML.
  if (path.extname(req.path)) return next();
  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

// 404 + centralized error handling.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
