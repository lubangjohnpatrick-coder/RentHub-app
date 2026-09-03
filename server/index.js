'use strict';

// GoRentHive slim server.
// - Serves the static PWA (public/) — deploys locally or to any Node host.
// - Mounts the FINANCIAL API (server/financial.js) which is the only place
//   money moves, using the Supabase service-role key.
// All non-financial data is read/written by the browser directly against
// Supabase REST with the anon key (guarded by row-level security).

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const prerender = require('./prerender');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// PayMongo webhook must see the RAW body for signature verification, so it is
// registered before the global JSON parser.
const { handleWebhook } = require('./paymongo-webhook');
app.post('/api/paymongo/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json({ limit: '2mb' }));

// root health
app.get('/healthz', (req, res) => res.json({ ok: true, name: 'GoRentHive' }));

// Financial + private routes (require Supabase JWT; use service role)
app.use('/api', require('./financial'));
app.use('/api', require('./private'));
// Multipart photo upload -> Supabase Storage
app.use('/api/upload', require('./upload'));

// Static PWA
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback with server-side prerendering for public SEO routes (reviewer
// #3/#4/#22): known public pages get a meaningful <title>, meta description,
// canonical/OG tags and real <h1> content visible even with JS disabled.
app.get('*', (req, res) => {
  const p = (req.path || '/').split('?')[0].replace(/\/+$/, '') || '/';
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

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log('GoRentHive (Supabase) running on http://localhost:' + PORT);
});
