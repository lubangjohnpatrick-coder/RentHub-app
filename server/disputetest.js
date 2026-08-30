'use strict';
// Fair-return DISPUTE path test (pure Node http, managed cookies):
// renter disputes -> disputed -> admin resolves -> escrow finalized fairly.
const BASE = 'http://localhost:4000';
const errors = [];

async function api(method, path, body, cookie) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') || '' };
}
function check(label, cond, detail) {
  if (cond) console.log('  ✓ ' + label);
  else { errors.push(label + (detail ? ' :: ' + detail : '')); console.log('  ✗ ' + label + (detail ? ' :: ' + detail : '')); }
}

(async () => {
  // login renter + owner + admin via managed cookies
  const mia = (await api('POST', '/auth/login', { email: 'mia@renthub.ph', password: 'renter123' })).setCookie.split(';')[0];
  const cam = (await api('POST', '/auth/login', { email: 'cam@renthub.ph', password: 'owner123' })).setCookie.split(';')[0];
  const admin = (await api('POST', '/auth/login', { email: 'admin@renthub.ph', password: 'admin123' })).setCookie.split(';')[0];

  // Seed a fresh escrowed booking for the dispute scenario (cam listing 1, mia rents)
  const sd = new Date(); sd.setDate(sd.getDate() + 14);
  const ed = new Date(sd); ed.setDate(ed.getDate() + 1);
  const f = (d) => d.toISOString().split('T')[0];
  let r = await api('POST', '/bookings', { listing_id: 1, start_date: f(sd), end_date: f(ed) }, mia);
  check('booked listing 1', r.status === 200, JSON.stringify(r.data));
  const bid = r.data.booking.id;
  await new Promise((s) => setTimeout(s, 600)); // let async escrow charge 'clear'
  r = await api('POST', `/bookings/${bid}/approve`, {}, cam);
  check('owner approved', r.status === 200, JSON.stringify(r.data));
  r = await api('POST', `/bookings/${bid}/sign-agreement`, {}, cam);
  check('owner signed', r.status === 200 && r.data.agreement_signed_owner === 1, JSON.stringify(r.data));
  r = await api('POST', `/bookings/${bid}/sign-agreement`, {}, mia);
  check('renter signed -> active', r.status === 200 && r.data.status === 'active', JSON.stringify(r.data));

  // evidence + owner proposes a deduction
  r = await api('POST', `/bookings/${bid}/condition`, { phase: 'checkin', damage_notes: 'none' }, cam);
  check('checkin recorded', r.status === 200, JSON.stringify(r.data));
  r = await api('POST', `/bookings/${bid}/condition`, { phase: 'checkout', damage_notes: 'dent' }, cam);
  check('checkout recorded', r.status === 200, JSON.stringify(r.data));
  r = await api('POST', `/bookings/${bid}/complete`, { damageDeduction: 500, lateFees: 30, reason: 'dent found' }, cam);
  check('owner return proposes deduction -> returned', r.status === 200 && r.data.status === 'returned', JSON.stringify(r.data));

  // renter DISPUTES (not accept)
  r = await api('POST', `/bookings/${bid}/resolve-return`, { accept: false }, mia);
  check('renter disputes -> disputed', r.status === 200 && r.data.status === 'disputed', JSON.stringify(r.data));
  check('dispute row created', !!r.data.dispute && r.data.dispute.status === 'open', JSON.stringify(r.data.dispute));
  const disputeId = r.data.dispute.id;

  // no funds move while disputed
  const wBefore = (await api('GET', '/wallet', null, mia)).data.balance;

  // admin resolves with a decided deduction
  r = await api('POST', `/admin/disputes/${disputeId}`, { status: 'resolved', resolution: 'Owner proved damage, 200 kept', finalDepositDeduction: 200 }, admin);
  check('admin resolves dispute', r.status === 200, JSON.stringify(r.data));

  // verify finalized fairly
  const fin = (await api('GET', `/bookings/${bid}`, null, mia)).data;
  check('booking finalized -> completed', fin.status === 'completed', 'status=' + fin.status);
  check('escrow released', fin.escrow_released === 1, 'released=' + fin.escrow_released);
  check('deposit settled at admin-decided 200 deduction', fin.deposit && fin.deposit.status === 'partially_deducted' && fin.deposit.deduction === 200, JSON.stringify(fin.deposit));
  check('late fee 30 applied', fin.late_fee === 30, 'late_fee=' + fin.late_fee);
  const wAfter = (await api('GET', '/wallet', null, mia)).data.balance;
  const expected = 2000 - 200; // deposit 2000 minus 200 deduction
  check('renter received deposit (minus decided deduction): +' + (wAfter - wBefore), Math.abs((wAfter - wBefore) - expected) <= 2, 'delta=' + (wAfter - wBefore));

  console.log('\n========================================');
  if (errors.length) { console.log('DISPUTE TEST FAILURES: ' + errors.length); errors.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('DISPUTE TEST: ALL PASSED ✅');
})();
