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
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log('GoRentHive (Supabase) running on http://localhost:' + PORT);
});
