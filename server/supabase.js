'use strict';

// Server-side Supabase client.
// Uses the service_role key so this (server-only) code can write financial
// rows and bypass row-level security. NEVER import this from the browser,
// and NEVER commit the service role key. It lives only in server/.env.

const { createClient } = require('@supabase/supabase-js');

function getConfig() {
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_REST_URL?.replace(/\/rest\/v1$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('SUPABASE_URL (or SUPABASE_REST_URL) is not set in server/.env');
  const currentUrl = String(url).replace(/\/rest\/v1$/, '').replace(/\/$/, '');
  return { url: currentUrl, serviceKey: serviceKey || anonKey, anonKey };
}

let svc = null;
let anon = null;

// Service-role client — full DB access, bypasses RLS. Server only.
function svcClient() {
  if (svc) return svc;
  const { url, serviceKey } = getConfig();
  if (!serviceKey || serviceKey === 'your-service-role-key' || serviceKey === 'your-project-anon-key') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured in server/.env');
  }
  svc = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return svc;
}

// Anon client — used rarely server-side for read paths that RLS allows.
function anonClient() {
  if (anon) return anon;
  const { url, anonKey } = getConfig();
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY is not set in server/.env');
  anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return anon;
}

// Find a client that can verify a user token. Prefer the anon key (least
// privilege), but fall back to the service-role client so verification still
// works even when SUPABASE_ANON_KEY is missing/unset in the deploy env.
function getVerifyClient() {
  const { anonKey } = getConfig();
  if (anonKey) {
    try { return anonClient(); } catch (e) { /* fall through to service */ }
  }
  return svcClient();
}

// Verify a Supabase access token (JWT) and return its auth user id, or null.
async function verifyToken(token) {
  if (!token) return null;
  try {
    const { data, error } = await getVerifyClient().auth.getUser(token);
    if (error) return null;
    return data.user || null;
  } catch (e) {
    return null;
  }
}

module.exports = { svcClient, anonClient, verifyToken };
