// GoRentHive — Supabase client (browser). anon key only.
// The service_role key is NEVER used on the client. All writes to guarded
// tables are done by the GoRentHive server (financial.js / private.js).
const GORENTHIVE_SUPABASE = (() => {
  const url = window.__GORENTHIVE_SUPABASE_URL__ || 'https://tdztzjetxnjqwvgolpvz.supabase.co';
  const anon = window.__GORENTHIVE_SUPABASE_ANON_KEY__ || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkenR6amV0eG5qcXd2Z29scHZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwOTQyNDYsImV4cCI6MjEwMzY3MDI0Nn0.8nv6abCgUtKwyeXExzgHo1egfvSYSmfcKPxngBKqCY8';
  let client = null;
  try {
    client = window.supabase && window.supabase.createClient
      ? window.supabase.createClient(url, anon, { auth: { storageKey: 'gorenthive-auth', autoRefreshToken: true, persistSession: true } })
      : null;
  } catch (e) {
    client = null;
  }
  return { url, anon, client, ready: !!client };
})();

window.GORENTHIVE_SUPABASE = GORENTHIVE_SUPABASE;
