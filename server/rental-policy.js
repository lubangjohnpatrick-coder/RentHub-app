'use strict';

const AGREEMENT_VERSION = '2.0';
const DAY_MS = 24 * 60 * 60 * 1000;

function lateFeeRule(listing, booking) {
  const category = String((listing && (listing.category_name || listing.category_slug || listing.category)) || '').toLowerCase();
  const heavy = /heavy|excavator|backhoe|loader|bulldozer|crane|forklift/.test(category + ' ' + String(listing && listing.title || '').toLowerCase());
  const daily = Math.max(0, Number(booking.daily_rate_at_booking || (listing && listing.price_per_day) || 0));
  if (heavy) return { version: '1.0', kind: 'daily_rate_percent', percent: 20, label: '20% of daily rental rate per late day' };
  if (daily >= 5000 && daily <= 50000) return { version: '1.0', kind: 'daily_rate_percent', percent: 10, label: '10% of daily rental rate per late day' };
  return { version: '1.0', kind: 'fixed', amount: 100, label: '₱100 per late day' };
}

function calculateLateFee(booking, rule, returnedAt) {
  const due = Number(booking.end_date || 0);
  const returned = Number(returnedAt || Date.now());
  if (!due || returned <= due) return { days: 0, fee: 0 };
  const days = Math.max(1, Math.ceil((returned - due) / DAY_MS));
  const daily = Math.max(0, Number(booking.daily_rate_at_booking || 0));
  const perDay = rule.kind === 'daily_rate_percent'
    ? Math.round(daily * Number(rule.percent || 0) / 100)
    : Math.max(0, Number(rule.amount || 0));
  return { days, fee: days * perDay };
}

function agreementSnapshot({ booking, listing, renter, owner, rule }) {
  return {
    version: AGREEMENT_VERSION,
    booking_ref: booking.booking_ref,
    created_at: Date.now(),
    parties: {
      renter: { id: renter && renter.id, name: renter && renter.full_name },
      owner: { id: owner && owner.id, name: owner && owner.full_name },
    },
    item: {
      listing_id: listing && listing.id,
      title: listing && listing.title,
      serial_number: listing && listing.serial_number || '',
      accessories: listing && listing.accessories || '',
      condition: listing && listing.condition || '',
      rules: listing && listing.rules || '',
    },
    rental: {
      start_date: booking.start_date,
      end_date: booking.end_date,
      rental_days: booking.rental_days,
      daily_rate: booking.daily_rate_at_booking,
      rental_fee: booking.rental_fee,
      delivery_fee: booking.delivery_fee,
      security_deposit: booking.security_deposit,
      owner_commission_rate: booking.commission_rate_at_booking,
      owner_commission: booking.platform_fee,
      renter_total: booking.total_charged,
    },
    policies: {
      cancellation: listing && listing.cancellation_policy || 'standard',
      late_return: rule,
      damage: 'Condition evidence is recorded before and after the rental. Deposit deductions require renter acceptance or dispute resolution.',
      payment: 'Owner payout is released after the return is accepted or a dispute is resolved.',
    },
  };
}

function agreementText(snapshot) {
  const p = snapshot.parties, i = snapshot.item, r = snapshot.rental, pol = snapshot.policies;
  return [
    'GoRentHive Standard Rental Agreement v' + snapshot.version,
    'Booking: ' + snapshot.booking_ref,
    'Owner: ' + (p.owner.name || p.owner.id || ''),
    'Renter: ' + (p.renter.name || p.renter.id || ''),
    'Item: ' + (i.title || '') + (i.serial_number ? ' | Serial: ' + i.serial_number : ''),
    'Rental period: ' + new Date(r.start_date).toISOString() + ' to ' + new Date(r.end_date).toISOString(),
    'Daily rate: ₱' + r.daily_rate + ' | Rental fee: ₱' + r.rental_fee + ' | Security deposit: ₱' + r.security_deposit,
    'Owner commission: ' + r.owner_commission_rate + '% (₱' + r.owner_commission + '). The commission is deducted from owner earnings and is not an additional renter service fee.',
    'Late return: ' + pol.late_return.label + '.',
    'Cancellation policy: ' + pol.cancellation + '.',
    'Damage/return: ' + pol.damage,
    'Payment: ' + pol.payment,
    'By signing, both parties accept this booking-specific snapshot and the applicable GoRentHive terms.',
  ].join('\n');
}

module.exports = { AGREEMENT_VERSION, lateFeeRule, calculateLateFee, agreementSnapshot, agreementText };
