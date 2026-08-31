'use strict';

// Server auth middleware. The browser sends its Supabase access token
// (JWT) in the Authorization header. We verify it with Supabase and load the
// matching public.users row via the service-role client, then attach it to req.user.

const { svcClient, verifyToken } = require('./supabase');

async function loadUserById(id) {
  if (!id) return null;
  const { data, error } = await svcClient().from('users').select('*').eq('id', id).limit(1).single();
  if (error || !data) return null;
  return data;
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const authUser = await verifyToken(token);
    if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
    const user = await loadUserById(authUser.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    if (user.suspended || user.banned) {
      return res.status(403).json({ error: 'This account has been restricted. Contact support.' });
    }
    req.user = user;
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

module.exports = { requireAuth, requireAdmin, loadUserById };
