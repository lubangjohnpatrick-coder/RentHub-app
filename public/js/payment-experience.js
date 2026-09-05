/* GoRentHive payment experience: authoritative booking draft + redirect recovery. */
(() => {
  'use strict';
  if (!window.Root || !window.API) return;

  function paymentMethodType(method) {
    return String(method || '').toLowerCase() === 'maya' ? 'paymaya' : 'gcash';
  }

  Root.runPayMongoIntent = async function runPayMongoIntentV2(intent, kind) {
    try {
      const cfg = await API.get('/paymongo/config');
      if (!cfg.enabled || !cfg.publicKey) throw new Error('PayMongo is not ready for payments.');
      const paymongo = await this.loadPayMongo(cfg.publicKey);
      if (!paymongo) throw new Error('Could not initialize PayMongo.');
      const method = paymentMethodType(intent.method || 'gcash');
      const paymentMethod = await paymongo.create('payment_method', { type: method });
      const result = await paymongo.attach({
        paymentIntentId: intent.intent_id,
        clientKey: intent.client_key,
        paymentMethod: paymentMethod.id,
        returnUrl: intent.return_url,
      });
      if (result && result.nextAction && result.nextAction.redirect && result.nextAction.redirect.url) {
        window.location.assign(result.nextAction.redirect.url);
        return { redirected: true, paid: false };
      }
      const confirmation = await API.post('/paymongo/confirm', { intent_id: intent.intent_id, payment_id: intent.payment_id });
      if (confirmation.status !== 'succeeded') return { redirected: false, paid: false, confirmation };
      return { redirected: false, paid: true, confirmation };
    } catch (e) {
      this.toast('Payment failed: ' + (e.message || 'unknown error'), 'error');
      return { redirected: false, paid: false, error: e };
    }
  };

  Root.tryPayBooking = async function tryPayBookingV2(total, bookBody) {
    try {
      const draft = bookBody && typeof bookBody === 'object' ? { ...bookBody } : null;
      if (!draft || !draft.listing_id || !draft.start_date || !draft.end_date) {
        throw new Error('Booking details are incomplete. Please choose the rental dates again.');
      }
      const cfg = await API.get('/paymongo/config');
      if (!cfg.enabled) {
        this.toast('Online booking payment is not available yet. Please try again later.', 'error');
        return false;
      }
      if (!confirm(`Your wallet needs ${fmtMoney(total)}. Continue to secure GCash payment?`)) return false;

      const intent = await API.post('/bookings/paymongo', {
        booking_draft: draft,
        method: 'gcash',
      });
      intent.method = 'gcash';

      // Non-production sandbox behavior remains available for local QA only.
      if (intent.sandbox) {
        const confirmation = await API.post('/paymongo/confirm', { intent_id: intent.intent_id, payment_id: intent.payment_id });
        if (confirmation.status !== 'succeeded') throw new Error('Sandbox payment did not settle.');
        const d = await API.request('POST', '/bookings', confirmation.booking_draft || draft, { idempotencyKey: this._bookingIdemKey });
        this.toast('Booking requested.', 'success');
        this.nav('/booking/' + d.booking.id);
        return true;
      }

      const result = await this.runPayMongoIntent(intent, 'booking');
      if (result.redirected) return true;
      if (!result.paid) return false;

      const recoveredDraft = result.confirmation && result.confirmation.booking_draft;
      const d = await API.request('POST', '/bookings', recoveredDraft || draft, { idempotencyKey: this._bookingIdemKey });
      this.toast('Payment confirmed and booking requested.', 'success');
      this.nav('/booking/' + d.booking.id);
      return true;
    } catch (e) {
      this.toast('Booking payment failed: ' + (e.message || 'unknown error'), 'error');
      return false;
    }
  };

  Root.handlePayMongoCallback = async function handlePayMongoCallbackV2(query) {
    const intentId = query && query.payment_intent_id;
    const kind = (query && query.kind) || 'topup';
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px"><div class="detail-card"><h3>Confirming payment</h3><p class="muted">Please keep this page open while GoRentHive verifies the payment with PayMongo.</p></div></div>`;
    try {
      if (!intentId) throw new Error('Payment reference is missing.');
      const confirmation = await API.post('/paymongo/confirm', { intent_id: intentId });
      if (confirmation.status !== 'succeeded') {
        this.$app.innerHTML = `<div class="wrap" style="padding-top:24px"><div class="detail-card"><h3>Payment still pending</h3><p class="muted">We have not received a successful payment confirmation yet. Your wallet will not be credited until PayMongo confirms it.</p><a class="btn btn-outline" href="/wallet">Back to wallet</a></div></div>`;
        return;
      }

      if (kind === 'booking' && confirmation.booking_draft) {
        const draft = confirmation.booking_draft;
        const idem = ['booking-paid', Root.state.user && Root.state.user.id, draft.listing_id, draft.start_date, draft.end_date, confirmation.payment_ref].filter(Boolean).join(':');
        try {
          const d = await API.request('POST', '/bookings', draft, { idempotencyKey: idem });
          this.toast('Payment confirmed and booking requested.', 'success');
          this.nav('/booking/' + d.booking.id);
          return;
        } catch (bookingError) {
          this.toast('Payment is safe in your wallet, but the booking could not be created: ' + bookingError.message, 'error', 6500);
          this.nav('/wallet');
          return;
        }
      }

      this.toast('Payment confirmed.', 'success');
      this.nav('/wallet');
    } catch (e) {
      this.$app.innerHTML = `<div class="wrap" style="padding-top:24px"><div class="detail-card"><h3>Payment confirmation needs attention</h3><p class="muted">${esc(e.message || 'Could not confirm payment')}</p><a class="btn btn-outline" href="/wallet">Back to wallet</a></div></div>`;
    }
  };
})();
