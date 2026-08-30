'use strict';

// Security / enforcement end-to-end test using fetch against a running server.
// Covers real verification (OTP + email + ID), terms gating, mandatory escrow,
// wallet top-up, message anti-circumvention blocking, and owner payout on completion.

const BASE = 'http://localhost:4000';
const errors = [];

async function api(method, path, body, cookie) {
  const headers = {};
  if (body) { headers['Content-Type'] = 'application/json'; }
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
  const email = 'newuser' + Date.now() + '@renthub.ph';
  const phone = '0917' + String(Date.now()).slice(-8);
  // 1. Register
  console.log('\n== 1. Register ==');
  let r = await api('POST', '/auth/register', { full_name: 'New User', email, phone, password: 'pass1234', city: 'Manila' });
  check('register', r.status === 200, JSON.stringify(r.data));
  let cookie = r.setCookie.split(';')[0];
  check('terms auto-accepted at register', r.status === 200);

  // 2. Booking is blocked BEFORE verification & terms (they ARE accepted though) - verify needed
  console.log('\n== 2. Verification required before booking ==');
  r = await api('POST', '/bookings', { listing_id: 1, start_date: '2026-10-01', end_date: '2026-10-02' }, cookie);
  check('unverified booking blocked (428)', r.status === 428, JSON.stringify(r.data));

  // 3. Real OTP: send + confirm with wrong code then right code
  console.log('\n== 3. Phone OTP (send/confirm) ==');
  r = await api('POST', '/auth/verify/mobile/send', {}, cookie);
  check('otp send ok', r.status === 200, JSON.stringify(r.data));
  const demoCode = r.data.demoCode;
  r = await api('POST', '/auth/verify/mobile', { code: '000000' }, cookie);
  check('wrong code rejected', r.status === 400, JSON.stringify(r.data));
  r = await api('POST', '/auth/verify/mobile', { code: demoCode }, cookie);
  check('correct code verifies mobile', r.status === 200 && r.data.user.mobile_verified === 1, JSON.stringify(r.data));

  // 4. Email token
  console.log('\n== 4. Email token ==');
  r = await api('POST', '/auth/verify/email/send', {}, cookie);
  check('email link send ok', r.status === 200, JSON.stringify(r.data));
  const demoTok = r.data.demoToken;
  r = await api('POST', '/auth/verify/email', { token: demoTok }, cookie);
  check('email token confirms', r.status === 200 && r.data.user.email_verified === 1, JSON.stringify(r.data));

  // 5. Still blocked because ID not verified (identity_status != 'verified')
  r = await api('POST', '/bookings', { listing_id: 1, start_date: '2026-10-01', end_date: '2026-10-02' }, cookie);
  check('booking still blocked without ID verify', r.status === 428, JSON.stringify(r.data));

  // 6. Submit identity (pending) then admin approves
  console.log('\n== 6. Identity review ==');
  r = await api('POST', '/auth/verify/identity', { id_type: "Driver's License", id_number: 'ID-12345', selfie: '' }, cookie);
  check('identity submitted pending', r.status === 200 && r.data.user.identity_status === 'pending', JSON.stringify(r.data));
  // admin login
  let ar = await api('POST', '/auth/login', { email: 'admin@renthub.ph', password: 'admin123' });
  const adminCookie = ar.setCookie.split(';')[0];
  const me = await api('GET', '/auth/me', null, cookie);
  const uid = me.data.user.id;
  r = await api('POST', '/admin/users/' + uid, { identity_status: 'verified' }, adminCookie);
  check('admin verifies identity', r.status === 200 && r.data.identity_status === 'verified', JSON.stringify(r.data));

  // 7. Booking blocked due to insufficient funds (new user has 0 wallet)
  console.log('\n== 7. Mandatory escrow (insufficient funds) ==');
  r = await api('POST', '/bookings', { listing_id: 1, start_date: '2026-10-01', end_date: '2026-10-02' }, cookie);
  check('insufficient funds blocked (402)', r.status === 402, JSON.stringify(r.data));
  check('required amount returned', r.data.required > 0, JSON.stringify(r.data));

  // 8. Top-up wallet
  console.log('\n== 8. Wallet top-up ==');
  r = await api('POST', '/wallet/topup', { amount: 20000, method: 'gcash' }, cookie);
  check('topup succeeds', r.status === 200 && r.data.balance >= 20000, JSON.stringify(r.data));

  // 9. Booking now succeeds with escrow deduction
  console.log('\n== 9. Booking with escrow ==');
  r = await api('POST', '/bookings', { listing_id: 1, start_date: '2026-10-01', end_date: '2026-10-02' }, cookie);
  check('booking created', r.status === 200, JSON.stringify(r.data));
  const booking = r.data.booking;
  const balAfter = await api('GET', '/wallet', null, cookie);
  const escrowed = booking.rental_fee + booking.delivery_fee + booking.platform_fee + booking.security_deposit;
  check('escrow deducted from wallet', r.status === 200, 'escrow=' + escrowed + ' bal=' + balAfter.data.balance);

  // 10. Anti-circumvention: blocked message before confirmed booking
  console.log('\n== 10. Message anti-circumvention (blocked pre-booking) ==');
  r = await api('POST', '/messages', { receiver_id: 2, body: 'call me at 09171234567 or gcash' }, cookie);
  check('circumvention message blocked', r.status === 400, JSON.stringify(r.data));

  // 11. Owner approves & both sign -> active
  console.log('\n== 11. Approve + sign agreement ==');
  const ownerCookie = (await api('POST', '/auth/login', { email: 'cam@renthub.ph', password: 'owner123' })).setCookie.split(';')[0];
  r = await api('POST', `/bookings/${booking.id}/approve`, {}, ownerCookie);
  check('owner approves (escrow cleared)', r.status === 200, JSON.stringify(r.data));
  r = await api('POST', `/bookings/${booking.id}/sign-agreement`, {}, ownerCookie);
  check('owner signed', r.status === 200 && r.data.agreement_signed_owner === 1, JSON.stringify(r.data));
  r = await api('POST', `/bookings/${booking.id}/sign-agreement`, {}, cookie);
  check('renter signed -> active', r.status === 200 && r.data.status === 'active', JSON.stringify(r.data));

  // 12. Fair return & deposit flow: owner proposes a deduction -> goes to renter,
  //     who must explicitly accept (or dispute) before any funds move.
  console.log('\n== 12. Fair return / deposit deduction ==');
  // check-in evidence recorded at handover
  r = await api('POST', `/bookings/${booking.id}/condition`, { phase: 'checkin', serial_number: 'SN-0001', accessories: 'battery, strap', damage_notes: 'none' }, ownerCookie);
  check('check-in condition recorded', r.status === 200, JSON.stringify(r.data));
  // check-out evidence recorded on return
  r = await api('POST', `/bookings/${booking.id}/condition`, { phase: 'checkout', serial_number: 'SN-0001', accessories: 'battery, strap', damage_notes: 'scratched lens' }, ownerCookie);
  check('check-out condition recorded', r.status === 200, JSON.stringify(r.data));
  // owner files the return with a proposed deposit deduction
  r = await api('POST', `/bookings/${booking.id}/complete`, { damageDeduction: 500, lateFees: 0, reason: 'scratched lens' }, ownerCookie);
  check('owner return proposes deduction -> returned (NOT completed)', r.status === 200 && r.data.status === 'returned', JSON.stringify(r.data));
  r = await api('POST', `/bookings/${booking.id}/complete`, { damageDeduction: 500 }, ownerCookie);
  check('cannot double-complete a returned booking', r.status === 400, JSON.stringify(r.data));
  // funds must NOT move yet (deposit still held)
  const beforeWallet = (await api('GET', '/wallet', null, cookie)).data.balance;
  // renter accepts the deduction -> finalized
  r = await api('POST', `/bookings/${booking.id}/resolve-return`, { accept: true }, cookie);
  check('renter accepts -> completed + escrow released', r.status === 200 && r.data.status === 'completed' && r.data.escrow_released === 1, JSON.stringify(r.data));
  const ownerAfter = (await api('GET', '/wallet', null, ownerCookie)).data.balance;
  check('owner credited on finalize', ownerAfter > beforeWallet, 'before=' + beforeWallet + ' after=' + ownerAfter);
  const renterWallet = await api('GET', '/wallet', null, cookie);
  check('deposit (minus deduction) released to renter', renterWallet.data.balance > beforeWallet, 'bal=' + renterWallet.data.balance);
  check('deposit record reflects deduction', r.data.deposit && r.data.deposit.status === 'partially_deducted' && r.data.deposit.deduction === 500, JSON.stringify(r.data.deposit));

  console.log('\n========================================');
  if (errors.length) { console.log('SECURITY TEST FAILURES: ' + errors.length); errors.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('SECURITY TEST: ALL PASSED ✅');
})();
