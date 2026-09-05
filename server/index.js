'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prerender = require('./prerender');
const seo = require('./seo');

const app = express();
const PORT = process.env.PORT || 4000;
const SITE_HOST = process.env.CANON_HOST || 'gorenthive.online';
const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
app.set('trust proxy', 1);
app.disable('x-powered-by');

function healthPath(req) {
  return /^\/health(?:z|\/|$)/.test(req.path || '');
}

app.use((req, res, next) => {
  const host = (req.get('host') || '').toLowerCase().replace(/:\d+$/, '');
  const forwardedProto = String(req.get('x-forwarded-proto') || req.protocol || '').toLowerCase();
  if (host === 'www.' + SITE_HOST) return res.redirect(301, 'https://' + SITE_HOST + req.originalUrl);
  if (IS_PROD && !healthPath(req)) {
    if (host && host !== SITE_HOST) return res.redirect(308, 'https://' + SITE_HOST + req.originalUrl);
    if (forwardedProto && forwardedProto !== 'https') return res.redirect(308, 'https://' + SITE_HOST + req.originalUrl);
  }
  next();
});

app.use((req, res, next) => {
  const supplied = String(req.get('x-request-id') || '').trim();
  const requestId = /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com', 'https://js.paymongo.com'], scriptSrcElem: ["'self'", 'https://unpkg.com', 'https://js.paymongo.com'], scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', 'https://unpkg.com'], styleSrcElem: ["'self'", 'https://fonts.googleapis.com', 'https://unpkg.com'], styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://api.paymongo.com'], frameSrc: ["'self'", 'https://checkout.paymongo.com', 'https://*.paymongo.com'],
      workerSrc: ["'self'", 'blob:'], manifestSrc: ["'self'"], mediaSrc: ["'self'", 'blob:', 'https:'], upgradeInsecureRequests: [],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()'); next(); });

app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return;
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (res.statusCode >= 400 || durationMs >= 1500) console.log(JSON.stringify({ type: 'http', request_id: req.requestId, method: req.method, path: req.path, status: res.statusCode, duration_ms: Math.round(durationMs) }));
  });
  next();
});

const { handleWebhook } = require('./paymongo-webhook');
app.post('/api/paymongo/webhook', express.raw({ type: 'application/json', limit: '1mb' }), handleWebhook);
app.use(express.json({ limit: '2mb' }));

const { apiRateLimit, authRateLimit } = require('./request-guard');
app.use('/api/auth', authRateLimit);
app.use('/api', apiRateLimit);
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache'); next(); });

app.get('/healthz', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, name: 'GoRentHive', status: 'alive' }); });
app.use(require('./readiness'));

// Order matters. Specific trust/regulatory/release routes run before generic compatibility routes.
app.use('/api', require('./no-delivery'));
app.use('/api', require('./vehicle-compliance'));
app.use('/api', require('./marketplace-pro'));
app.use('/api', require('./availability'));
app.use('/api', require('./messaging-pro'));
app.use('/api', require('./agreement-v3'));
app.use('/api', require('./condition-v3'));
app.use('/api', require('./handover-code'));
app.use('/api', require('./location'));
app.use('/api', require('./profile-location'));
app.use('/api', require('./listings-v2'));
app.use('/api', require('./booking-v2'));
app.use('/api', require('./launch-hardening'));
app.use('/api', require('./verification-v2'));
app.use('/api', require('./media'));
app.use('/api', require('./payment-v2'));
app.use('/api', require('./financial'));
app.use('/api', require('./plan-release'));
app.use('/api', require('./private'));
app.use('/api/upload', require('./upload'));

app.use(seo);

const setUtf8 = (res) => { const ct = res.getHeader('Content-Type') || ''; if (ct && !/charset/i.test(ct)) res.setHeader('Content-Type', ct + '; charset=utf-8'); };
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js|json|svg)$/i.test(filePath)) setUtf8(res);
    if (/index\.html$|service-worker\.js$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    else if (/\.(css|js|json|webmanifest)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    else if (/\.(png|jpg|jpeg|webp|ico)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  },
}));

const PRIVATE_PATH = /^\/(admin|me|messages|wallet|booking|dashboard|favorites|verify|premium|business)(\/|$)/;
app.get('*', async (req, res, next) => {
  try {
    const p = (req.path || '/').split('?')[0].replace(/\/+$/, '') || '/';
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); if (PRIVATE_PATH.test(p)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    let r = prerender.routeFor(p); if (!r) r = await seo.listingRoute(p); if (!r) return res.sendFile(path.join(__dirname, '..', 'public', 'index.html')); if (r.noindex) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'); const url = prerender.CANON + p; const ogImage = r.ogImage || prerender.CANON + '/brand/gorenthive-mark.png';
    const out = shell.replace(/<title>.*?<\/title>/, `<title>${r.title}</title>`).replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${r.desc}">`).replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`).replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`).replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${r.title}">`).replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${r.desc}">`).replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${ogImage}">`).replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${r.title}">`).replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${r.desc}">`).replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${ogImage}">`).replace(/(<main class="page" id="app"[^>]*>)/, `$1\n${r.noscript || ''}`);
    res.send(out);
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => { console.error(`[${req.requestId || 'no-request-id'}]`, err); if (res.headersSent) return next(err); const status = err.status || 500; const message = status >= 500 && IS_PROD ? 'Server error' : (err.message || 'Server error'); res.status(status).json({ error: message, request_id: req.requestId }); });

const server = app.listen(PORT, () => console.log('GoRentHive running on port ' + PORT));
function shutdown(signal) { console.log(JSON.stringify({ type: 'shutdown', signal })); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); }
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
