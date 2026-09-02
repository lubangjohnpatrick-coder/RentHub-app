// GoRentHive API client (Supabase-backed).
//
// The browser talks to Supabase Auth directly (login/register/logout) and
// attaches the Supabase access token (JWT) to every request to the GoRentHive
// server. The server (server/financial.js + server/private.js) uses the
// service_role key against Supabase Postgres: it performs money movement and
// all privileged/aggregation work, and returns the same response shapes the
// app has always expected. Sensitive user fields (email, phone, wallet) and
// all financial writes are never exposed to/anonymously on the client.

const getApiBase = () => {
  const w = typeof window !== 'undefined' ? window : null;
  const storage = typeof localStorage !== 'undefined' ? localStorage : null;
  const candidates = [];

  const direct = w && (w.__GORENTHIVE_API_BASE__ || w.__RENTHUB_API_BASE__ || w.API_BASE_URL || w.GORENTHIVE_API_BASE);
  if (direct) candidates.push(String(direct).replace(/\/+$/, ''));

  const saved = storage && (storage.getItem('gorenthive_api_base') || storage.getItem('renthub_api_base'));
  if (saved) candidates.push(String(saved).replace(/\/+$/, ''));

  if (w && w.location && w.location.origin && w.location.origin !== 'file://') {
    candidates.push(w.location.origin.replace(/\/+$/, ''));
  }
  if (w && w.location && (w.location.hostname === 'localhost' || w.location.hostname === '127.0.0.1')) {
    candidates.push('http://localhost:4000');
    candidates.push('http://10.0.2.2:4000');
  }
  candidates.push('http://localhost:4000');
  candidates.push('http://10.0.2.2:4000');

  return candidates.find((v) => !!v && v.trim() !== '') || '';
};

const sb = () => (window.GORENTHIVE_SUPABASE && window.GORENTHIVE_SUPABASE.client) || null;

async function getAccessToken() {
  const c = sb();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    return (data && data.session && data.session.access_token) || null;
  } catch (e) {
    return null;
  }
}

// Map legacy login/register/logout to Supabase Auth. Returns normalized
// response objects so app.js keeps working.
const SupabaseAuth = {
  async login(body) {
    const c = sb();
    if (!c) throw new Error('Supabase not initialised');
    const identifier = body.email || body.phone || '';
    const { error } = await c.auth.signInWithPassword({ email: identifier, password: body.password });
    if (error) {
      if (error.message && /confirm|verif|not confirmed/i.test(error.message)) {
        throw new Error('Please confirm your email address first (check your inbox).');
      }
      if (error.status >= 400 && error.status < 500) throw new Error(error.message || 'Invalid credentials');
      throw new Error(error.message || 'Login failed');
    }
    const m = await me();
    return { user: (m && m.user) ? m.user : null };
  },
  async register(body) {
    const c = sb();
    if (!c) throw new Error('Supabase not initialised');
    if (!body.email || !String(body.email).includes('@')) {
      throw new Error('Registration requires a valid email address.');
    }
    const md = { sent: false, needsConfirm: false };
    const { data, error } = await c.auth.signUp({
      email: body.email,
      password: body.password,
      options: { data: { full_name: body.full_name || '', phone: body.phone || '', city: body.city || '' } },
    });
    if (error) {
      const status = error.status || 0;
      if (status === 422 || /already registered|already exists/i.test(error.message)) {
        throw new Error('That email is already registered. Please log in.');
      }
      if (status >= 400 && status < 500) throw new Error(error.message || 'Unable to register');
      throw new Error(error.message || 'Unable to register');
    }
    // Profile row will be created by the Supabase trigger (handle_new_user).
    if (data.session && data.session.access_token) {
      const u = await me();
      return { user: (u && u.user) ? u.user : { id: data.user && data.user.id, full_name: body.full_name, email: body.email, is_owner: false, role: 'user' } };
    }
    // Email confirmation required
    md.needsConfirm = true;
    md.sent = true;
    return { user: { id: data.user && data.user.id, full_name: body.full_name, email: body.email, is_owner: false, role: 'user', needsEmailConfirm: true } };
  },
  async logout() {
    const c = sb();
    if (c) { try { await c.auth.signOut(); } catch (e) {} }
    return { ok: true };
  },
};

// Load the current profile from the server (attaches the token). Returns the
// server's /auth/me payload or null.
async function me() {
  const c = sb();
  if (!c) return { user: null };
  const token = await getAccessToken();
  if (!token) return { user: null };
  try {
    const res = await serverRequest('/api/auth/me', { method: 'GET', token });
    return res;
  } catch (e) {
    return { user: null };
  }
}

async function serverRequest(target, { method = 'GET', body, token } = {}) {
  const base = getApiBase() || (window.location.origin !== 'file://' ? window.location.origin : 'http://localhost:4000');
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(base + target, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      try { await sb()?.auth?.signOut(); } catch (e) {}
      if (typeof window !== 'undefined' && window.location && window.location.pathname !== '/login') {
        try { window.location.hash = '#/login'; } catch (e) {}
      }
      const err = new Error('Not authenticated');
      err.status = 401;
      err.code = data.code;
      throw err;
    }
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

const API = {
  async request(method, url, body) {
    const token = await getAccessToken();

    // Auth endpoints -> Supabase Auth
    if (url === '/auth/login' && method === 'POST') return SupabaseAuth.login(body);
    if (url === '/auth/register' && method === 'POST') return SupabaseAuth.register(body);
    if (url === '/auth/logout' && method === 'POST') return SupabaseAuth.logout();
    if (url === '/auth/me' && method === 'GET') {
      return (await me()) || { user: null };
    }

    // Everything else -> GoRentHive server (service_role against Supabase)
    return serverRequest('/api' + url, { method, body, token });
  },
  get: (url) => API.request('GET', url, undefined),
  post: (url, body) => API.request('POST', url, body || {}),
  put: (url, body) => API.request('PUT', url, body || {}),
  del: (url) => API.request('DELETE', url, undefined),
};

const fmtMoney = (n) => '₱' + Number(n || 0).toLocaleString('en-PH');
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};
const stars = (r) => {
  const n = Math.round(Number(r || 0));
  return '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - Math.min(5, n)));
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.API = API;
window.SupabaseAuth = SupabaseAuth;
window.__getAccessToken = getAccessToken;
