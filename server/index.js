'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const prerender = require('./prerender');

const app = express();
const PORT = process.env.PORT || 4000;
const SITE_HOST = process.env.CANON_HOST || 'gorenthive.online';

app.use((req, res, next) => {
  const host = (req.get('host') || '').toLowerCase();
  if (host === 'www.' + SITE_HOST || host === 'www.' + SITE_HOST + ':443') return res.redirect(301, 'https://' + SITE_HOST + req.originalUrl);
  next();
});

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const { handleWebhook } = require('./paymongo-webhook');
app.post('/api/paymongo/webhook', express.raw({ type: 'application/json' }), handleWebhook);
app.use(express.json({ limit: '2mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true, name: 'GoRentHive' }));

app.use('/api', require('./no-delivery'));
app.use('/api', require('./location'));
app.use('/api', require('./financial'));
app.use('/api', require('./private'));
app.use('/api', require('./launch-hardening'));
app.use('/api/upload', require('./upload'));

const setUtf8 = (res) => {
  const ct = res.getHeader('Content-Type') || '';
  if (ct && !/charset/i.test(ct)) res.setHeader('Content-Type', ct + '; charset=utf-8');
};
app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders: (res, filePath) => {
  if (/\.(html|css|js|json|svg)$/i.test(filePath)) setUtf8(res);
}}));

app.get('*', (req, res) => {
  const p = (req.path || '/').split('?')[0].replace(/\/+$/, '') || '/';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
    .replace(/(<main class="page" id="app">)/, `$1\n${r.noscript}`);
  res.send(out);
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') && res.getHeader('Content-Type') == null) res.type('html');
  next();
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => console.log('GoRentHive (Supabase) running on http://localhost:' + PORT));
