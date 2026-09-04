/* GoRentHive launch-ready UI overrides — loaded after app.js + location hardening. */
(() => {
  if (!window.Root || !window.API) return;

  const oldApplyExplore = Root.applyExplore ? Root.applyExplore.bind(Root) : null;
  const oldBookingDetail = Root.viewBookingDetail ? Root.viewBookingDetail.bind(Root) : null;
  const oldLegal = Root.viewLegal ? Root.viewLegal.bind(Root) : null;
  const oldLedgerLabel = Root.ledgerLabel ? Root.ledgerLabel.bind(Root) : null;

  Root.launchSearch = function () {
    const q = (document.getElementById('launch-q')?.value || '').trim();
    const radius = document.getElementById('launch-radius')?.value || '10';
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    p.set('radius', radius);
    this.nav('/explore?' + p.toString());
  };

  Root.viewHome = async function () {
    const cats = (this.state.categories || []).slice(0, 8);
    this.setMeta(
      'GoRentHive | Rent What You Need. Earn From What You Own.',
      'Find verified nearby rentals by radius in the Philippines, or earn from items you already own. Protected payments, agreements and condition documentation.',
      '/'
    );
    this.$app.innerHTML = `
      <section class="hero launch-hero">
        <div class="wrap hero-grid">
          <div>
            <span class="hero-eyebrow">🐝 Philippine peer-to-peer rental marketplace</span>
            <h1>Rent what you need.<br><span>Earn from what you own.</span></h1>
            <p class="sub">Find useful items from verified people near you using radius-based search. Owners can turn idle equipment, gear and everyday assets into extra income.</p>
            <div class="hero-ctas">
              <a class="btn btn-primary btn-lg" href="/explore">🔍 Explore rentals</a>
              <a class="btn btn-outline-light btn-lg" href="/list">＋ List your item</a>
            </div>
            <div class="hero-trust-strip">
              <span class="ts-item"><b>✓</b> Verified accounts</span>
              <span class="ts-item"><b>⌖</b> GPS radius search</span>
              <span class="ts-item"><b>🔒</b> Protected payments</span>
              <span class="ts-item"><b>📄</b> Digital agreements</span>
            </div>
          </div>
          <div class="hero-visual" aria-hidden="true">
            <div class="hv-card hv-c1"><em style="--hvc:#E8920C">🛠️</em>Tools & equipment</div>
            <div class="hv-card hv-c2"><em style="--hvc:#2F6FED">📷</em>Cameras & gear</div>
            <div class="hv-card hv-c3"><em style="--hvc:#22A06B">🎉</em>Events & occasions</div>
            <div class="hv-badge"><b>⌖</b> Search by verified radius</div>
          </div>
        </div>
        <div class="wrap">
          <div class="search-card launch-search-card">
            <div class="field"><label>What do you need?</label><input id="launch-q" placeholder="Camera, tent, drill, projector…" onkeydown="if(event.key==='Enter')Root.launchSearch()"></div>
            <div class="field"><label>Search radius</label><select id="launch-radius"><option value="5">Within 5 km</option><option value="10" selected>Within 10 km</option><option value="25">Within 25 km</option><option value="50">Within 50 km</option></select></div>
            <div class="field launch-location-note"><label>Location</label><div class="verified-location-hint">📍 Uses your current verified GPS location</div></div>
            <button class="search-btn" onclick="Root.launchSearch()">SEARCH →</button>
          </div>
        </div>
      </section>

      <div class="wrap">
        <section class="section">
          <div class="section-head"><div><h2>Browse rental categories</h2><p class="section-sub">Start with what you need—not what you have to buy.</p></div><a class="more" href="/categories">View all →</a></div>
          <div class="cat-grid">${cats.length ? cats.map(c => `<a class="cat-card" href="/explore?category=${c.id}"><div class="ic" style="background:var(--brand-soft)">${c.icon || '📦'}</div><div><div class="nm">${esc(c.name)}</div><div class="ct">Browse nearby</div></div></a>`).join('') : `
            <a class="cat-card" href="/explore?q=tools"><div class="ic">🛠️</div><div><div class="nm">Construction & Industrial</div><div class="ct">Tools and equipment</div></div></a>
            <a class="cat-card" href="/explore?q=party"><div class="ic">🎉</div><div><div class="nm">Party & Events</div><div class="ct">Chairs, tents, sound</div></div></a>
            <a class="cat-card" href="/explore?q=camera"><div class="ic">📷</div><div><div class="nm">Photo & Video</div><div class="ct">Cameras and action cams</div></div></a>
            <a class="cat-card" href="/explore?q=vehicle"><div class="ic">🚗</div><div><div class="nm">Vehicles</div><div class="ct">Cars, vans and more</div></div></a>`}</div>
        </section>

        <section class="section">
          <div class="ownbanner launch-owner-banner">
            <div><div class="eyebrow-light">OWN SOMETHING PEOPLE NEED?</div><h2>Don't let useful things sit idle.</h2><p>Set your own rental price, availability and rules. GoRentHive deducts an 8% commission only from completed rental earnings.</p></div>
            <a class="btn btn-primary btn-lg" href="/list">List an item</a>
          </div>
        </section>

        <section class="section">
          <div class="section-head"><h2>How a protected rental works</h2></div>
          <div class="launch-steps">
            <div class="launch-step"><span>1</span><h3>Search nearby</h3><p>Use a verified GPS location and choose your preferred radius.</p></div>
            <div class="launch-step"><span>2</span><h3>Request & agree</h3><p>Choose dates. Owner approves and both parties accept the booking-specific rental agreement.</p></div>
            <div class="launch-step"><span>3</span><h3>Document handover</h3><p>Owner uploads pre-rental condition photos. Renter reviews them before confirming receipt.</p></div>
            <div class="launch-step"><span>4</span><h3>Return & review</h3><p>Renter uploads return photos. Deposit and owner payout are released after acceptance or dispute resolution.</p></div>
          </div>
          <div class="launch-notice">🚚 <b>Handover:</b> GoRentHive does not operate a delivery service. Owner and renter arrange pickup or a safe meetup themselves.</div>
        </section>
      </div>`;
  };

  Root.viewPricing = function () {
    this.setMeta('Pricing & Fees | GoRentHive', 'GoRentHive owner plans: Basic free, Pro ₱499/month and Business ₱999/month, plus an 8% commission on completed rental earnings.', '/pricing');
    this.$app.innerHTML = `<div class="landing-hero"><div class="wrap">
      <span class="hero-eyebrow">🐝 Simple, transparent pricing</span>
      <h1>Start free. <span>Upgrade when it pays.</span></h1>
      <p class="sub">Every account can rent and list. Paid memberships are for users who need more tools to grow their rental activity.</p>
    </div></div>
    <div class="wrap"><section class="section">
      <div class="pricing-grid launch-pricing-grid">
        <article class="price-card"><div class="plan">Basic</div><div class="price">Free</div><p>For casual owners and new users.</p><ul><li>✓ Up to 15 active listings</li><li>✓ Protected booking flow</li><li>✓ Digital rental agreements</li><li>✓ Condition photo documentation</li><li>✓ ₱10 per additional active listing above the free limit</li></ul><a class="btn btn-outline btn-block" href="/register">Create free account</a></article>
        <article class="price-card featured"><div class="price-badge">POPULAR</div><div class="plan">Pro</div><div class="price">₱499<span>/month</span></div><p>For active individual owners.</p><ul><li>✓ Higher/unlimited listing allowance</li><li>✓ Owner analytics & calendar tools</li><li>✓ Better inventory management</li><li>✓ Priority listing tools</li><li>✓ Everything in Basic</li></ul><a class="btn btn-primary btn-block" href="/register">Start with GoRentHive</a></article>
        <article class="price-card"><div class="plan">Business</div><div class="price">₱999<span>/month</span></div><p>For rental businesses and larger inventories.</p><ul><li>✓ Business storefront</li><li>✓ Advanced inventory controls</li><li>✓ Business analytics</li><li>✓ Staff/operations-ready tools as released</li><li>✓ Everything in Pro</li></ul><a class="btn btn-outline btn-block" href="/register">Create business account</a></article>
      </div>
      <div class="launch-fee-box"><h2>Marketplace commission</h2><p><b>8% of the rental amount</b> is deducted from the owner's rental earnings after a completed rental. The refundable security deposit is not GoRentHive revenue. Renters are not charged this 8% owner commission on top of the rental price.</p></div>
    </section></div>`;
  };

  Root.viewTrustSafety = function () {
    this.setMeta('Trust & Safety | GoRentHive', 'Verified accounts, GPS radius search, protected payments, booking-specific agreements and before/after condition evidence.', '/trust-safety');
    this.$app.innerHTML = `<div class="landing-hero"><div class="wrap"><span class="hero-eyebrow">🛡️ Trust & Safety</span><h1>Protection built into <span>every booking.</span></h1><p class="sub">GoRentHive combines identity checks, payment controls, agreements and evidence so disputes are based on records—not just claims.</p></div></div>
    <div class="wrap"><section class="section"><div class="launch-safety-grid">
      <article><b>✅ Verified accounts</b><p>Email, mobile and identity verification can be required based on item risk.</p></article>
      <article><b>⌖ Verified-radius location</b><p>Nearby search uses a recent device GPS fix with an accuracy threshold. Typed coordinates are not treated as verified.</p></article>
      <article><b>🔒 Protected payment flow</b><p>Owner earnings are released after the rental return is accepted or a dispute is resolved. GoRentHive does not describe this as regulated escrow.</p></article>
      <article><b>📄 Booking-specific agreement</b><p>Each approved booking snapshots the parties, item, dates, price, deposit and applicable policies before signing.</p></article>
      <article><b>📷 Condition evidence</b><p>Owner documents the item before handover; renter documents it on return. The counterparty confirms or disputes the evidence.</p></article>
      <article><b>⚖️ Dispute controls</b><p>Damage and return disputes can stop release of the relevant funds until the case is reviewed.</p></article>
    </div><div class="launch-notice">Privacy note: exact GPS coordinates are used for matching and should not be exposed publicly on marketplace cards.</div></section></div>`;
  };

  Root.viewHowItWorks = function () {
    this.setMeta('How GoRentHive Works | GoRentHive', 'Search by verified radius, request a rental, sign the agreement, document handover and return, then release payment after completion.', '/how-it-works');
    this.$app.innerHTML = `<div class="landing-hero"><div class="wrap"><span class="hero-eyebrow">🐝 How it works</span><h1>A clear flow from <span>request to return.</span></h1></div></div><div class="wrap"><section class="section"><div class="launch-timeline">
      <div><b>1. Find</b><p>Search items near your current verified location by radius.</p></div>
      <div><b>2. Request</b><p>Select dates. GoRentHive calculates the rental and refundable deposit server-side.</p></div>
      <div><b>3. Approve & sign</b><p>The owner approves. Both parties accept the booking-specific digital rental agreement.</p></div>
      <div><b>4. Document handover</b><p>Owner uploads at least four clear condition photos and identifying details. Renter reviews and confirms before the rental becomes active.</p></div>
      <div><b>5. Rent</b><p>Owner and renter arrange pickup or meetup. GoRentHive does not provide delivery.</p></div>
      <div><b>6. Return</b><p>Renter uploads return photos. Owner confirms the condition or opens a damage dispute.</p></div>
      <div><b>7. Complete</b><p>Owner earnings and the refundable deposit are resolved according to the accepted return or dispute decision.</p></div>
    </div></section></div>`;
  };

  Root.viewLegal = function (id) {
    if (id !== 'rental_agreement') return oldLegal ? oldLegal(id) : undefined;
    this.setMeta('Rental Agreement | GoRentHive', 'GoRentHive standard rental-agreement framework covering parties, item condition, rental period, deposits, late return and dispute handling.', '/legal/rental_agreement');
    this.$app.innerHTML = `<div class="wrap"><section class="section legal-page"><div class="detail-card legal-box launch-legal">
      <h1>GoRentHive Standard Rental Agreement</h1>
      <p class="legal-lead">Each confirmed booking generates its own agreement snapshot. The booking-specific document—not this overview—contains the exact parties, item, dates and financial amounts accepted for that rental.</p>
      <h2>1. Parties and item</h2><p>The agreement identifies the verified owner and renter, listing, item description, serial/asset number when applicable, included accessories and documented condition.</p>
      <h2>2. Rental period and payment</h2><p>The agreement records the start and due dates, daily or booking rate, rental amount, refundable security deposit and the owner-side GoRentHive commission applicable at booking.</p>
      <h2>3. Condition documentation</h2><p>Before handover, the owner must submit clear front, back and side photographs, identifying/serial information when applicable, accessories and existing damage. The renter reviews and confirms that evidence. On return, the renter documents the item's condition and the owner confirms or disputes it.</p>
      <h2>4. Return obligations</h2><p>The renter agrees to return the item by the due date in substantially the documented condition received, excluding normal wear allowed by the booking terms. Missing items, material damage or non-return may trigger deposit deductions, dispute review, account restrictions and lawful recovery remedies.</p>
      <h2>5. Late-return charges</h2><div class="legal-table"><div><b>Rental classification</b><b>Late charge</b></div><div><span>Lower-value / standard item</span><span>₱100 per late day</span></div><div><span>Applicable medium/high-value rentals</span><span>10% of daily rental rate per late day</span></div><div><span>Heavy equipment</span><span>20% of daily rental rate per late day</span></div></div><p>The exact late-return rule is snapshotted into the booking agreement so later policy changes do not rewrite an existing contract.</p>
      <h2>6. Security deposit and disputes</h2><p>The security deposit is separate from GoRentHive revenue. A proposed deduction must follow the booking evidence and may be accepted by the renter or disputed for review. Funds should not be released solely because one party makes a claim.</p>
      <h2>7. Handover</h2><p>GoRentHive is not a carrier and does not operate delivery. Owner and renter arrange pickup or a mutually agreed safe meetup. Any independently chosen third-party courier is outside GoRentHive's delivery operations.</p>
      <h2>8. Electronic acceptance</h2><p>Acceptance timestamps and the agreement version are recorded for the booking. Users should retain access to the exact agreement they accepted.</p>
      <div class="launch-notice">This page describes the platform's standard workflow. Philippine counsel should review the final production Terms, Privacy Policy and agreement wording before commercial launch.</div>
    </div></section></div>`;
  };

  Root.updateQuote = async function () {
    const l = this._quoteListing;
    if (!l) return;
    const sd = document.getElementById('bk-sd')?.value;
    const ed = document.getElementById('bk-ed')?.value;
    const box = document.getElementById('bk-quote');
    if (!box) return;
    if (!sd || !ed) { box.innerHTML = ''; return; }
    try {
      const q = await API.post('/bookings/quote', { listing_id: l.id, start_date: sd, end_date: ed, delivery_method: 'pickup' });
      this._quoteTotal = q.total;
      const days = q.rental_days || q.days || 1;
      box.innerHTML = `
        <div class="price-line"><span>${days} day${days > 1 ? 's' : ''} × ${fmtMoney(l.price_per_day)}</span><span>${fmtMoney(q.rental_fee)}</span></div>
        <div class="price-line deposit"><span>Refundable security deposit</span><span>${fmtMoney(q.security_deposit)}</span></div>
        <div class="price-line total"><span>Renter total</span><span>${fmtMoney(q.total)}</span></div>
        <div class="owner-commission-note">Owner commission: ${q.commission_rate || 8}% (${fmtMoney(q.platform_fee)}) is deducted from owner rental earnings—not added to your renter total.</div>
        <p class="protected-payment-note">🔒 Payment is processed through GoRentHive and owner earnings are released according to the return/dispute workflow.</p>`;
    } catch (e) { box.innerHTML = `<p style="color:var(--red);font-size:13px">${esc(e.message)}</p>`; }
  };

  Root.captureFreshGps = function () {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('GPS is not supported on this device.'));
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const payload = {
            source: 'gps', latitude: pos.coords.latitude, longitude: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy, captured_at: pos.timestamp || Date.now(),
          };
          const r = await API.post('/auth/verify-location', payload);
          this.state.meLocation = r.location;
          resolve(r.location);
        } catch (e) { reject(e); }
      }, (err) => reject(new Error(err.message || 'Location permission was denied.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  };

  Root.applyExplore = async function (initial) {
    const radiusEl = document.getElementById('ex-radius');
    const radius = radiusEl ? radiusEl.value : '';
    if (!radius) return oldApplyExplore ? oldApplyExplore(initial) : undefined;

    const q = (document.getElementById('ex-q')?.value || '').trim();
    const city = (document.getElementById('ex-city')?.value || '').trim();
    const cat = document.getElementById('ex-cat')?.value || '';
    const sort = document.getElementById('ex-sort')?.value || '';
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (city) p.set('city', city);
    if (cat) p.set('category', cat);
    if (sort) p.set('sort', sort);
    p.set('radius', radius);
    if (!initial) history.replaceState(null, '', '/explore?' + p.toString());

    const results = document.getElementById('ex-results');
    if (results) results.innerHTML = '<div class="spinner"></div>';
    try {
      await this.captureFreshGps();
      const query = new URLSearchParams({ radius_km: radius });
      if (q) query.set('q', q);
      if (cat) query.set('category', cat);
      const r = await API.get('/listings/nearby?' + query.toString());
      let items = r.listings || [];
      if (city) items = items.filter(x => String(x.location_city || '').toLowerCase().includes(city.toLowerCase()));
      if (sort === 'price_asc') items.sort((a,b) => a.price_per_day - b.price_per_day);
      if (sort === 'price_desc') items.sort((a,b) => b.price_per_day - a.price_per_day);
      if (sort === 'rating') items.sort((a,b) => (b.avg_rating || 0) - (a.avg_rating || 0));
      if (results) results.innerHTML = items.length
        ? items.map(l => `<div class="nearby-card-wrap">${this.listingCard(l)}<div class="distance-chip">⌖ ${Number(l.distance_km).toFixed(1)} km away</div></div>`).join('')
        : '<div class="empty"><div class="em">📍</div><h3>No rentals in this radius yet</h3><p>Try a larger radius or a different search.</p></div>';
    } catch (e) {
      if (results) results.innerHTML = `<div class="empty"><div class="em">📍</div><h3>Location required</h3><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="Root.applyExplore(false)">Try GPS again</button></div>`;
    }
  };

  Root.saveCondition = async function (id, phase) {
    const input = document.getElementById('ck-files');
    const files = input ? [...input.files] : [];
    if (files.length < 4) { this.toast('Upload at least 4 photos: front, back, left side and right side.', 'error', 4500); return; }
    let photos = [];
    const fd = new FormData(); files.slice(0,12).forEach(f => fd.append('files', f));
    try {
      const up = await fetch('/api/upload', { method: 'POST', body: fd }).then(async r => {
        const body = await r.json(); if (!r.ok) throw new Error(body.error || 'Photo upload failed'); return body;
      });
      photos = up.urls || [];
      const serial = document.getElementById('ck-serial')?.value || '';
      const acc = document.getElementById('ck-acc')?.value || '';
      const damage = document.getElementById('ck-damage')?.value || '';
      await API.post(`/bookings/${id}/condition`, { phase, photos, serial_number: serial, accessories: acc, damage_notes: damage });
      this.closeModal();
      this.toast('Condition evidence submitted. The other party must confirm it.', 'success', 4000);
      this.viewBookingDetail(id);
    } catch (e) { this.toast(e.message, 'error'); }
  };

  Root.confirmConditionEvidence = async function (bookingId, recordId, accept = true) {
    try {
      await API.post(`/bookings/${bookingId}/condition/${recordId}/confirm`, { accept });
      this.toast(accept ? 'Condition evidence confirmed' : 'Condition disputed', accept ? 'success' : 'warn');
      this.viewBookingDetail(bookingId);
    } catch (e) { this.toast(e.message, 'error'); }
  };

  Root.confirmHandover = async function (bookingId) {
    if (!confirm('Confirm that you received the item and the documented condition is correct? This starts the active rental.')) return;
    try { await API.post(`/bookings/${bookingId}/handover`, {}); this.toast('Handover confirmed. Rental is now active.', 'success'); this.viewBookingDetail(bookingId); }
    catch (e) { this.toast(e.message, 'error'); }
  };

  function injectBookingWorkflow(b) {
    if (!b || !Root.state.user) return;
    const host = Root.$app.querySelector('.wrap') || Root.$app;
    if (!host || document.getElementById('launch-workflow')) return;
    const isRenter = Root.state.user.id === b.renter_id;
    const isOwner = Root.state.user.id === b.owner_id;
    const cond = b.condition || [];
    const checkin = cond.filter(x => x.phase === 'checkin').sort((a,b) => b.created_at - a.created_at)[0];
    const checkout = cond.filter(x => x.phase === 'checkout').sort((a,b) => b.created_at - a.created_at)[0];
    const bothSigned = !!(b.agreement_signed_renter && b.agreement_signed_owner);
    const steps = [
      ['Owner approval', b.status !== 'pending'],
      ['Both parties signed agreement', bothSigned],
      ['Pre-rental photos confirmed', !!b.checkin_confirmed],
      ['Handover confirmed / rental active', !!b.handover_confirmed || ['active','returned','completed'].includes(b.status)],
      ['Return photos confirmed', !!b.checkout_confirmed || b.status === 'completed'],
      ['Rental completed', b.status === 'completed'],
    ];
    const card = document.createElement('div');
    card.id = 'launch-workflow';
    card.className = 'detail-card launch-workflow-card';
    card.innerHTML = `<h3>Rental protection checklist</h3><div class="workflow-steps">${steps.map(([n,done]) => `<div class="workflow-step ${done?'done':''}"><span>${done?'✓':'○'}</span>${n}</div>`).join('')}</div><div id="workflow-actions"></div>`;
    host.prepend(card);
    const actions = card.querySelector('#workflow-actions');

    if (b.status === 'approved' && checkin && checkin.status !== 'confirmed' && isRenter) {
      actions.innerHTML += `<button class="btn btn-primary btn-block" onclick="Root.confirmConditionEvidence(${b.id},${checkin.id},true)">✓ Confirm owner's pre-rental photos</button><button class="btn btn-outline btn-block" style="margin-top:8px" onclick="Root.confirmConditionEvidence(${b.id},${checkin.id},false)">Dispute condition evidence</button>`;
    }
    if (b.status === 'approved' && bothSigned && b.checkin_confirmed && isRenter) {
      actions.innerHTML += `<button class="btn btn-green btn-block" style="margin-top:8px" onclick="Root.confirmHandover(${b.id})">I received the item — Start rental</button>`;
    }
    if (b.status === 'active' && checkout && checkout.status !== 'confirmed' && isOwner) {
      actions.innerHTML += `<button class="btn btn-primary btn-block" style="margin-top:8px" onclick="Root.confirmConditionEvidence(${b.id},${checkout.id},true)">✓ Confirm renter's return photos</button><button class="btn btn-outline btn-block" style="margin-top:8px" onclick="Root.confirmConditionEvidence(${b.id},${checkout.id},false)">Dispute return condition</button>`;
    }
    if (Number(b.late_fee || 0) > 0) actions.innerHTML += `<div class="late-fee-alert">Late-return charge recorded: <b>${fmtMoney(b.late_fee)}</b> (${b.late_days || 0} late day(s)).</div>`;

    // Hide actions the old UI exposes to the wrong party under the new workflow.
    [...Root.$app.querySelectorAll('button')].forEach(btn => {
      const t = btn.textContent.toLowerCase();
      if (isRenter && t.includes('record check-in')) btn.style.display = 'none';
      if (isOwner && t.includes('record check-out')) btn.style.display = 'none';
      if (isOwner && !b.checkout_confirmed && t.includes('complete rental')) btn.style.display = 'none';
    });
  }

  if (oldBookingDetail) {
    Root.viewBookingDetail = async function (id) {
      await oldBookingDetail(id);
      try { const b = await API.get('/bookings/' + id); injectBookingWorkflow(b); } catch (_) {}
      sanitizeRenderedUI();
    };
  }

  Root.ledgerLabel = function (t) {
    const m = {
      rental_escrow: '🔒 Rental payment protected',
      deposit_escrow: '🔒 Refundable deposit protected',
      booking_escrow: '🔒 Booking funds protected',
      owner_earning: '💰 Owner earnings', deposit: '🔄 Deposit release', referral: '🎁 Referral reward', refund: '↩️ Refund', penalty: '⚠️ Late-return charge', payout: '💸 Payout', deposit_deduction: 'Deposit deduction', topup: '💳 Wallet top-up', promotion: '🔥 Promotion fee',
    };
    return m[t] || (oldLedgerLabel ? oldLedgerLabel(t) : t);
  };

  function replaceText(node, from, to) {
    if (!node || !node.nodeValue || !node.nodeValue.includes(from)) return;
    node.nodeValue = node.nodeValue.split(from).join(to);
  }

  function sanitizeRenderedUI() {
    if (!Root.$app) return;
    // Remove platform-arranged delivery controls left in the legacy SPA.
    Root.$app.querySelectorAll('[data-dm="lalamove"], #bk-lala').forEach(el => el.style.display = 'none');
    const pickup = Root.$app.querySelector('input[name="bk-dm"][value="pickup"]');
    if (pickup) pickup.checked = true;

    // Remove owner-listing delivery controls until an explicit owner-arranged
    // delivery feature is designed. GoRentHive itself does not provide it.
    Root.$app.querySelectorAll('label').forEach(label => {
      const t = label.textContent.trim().toLowerCase();
      if (t === 'offer delivery' || t === 'delivery fee (₱)' || t === 'delivery method') {
        const row = label.closest('.form-row') || label.parentElement;
        if (row) row.style.display = 'none';
      }
    });

    const walker = document.createTreeWalker(Root.$app, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      replaceText(n, 'Escrow protected', 'Protected payments');
      replaceText(n, 'secure escrow', 'protected payment');
      replaceText(n, 'Secure escrow', 'Protected payment');
      replaceText(n, 'held in escrow', 'protected pending completion');
      replaceText(n, 'Pick up or get it delivered. Record condition.', 'Pick up or meet the owner. Record condition.');
      replaceText(n, 'Provider-agnostic payment & escrow for deposits.', 'Protected payments and refundable deposits.');
      replaceText(n, 'Platform fee (4%)', 'Owner commission (8%)');
      replaceText(n, 'platform fee (4%)', 'owner commission (8%)');
    });

    Root.$app.querySelectorAll('.price-line.fee').forEach(row => {
      if (/platform fee/i.test(row.textContent)) {
        row.classList.add('owner-fee-info');
        const first = row.querySelector('span');
        if (first) first.textContent = 'Owner commission (8%)';
      }
    });
  }

  const observer = new MutationObserver(() => sanitizeRenderedUI());
  observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  setTimeout(sanitizeRenderedUI, 0);
})();
