'use strict';

// Server auth middleware. The browser sends its Supabase access token
// (JWT) in the Authorization header. We verify it with Supabase and load the
// matching public.users row via the service-role client, then attach it to req.user.
// Supabase Auth is the source of truth for email confirmation. We reconcile
// that confirmation (plus signup phone/city metadata) into public.users so the
// marketplace verification UI cannot remain stale after a user confirms email.

const { svcClient, verifyToken } = require('./supabase');

async function loadUserById(id) {
  if (!id) return null;
  const { data, error } = await svcClient().from('users').select('*').eq('id', id).limit(1).single();
  if (error || !data) return null;
  return data;
}

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

async function reconcileAuthProfile(authUser, profile) {
  if (!authUser || !profile) return profile;
  let changed = false;

  // Email confirmation happens inside Supabase Auth. Mirror it into the
  // marketplace profile whenever an authenticated request proves it is done.
  if (authUser.email_confirmed_at && !profile.email_verified) {
    const { error } = await svcClient().from('users').update({
      email_verified: true,
      updated_at: Date.now(),
    }).eq('id', profile.id);
    if (!error) {
      profile.email_verified = true;
      changed = true;
    }
  }

  // Registration stores phone/city in Supabase user metadata. Older versions
  // of handle_new_user did not copy them into public.users, which made mobile
  // verification impossible because req.user.phone was blank.
  const metadata = authUser.user_metadata || {};
  const phone = cleanText(authUser.phone || metadata.phone);
  const city = cleanText(metadata.city);
  const patch = {};
  if (!cleanText(profile.phone) && phone) patch.phone = phone;
  if (!cleanText(profile.city) && city) patch.city = city;

  if (Object.keys(patch).length) {
    patch.updated_at = Date.now();
    const { error } = await svcClient().from('users').update(patch).eq('id', profile.id);
    if (!error) {
      Object.assign(profile, patch);
      changed = true;
    }
  }

  return changed ? profile : profile;
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const authUser = await verifyToken(token);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    let user = await loadUserById(authUser.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });

    user = await reconcileAuthProfile(authUser, user);
    if (user.suspended || user.banned) {
      return res.status(403).json({ error: 'This account has been restricted. Contact support.' });
    }
    req.user = user;
    req.authUser = authUser;
    req.accessToken = token;
    next();
  } catch (e) {
    res.status(500).json({ error: 'Auth error' });
  }
}

async function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, loadUserById, reconcileAuthProfile };
