/* GoRentHive marketplace upgrades — loaded last after launch-ready overrides. */
(() => {
  if (!window.Root || !window.API) return;

  const oldViewHome = Root.viewHome ? Root.viewHome.bind(Root) : null;
  const oldViewListing = Root.viewListing ? Root.viewListing.bind(Root) : null;
  const oldViewListForm = Root.viewListForm ? Root.viewListForm.bind(Root) : null;
  const oldBookingActions = Root.bookingActions ? Root.bookingActions.bind(Root) : null;
  const oldViewWallet = Root.viewWallet ? Root.viewWallet.bind(Root) : null;
  const oldLedgerLabel = Root.ledgerLabel ? Root.ledgerLabel.bind(Root) : null;
  const oldPickTier = Root.pickTier ? Root.pickTier.bind(Root) : null;
  const oldPreviewTier = Root.previewTier ? Root.previewTier.bind(Root) : null;
  const oldRender = Root.render ? Root.render.bind(Root) : null;

  const escape = (s) => typeof esc === 'function' ? esc(s) : String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const inputDate = (v) => {
    const t = Number(v) || new Date(v || 0).getTime();
    if (!Number.isFinite(t) || t <= 0) return '';
    return new Date(t).toISOString().slice(0, 10);
  };
  const ms = (v) => v ? new Date(v + 'T23:59:59').getTime() : 0;
  const selectedCategoryName = () => {
    const s = document.getElementById('li-cat');
    return s && s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent : '';
  };
  const isVehicleName = (name) => /(^|\b)(vehicle|vehicles|car|cars|motorcycle|motorcycles|truck|trucks|van|vans)(\b|$)/i.test(String(name || ''));
  const isVehicleSelected = () => isVehicleName(selectedCategoryName());

  function scrubLegacyTerms(root) {
    if (!root) return;
    const replacements = [
      [/Escrowed funds are frozen/gi, 'Protected booking funds are frozen'],
      [/secure escrow/gi, 'protected payment flow'],
      [/Payment received in GoRentHive escrow/gi, 'Payment confirmed through GoRentHive’s protected payment flow'],
      [/Rental escrow \(held\)/gi, 'Rental payment (held)'],
      [/Deposit escrow \(held\)/gi, 'Security deposit (held)'],
      [/held in escrow/gi, 'held as a refundable security deposit'],
      [/Pick up or get it delivered\./gi, 'Arrange pickup or a mutually agreed meetup.'],
    ];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      let value = node.nodeValue || '';
      replacements.forEach(([re, to]) => { value = value.replace(re, to); });
      if (value !== node.nodeValue) node.nodeValue = value;
    });
  }

  Root.viewHome = async function () {
    if (oldViewHome) await oldViewHome();
    const sections = this.$app && this.$app.querySelector('.wrap');
    if (!sections || this.$app.querySelector('.marketplace-feature-rail')) return;
    const rail = document.createElement('section');
    rail.className = 'section marketplace-feature-rail';
    rail.innerHTML = `
      <div class="section-head"><div><h2>Built for real local rentals</h2><p class="section-sub">More than listings: discovery, documented handover and category-specific protection.</p></div></div>
      <div class="upgrade-grid">
        <a class="upgrade-card" href="/requests"><span>📣</span><div><h3>Request It</h3><p>Can't find an item? Tell the Hive what you need and let nearby owners respond.</p></div></a>
        <a class="upgrade-card" href="/explore"><span>📅</span><div><h3>Availability first</h3><p>See unavailable rental dates before you request a booking.</p></div></a>
        <a class="upgrade-card" href="/motors"><span>🚗</span><div><h3>GoRentHive Motors</h3><p>Vehicle rentals use stricter owner, vehicle and driver verification before booking.</p></div></a>
      </div>`;
    const ownerBanner = this.$app.querySelector('.launch-owner-banner')?.closest('section');
    if (ownerBanner && ownerBanner.parentNode) ownerBanner.parentNode.insertBefore(rail, ownerBanner);
    else sections.appendChild(rail);
    scrubLegacyTerms(this.$app);
  };

  Root.deliverySection = function (b) {
    const meetup = b && (b.pickup_option === 'meetup' || b.pickup_option === 'public_place');
    return `<div class="detail-card" style="margin-top:16px">
      <h3>🤝 Handover arrangement</h3>
      <div class="price-line" style="margin-top:6px"><span>Method</span><span>${meetup ? '📍 Mutually agreed meetup' : '📦 Owner/renter pickup'}</span></div>
      <p style="font-size:12px;color:var(--ink-soft);margin-top:6px">GoRentHive does not operate, dispatch, or charge for delivery. The owner and renter arrange pickup or a safe meetup directly. Either party may independently choose a third-party courier at their own responsibility.</p>
    </div>`;
  };
  Root.scheduleReturnDelivery = function () { this.toast('GoRentHive does not dispatch delivery. Arrange the return directly with the other party.', 'warn', 4200); };
  Root.updateDeliveryStatus = Root.scheduleReturnDelivery;
  Root.deliveryProofModal = Root.scheduleReturnDelivery;

  Root.bookingActions = function (b, isRenter, isOwner) {
    let html = oldBookingActions ? oldBookingActions(b, isRenter, isOwner) : '';
    html = html.replace(/Escrowed funds are frozen/gi, 'Protected booking funds are frozen');
    if (b && b.status === 'approved') {
      if (isOwner) {
        html += `<div class="handover-panel"><b>🔐 Physical handover</b><p>After both signatures and renter-confirmed condition photos, generate a 6-digit PIN and show it to the renter in person.</p><button class="btn btn-dark btn-block" onclick="Root.generateHandoverPin(${b.id})">Generate handover PIN</button></div>`;
      }
      if (isRenter) {
        html += `<div class="handover-panel"><b>🔐 Confirm physical handover</b><p>Enter the 6-digit PIN shown by the owner only after you have the item and have reviewed the condition evidence.</p><div class="handover-code-row"><input id="handover-code-${b.id}" inputmode="numeric" maxlength="6" placeholder="6-digit PIN"><button class="btn btn-primary" onclick="Root.confirmHandoverPin(${b.id})">Confirm receipt</button></div></div>`;
      }
    }
    return html;
  };

  Root.generateHandoverPin = async function (id) {
    try {
      const r = await API.post(`/bookings/${id}/handover-code`, {});
      this.modal(`Physical Handover PIN
        <div class="handover-pin">${escape(r.code)}</div>
        <p style="text-align:center;color:var(--ink-soft);font-size:13px">Valid for ${r.valid_for_minutes || 30} minutes. Show this PIN only to the renter when the item is physically handed over.</p>
        <div class="launch-notice">Do not send the PIN before meetup. The renter's successful confirmation activates the rental.</div>`, 'close');
    } catch (e) { this.toast(e.message, 'error', 4500); }
  };

  Root.confirmHandoverPin = async function (id) {
    const code = (document.getElementById(`handover-code-${id}`)?.value || '').replace(/\D/g, '');
    if (code.length !== 6) { this.toast('Enter the 6-digit handover PIN.', 'warn'); return; }
    try {
      await API.post(`/bookings/${id}/handover-code/confirm`, { code });
      this.toast('Handover confirmed. Rental is now active.', 'success');
      this.viewBookingDetail(id);
    } catch (e) { this.toast(e.message, 'error', 4500); }
  };

  function availabilityHtml(data) {
    const start = new Date(); start.setHours(0,0,0,0);
    const unavailable = data && Array.isArray(data.unavailable) ? data.unavailable : [];
    const busy = (day) => unavailable.some((r) => Number(r.start_date) <= day && Number(r.end_date) >= day);
    const cells = [];
    for (let i = 0; i < 35; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const t = d.getTime();
      cells.push(`<div class="availability-day ${busy(t) ? 'busy' : 'free'}"><span>${d.toLocaleDateString('en-PH',{weekday:'short'})}</span><b>${d.getDate()}</b><small>${busy(t) ? 'Unavailable' : 'Open'}</small></div>`);
    }
    return `<div class="detail-card marketplace-availability"><div class="availability-head"><div><h3>📅 Availability</h3><p>Next 35 days. Pending and confirmed bookings are treated as unavailable to avoid double-booking.</p></div><span class="availability-key"><i></i> Open</span></div><div class="availability-grid">${cells.join('')}</div></div>`;
  }

  Root.viewListing = async function (id) {
    if (oldViewListing) await oldViewListing(id);
    const target = this.$app && (this.$app.querySelector('.grid-2-side') || this.$app.querySelector('.wrap'));
    if (!target) return;
    try {
      const from = new Date(); from.setHours(0,0,0,0);
      const to = new Date(from.getTime() + 35 * 86400000);
      const av = await API.get(`/listings/${id}/availability?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
      const holder = document.createElement('div'); holder.className = 'marketplace-listing-extras'; holder.innerHTML = availabilityHtml(av); target.appendChild(holder);
    } catch (_) {}
    try {
      const vc = await API.get(`/vehicles/compliance/${id}/public`);
      if (vc && vc.required) {
        const holder = document.createElement('div');
        holder.className = 'detail-card vehicle-public-status';
        holder.innerHTML = `<h3>🚗 GoRentHive Motors verification</h3>
          <div class="vehicle-badge ${vc.verified ? 'verified' : 'pending'}">${vc.verified ? '✓ Vehicle verified for marketplace booking' : 'Verification required before booking'}</div>
          <div class="vehicle-checks"><span>${vc.registration_verified ? '✓' : '○'} Registration</span><span>${vc.ltfrb_authority_verified ? '✓' : '○'} LTFRB authority</span><span>${vc.rental_insurance_verified ? '✓' : '○'} Rental-use insurance</span><span>${vc.ctpl_verified ? '✓' : '○'} CTPL</span></div>
          <p>Vehicle documents and exact identifiers remain private. GoRentHive publishes only verification status.</p>`;
        target.appendChild(holder);
      }
    } catch (_) {}
    scrubLegacyTerms(this.$app);
  };

  function hideLegacyDeliveryControls() {
    document.querySelectorAll('.form-row').forEach((row) => {
      const label = row.querySelector('label');
      const name = label ? label.textContent.trim() : '';
      if (name === 'Delivery' || name.startsWith('Delivery fee')) row.style.display = 'none';
    });
    const pickup = document.querySelector('input[name="li-del"][value="0"]');
    if (pickup) pickup.checked = true;
    const fee = document.getElementById('li-del-fee');
    if (fee) fee.value = '0';
  }

  function vehicleSectionMarkup(c = {}) {
    return `<div class="vehicle-compliance-form" id="vehicle-compliance-form">
      <div class="vehicle-form-head"><div><span class="vehicle-label">GORENTHIVE MOTORS</span><h3>Vehicle compliance</h3><p>Vehicle listings are not publicly bookable until GoRentHive verifies registration, LTFRB authority, CTPL and insurance that explicitly permits rental use.</p></div><span class="vehicle-badge ${c.status === 'verified' ? 'verified' : 'pending'}">${c.status === 'verified' ? '✓ VERIFIED' : (c.status || 'NOT SUBMITTED').toUpperCase()}</span></div>
      <div class="form-grid2"><div class="form-row"><label>Make *</label><input id="vc-make" value="${escape(c.make || '')}" placeholder="Toyota"></div><div class="form-row"><label>Model *</label><input id="vc-model" value="${escape(c.model || '')}" placeholder="Vios"></div></div>
      <div class="form-grid2"><div class="form-row"><label>Model year</label><input id="vc-year" type="number" min="1900" max="2100" value="${c.model_year || ''}"></div><div class="form-row"><label>Plate number *</label><input id="vc-plate" value="${escape(c.plate_number || '')}" placeholder="ABC 1234"></div></div>
      <div class="form-row"><label>VIN / chassis last 6 characters</label><input id="vc-vin" maxlength="6" value="${escape(c.vin_last6 || '')}" placeholder="Last 6 only"></div>
      <div class="form-grid2"><div class="form-row"><label>OR/CR reference *</label><input id="vc-orcr" value="${escape(c.or_cr_reference || '')}"></div><div class="form-row"><label>Registration expiry *</label><input id="vc-orcr-exp" type="date" value="${inputDate(c.or_cr_expiry)}"></div></div>
      <div class="form-grid2"><div class="form-row"><label>LTFRB authority / CPC reference *</label><input id="vc-ltfrb" value="${escape(c.ltfrb_authority_reference || '')}"></div><div class="form-row"><label>LTFRB authority expiry *</label><input id="vc-ltfrb-exp" type="date" value="${inputDate(c.ltfrb_expiry)}"></div></div>
      <div class="form-grid2"><div class="form-row"><label>Rental-use insurance reference *</label><input id="vc-ins" value="${escape(c.insurance_reference || '')}"></div><div class="form-row"><label>Insurance expiry *</label><input id="vc-ins-exp" type="date" value="${inputDate(c.insurance_expiry)}"></div></div>
      <div class="form-grid2"><div class="form-row"><label>CTPL reference *</label><input id="vc-ctpl" value="${escape(c.ctpl_reference || '')}"></div><div class="form-row"><label>CTPL expiry *</label><input id="vc-ctpl-exp" type="date" value="${inputDate(c.ctpl_expiry)}"></div></div>
      <label class="checkbox-label vehicle-cert"><input type="checkbox" id="vc-rental-cover" ${c.rental_use_covered ? 'checked' : ''}> I confirm the insurance documentation explicitly permits rental / for-hire use and is not merely ordinary private-car coverage.</label>
      <div class="launch-notice">Self-drive only at this stage. “With driver” service is not enabled until its separate transport-service regulatory requirements are validated.</div>
    </div>`;
  }

  Root.refreshVehicleListingFields = async function (editId) {
    const existing = document.getElementById('vehicle-compliance-form');
    if (!isVehicleSelected()) { if (existing) existing.remove(); return; }
    if (existing) existing.remove();
    let c = {};
    if (editId) {
      try { c = (await API.get(`/vehicles/compliance/${editId}`)).compliance || {}; } catch (_) {}
    }
    const button = this.$app.querySelector('.form-card.wide > .btn.btn-primary');
    if (!button) return;
    const temp = document.createElement('div'); temp.innerHTML = vehicleSectionMarkup(c);
    button.parentNode.insertBefore(temp.firstElementChild, button);
    const min = document.getElementById('li-min');
    if (min && Number(min.value || 0) < 3) min.value = '3';
  };

  Root.viewListForm = async function (editId) {
    if (oldViewListForm) await oldViewListForm(editId);
    hideLegacyDeliveryControls();
    const rows = this.$app.querySelectorAll('.form-row');
    const ruleRow = [...rows].find((r) => (r.querySelector('label')?.textContent || '').trim() === 'Rules');
    if (ruleRow && !document.getElementById('handover-policy-note')) {
      const note = document.createElement('div'); note.id = 'handover-policy-note'; note.className = 'launch-notice';
      note.innerHTML = '<b>Handover:</b> GoRentHive does not provide delivery. Owner and renter arrange pickup, a safe meetup, or an independently chosen third-party courier.';
      ruleRow.after(note);
    }
    const cat = document.getElementById('li-cat');
    if (cat) cat.addEventListener('change', () => this.refreshVehicleListingFields(editId));
    await this.refreshVehicleListingFields(editId);
    scrubLegacyTerms(this.$app);
  };

  function vehiclePayload() {
    if (!isVehicleSelected()) return null;
    return {
      make: document.getElementById('vc-make')?.value || '', model: document.getElementById('vc-model')?.value || '', model_year: Number(document.getElementById('vc-year')?.value || 0) || null,
      plate_number: document.getElementById('vc-plate')?.value || '', vin_last6: document.getElementById('vc-vin')?.value || '',
      or_cr_reference: document.getElementById('vc-orcr')?.value || '', or_cr_expiry: ms(document.getElementById('vc-orcr-exp')?.value),
      ltfrb_authority_reference: document.getElementById('vc-ltfrb')?.value || '', ltfrb_expiry: ms(document.getElementById('vc-ltfrb-exp')?.value),
      insurance_reference: document.getElementById('vc-ins')?.value || '', insurance_expiry: ms(document.getElementById('vc-ins-exp')?.value),
      ctpl_reference: document.getElementById('vc-ctpl')?.value || '', ctpl_expiry: ms(document.getElementById('vc-ctpl-exp')?.value),
      rental_use_covered: !!document.getElementById('vc-rental-cover')?.checked,
    };
  }

  Root.saveListing = async function (editId) {
    let photos = editId ? [...(this.state.currentListing?.images || [])] : [];
    const files = document.getElementById('li-files')?.files || [];
    if (files.length) {
      const fd = new FormData(); [...files].forEach((f) => fd.append('files', f));
      const token = await window.__getAccessToken();
      const response = await fetch('/api/upload', { method: 'POST', body: fd, headers: token ? { Authorization: 'Bearer ' + token } : {} });
      const up = await response.json();
      if (!response.ok) { this.toast(up.error || 'Photo upload failed', 'error'); return; }
      photos.push(...(up.urls || []));
    }
    const vehicle = isVehicleSelected();
    const body = {
      title: document.getElementById('li-title').value.trim(),
      category_id: parseInt(document.getElementById('li-cat').value, 10),
      location_city: document.getElementById('li-city').value.trim(),
      price_per_day: parseInt(document.getElementById('li-price').value, 10),
      estimated_value: parseInt(document.getElementById('li-val').value || '0', 10),
      deposit_tier: (document.querySelector('input[name="li-dep-tier"]:checked') || {}).value || this._recTier(document.getElementById('li-val').value),
      description: document.getElementById('li-desc').value,
      condition: document.getElementById('li-cond').value,
      accessories: document.getElementById('li-acc').value,
      serial_number: document.getElementById('li-serial').value,
      rules: document.getElementById('li-rules').value,
      min_verification_level: Math.max(parseInt(document.getElementById('li-min').value, 10) || 2, vehicle ? 3 : 2),
      cancellation_policy: document.getElementById('li-cancel').value,
      delivery_available: false, delivery_fee: 0, pickup_available: true,
      images: photos,
    };
    if (!body.title || !body.price_per_day || !body.location_city) { this.toast('Title, price and city are required', 'error'); return; }
    const vp = vehiclePayload();
    if (vehicle) {
      const missing = !vp.plate_number || !vp.or_cr_reference || !vp.or_cr_expiry || !vp.ltfrb_authority_reference || !vp.ltfrb_expiry || !vp.insurance_reference || !vp.insurance_expiry || !vp.ctpl_reference || !vp.ctpl_expiry || !vp.rental_use_covered;
      if (missing) { this.toast('Complete the vehicle compliance section before saving this vehicle.', 'error', 5000); return; }
    }
    try {
      let result;
      if (editId) result = await API.put('/listings/' + editId, body);
      else result = await API.post('/listings', body);
      const listingId = Number(editId || result?.id || result?.listing?.id || result?.data?.id || 0);
      if (vehicle && listingId) {
        await API.put(`/vehicles/compliance/${listingId}`, vp);
        this.toast('Vehicle saved. It will stay out of public booking until regulatory review is complete.', 'success', 5200);
      } else if (vehicle) {
        this.toast('Vehicle listing saved. Open Edit Listing to finish regulatory review details.', 'warn', 5200);
      } else {
        this.toast(editId ? 'Listing updated' : 'Listing published!', 'success');
      }
      this.nav('/owner');
    } catch (e) { this.toast(e.message, 'error', 5000); }
  };

  Root.pickTier = function (t) { if (oldPickTier) oldPickTier(t); scrubLegacyTerms(this.$app); };
  Root.previewTier = function () { if (oldPreviewTier) oldPreviewTier(); scrubLegacyTerms(this.$app); };
  Root.ledgerLabel = function (t) {
    const base = oldLedgerLabel ? oldLedgerLabel(t) : t;
    return String(base).replace(/Rental escrow \(held\)/i, 'Rental payment (held)').replace(/Deposit escrow \(held\)/i, 'Security deposit (held)');
  };
  Root.viewWallet = async function () { if (oldViewWallet) await oldViewWallet(); scrubLegacyTerms(this.$app); };

  Root.submitDriverVerification = async function () {
    const payload = {
      license_last4: document.getElementById('drv-last4')?.value || '',
      license_class: document.getElementById('drv-class')?.value || '',
      license_expiry: ms(document.getElementById('drv-exp')?.value),
    };
    try { await API.put('/vehicles/driver-verification', payload); this.toast('Driver verification submitted for review.', 'success'); this.viewMotors(); }
    catch (e) { this.toast(e.message, 'error'); }
  };

  Root.viewMotors = async function () {
    this.setMeta('GoRentHive Motors | Verified Vehicle Rentals', 'Higher-trust self-drive vehicle rentals with owner, vehicle, regulatory and driver verification.', '/motors');
    let driver = null;
    if (this.state.user) { try { driver = (await API.get('/vehicles/driver-verification')).verification; } catch (_) {} }
    this.$app.innerHTML = `<div class="landing-hero motors-hero"><div class="wrap"><span class="hero-eyebrow">🚗 GoRentHive Motors</span><h1>Vehicle rentals with <span>higher verification.</span></h1><p class="sub">Vehicles are not treated like ordinary listings. Public booking requires current vehicle registration, verified LTFRB authority, CTPL, rental-use insurance, enhanced renter identity and driver-license verification.</p><div class="hero-ctas"><a class="btn btn-primary btn-lg" href="/explore?q=vehicle">Explore verified vehicles</a><a class="btn btn-outline-light btn-lg" href="/list">List a vehicle</a></div></div></div>
      <div class="wrap"><section class="section"><div class="motors-grid">
        <article><span>🪪</span><h3>Owner & driver identity</h3><p>Owners pass account verification. Self-drive renters must also have a verified, unexpired driver's-license record.</p></article>
        <article><span>📑</span><h3>Vehicle documents</h3><p>Registration and regulatory authority are reviewed before a vehicle becomes publicly bookable.</p></article>
        <article><span>🛡️</span><h3>Rental-use insurance</h3><p>Ordinary private-car coverage is not treated as enough; the submitted coverage must explicitly allow rental / for-hire use.</p></article>
        <article><span>🔐</span><h3>PIN handover</h3><p>After agreements and condition evidence, the owner generates a short-lived PIN that the renter confirms at physical handover.</p></article>
      </div><div class="launch-notice"><b>Current scope:</b> self-drive marketplace rentals only. GoRentHive does not operate delivery, chauffeur, ride-hailing, or transport services.</div></section>
      ${this.state.user ? `<section class="section"><div class="detail-card driver-verify-card"><div class="section-head"><div><h2>Driver verification</h2><p class="section-sub">Required before you can book a self-drive vehicle.</p></div><span class="vehicle-badge ${driver?.status === 'verified' ? 'verified' : 'pending'}">${escape((driver?.status || 'NOT SUBMITTED').toUpperCase())}</span></div>
        <div class="form-grid2"><div class="form-row"><label>Driver's license last 4 characters</label><input id="drv-last4" maxlength="4" value="${escape(driver?.license_last4 || '')}"></div><div class="form-row"><label>License class / restriction</label><input id="drv-class" value="${escape(driver?.license_class || '')}" placeholder="e.g. A, B, B1"></div></div>
        <div class="form-row"><label>License expiry</label><input id="drv-exp" type="date" value="${inputDate(driver?.license_expiry)}"></div><button class="btn btn-primary" onclick="Root.submitDriverVerification()">Submit for review</button>
        <p class="privacy-note">Only limited license metadata is stored here. Full identity documents should remain in the platform's private verification workflow and must never appear on public listing pages.</p></div></section>` : `<section class="section"><div class="detail-card"><h2>Want to rent a vehicle?</h2><p>Create an account and complete identity + driver verification first.</p><a class="btn btn-primary" href="/register">Create account</a></div></section>`}
      </div>`;
  };

  Root.render = async function (parts, query) {
    const route = (parts && parts[0]) || 'home';
    if (route === 'motors') return this.viewMotors();
    const out = oldRender ? await oldRender(parts, query) : undefined;
    scrubLegacyTerms(this.$app);
    return out;
  };

  const observer = new MutationObserver(() => scrubLegacyTerms(document.getElementById('app')));
  const app = document.getElementById('app');
  if (app) observer.observe(app, { childList: true, subtree: true });
})();
