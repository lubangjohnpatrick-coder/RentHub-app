'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prerender = require('./prerender');

const app = express();
const PORT = process.env.PORT || 4000;
const SITE_HOST = process.env.CANON_HOST || 'gorenthive.online';
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  const host = (req.get('host') || '').toLowerCase();
  if (host === 'www.' + SITE_HOST || host === 'www.' + SITE_HOST + ':443') return res.redirect(301, 'https://' + SITE_HOST + req.originalUrl);
  next();
});

app.use((req, res, next) => {
  const requestId = String(req.get('x-request-id') || '').slice(0, 100) || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// The legacy SPA still contains inline event handlers. We therefore keep
// 'unsafe-inline' temporarily, but enforce a constrained CSP rather than
// disabling CSP entirely. Tighten further as inline handlers are migrated.
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
      frameSrc: ["'self'", 'https://checkout.paymongo.com'],
      upgradeInsecureRequests: [],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
  next();
});

const { handleWebhook } = require('./paymongo-webhook');
app.post('/api/paymongo/webhook', express.raw({ type: 'application/json', limit: '1mb' }), handleWebhook);
app.use(express.json({ limit: '2mb' }));

const { apiRateLimit, authRateLimit } = require('./request-guard');
app.use('/api/auth', authRateLimit);
app.use('/api', apiRateLimit);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, name: 'GoRentHive', status: 'alive' }));
app.use(require('./readiness'));

// Order matters. Hardened compatibility routes MUST run before older routes.
app.use('/api', require('./no-delivery'));
app.use('/api', require('./location'));
app.use('/api', require('./profile-location'));
app.use('/api', require('./booking-v2'));
app.use('/api', require('./launch-hardening'));
app.use('/api', require('./verification-v2'));
app.use('/api', require('./media'));
app.use('/api', require('./financial'));
app.use('/api', require('./private'));
app.use('/api/upload', require('./upload'));

const setUtf8 = (res) => {
  const ct = res.getHeader('Content-Type') || '';
  if (ct && !/charset/i.test(ct)) res.setHeader('Content-Type', ct + '; charset=utf-8');
};
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js|json|svg)$/i.test(filePath)) setUtf8(res);
    if (/index\.html$|service-worker\.js$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.(css|js|json|webmanifest)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else if (/\.(png|jpg|jpeg|webp|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }
  },
}));

const PRIVATE_PATH = /^\/(admin|me|messages|wallet|booking|dashboard|favorites|verify|premium)(\/|$)/;

app.get('*', (req, res) => {
  const p = (req.path || '/').split('?')[0].replace(/\/+$/, '') || '/';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (PRIVATE_PATH.test(p)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const r = prerender.routeFor(p);
  if (!r) return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const url = prerender.CANON + p;
  const ogImage = prerender.CANON + '/icons/icon-512.png';
  const out = html
    .replace(/<title>.*?<\/title>/, `<title>${r.title}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${r.desc}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${r.title}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${r.desc}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${ogImage}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${r.title}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${r.desc}">`)
    .replace(/(<main class="page" id="app"[^>]*>)/, `$1\n${r.noscript}`);
  res.send(out);
});

app.use((err, req, res, next) => {
  console.error(`[${req.requestId || 'no-request-id'}]`, err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error', request_id: req.requestId });
});

app.listen(PORT, () => console.log('GoRentHive running on http://localhost:' + PORT));
