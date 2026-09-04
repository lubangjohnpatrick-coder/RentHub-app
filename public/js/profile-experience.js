/* GoRentHive profile experience: profile photo + GPS-verified saved locations. */
(() => {
  'use strict';
  if (!window.Root || !window.API) return;

  const originalViewProfile = Root.viewProfile ? Root.viewProfile.bind(Root) : null;
  const originalRenderNav = Root.renderNav ? Root.renderNav.bind(Root) : null;

  const escText = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function navAvatar() {
    const u = Root.state.user;
    if (!u || !u.avatar) return;
    document.querySelectorAll('.nav-me .avatar').forEach((el) => {
      el.innerHTML = `<img src="${escText(u.avatar)}" alt="" class="grh-nav-avatar-img">`;
    });
  }

  Root.renderNav = function renderNavWithProfilePhoto() {
    if (originalRenderNav) originalRenderNav();
    navAvatar();
  };

  async function uploadProfilePhoto(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) throw new Error('Choose a JPG, PNG, WEBP or GIF image.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Profile photo must be 5 MB or smaller.');

    const token = await window.__getAccessToken();
    if (!token) throw new Error('Please log in again.');
    const fd = new FormData();
    fd.append('files', file);
    const res = await fetch('/api/upload?scope=profile', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Profile photo upload failed.');
    const url = data.urls && data.urls[0];
    if (!url) throw new Error('Profile photo upload did not return a URL.');
    const updated = await API.post('/auth/update', { avatar: url });
    if (updated.user) Root.state.user = { ...Root.state.user, ...updated.user };
    Root.renderNav();
    return url;
  }

  function captureGps() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('GPS is not available on this device.'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          captured_at: pos.timestamp || Date.now(),
          source: 'gps',
        }),
        (err) => reject(new Error(err.message || 'Unable to capture GPS location.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  async function renderLocations(container) {
    const data = await API.get('/profile/locations');
    const locations = data.locations || [];
    container.innerHTML = locations.length ? locations.map((loc) => `
      <article class="grh-saved-location" data-id="${loc.id}">
        <div class="grh-location-pin">📍</div>
        <div class="grow">
          <div class="grh-location-title">${escText(loc.label)} ${loc.is_default ? '<span class="verified-chip">Default</span>' : ''}</div>
          <div class="grh-location-address">${escText([loc.address, loc.barangay, loc.city, loc.province].filter(Boolean).join(', ') || 'GPS verified location')}</div>
          <div class="grh-location-meta">✓ GPS verified · accuracy ±${Math.round(Number(loc.accuracy_m || 0))} m</div>
        </div>
        <div class="grh-location-actions">
          ${loc.is_default ? '' : `<button type="button" class="btn btn-outline btn-sm" data-action="default">Set default</button>`}
          <button type="button" class="btn btn-outline btn-sm" data-action="refresh">Re-verify GPS</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete">Delete</button>
        </div>
      </article>`).join('') : '<div class="grh-empty-location">No saved locations yet. Save a place only after GoRentHive verifies a fresh device GPS reading.</div>';

    container.querySelectorAll('[data-action]').forEach((btn) => btn.addEventListener('click', async () => {
      const card = btn.closest('[data-id]');
      const id = card && card.dataset.id;
      if (!id) return;
      try {
        btn.disabled = true;
        if (btn.dataset.action === 'delete') await API.del(`/profile/locations/${id}`);
        if (btn.dataset.action === 'default') await API.request('PATCH', `/profile/locations/${id}`, { is_default: true });
        if (btn.dataset.action === 'refresh') {
          const fix = await captureGps();
          await API.request('PATCH', `/profile/locations/${id}`, fix);
        }
        await renderLocations(container);
        Root.toast('Saved locations updated.', 'success');
      } catch (e) { Root.toast(e.message, 'error'); }
      finally { btn.disabled = false; }
    }));
  }

  async function mountProfileTools() {
    const host = Root.$app.querySelector('.wrap');
    if (!host || host.querySelector('.grh-profile-tools')) return;
    const u = Root.state.user || {};
    const section = document.createElement('section');
    section.className = 'grh-profile-tools';
    section.innerHTML = `
      <div class="grh-profile-photo-card">
        <div class="grh-profile-photo-wrap">
          ${u.avatar ? `<img src="${escText(u.avatar)}" alt="${escText(u.full_name || 'Profile')}" class="grh-profile-photo">` : `<div class="grh-profile-photo-fallback">${escText((u.full_name || '?')[0])}</div>`}
        </div>
        <div class="grow">
          <div class="grh-profile-kicker">PROFILE</div>
          <h2>${escText(u.full_name || 'Your profile')}</h2>
          <p>Add a clear profile photo so renters and owners can recognize who they are dealing with.</p>
          <label class="btn btn-outline grh-upload-profile-btn">Change profile photo<input id="grh-profile-photo-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        </div>
      </div>
      <div class="grh-location-card">
        <div class="grh-location-head">
          <div><div class="grh-profile-kicker">SAVED LOCATIONS</div><h2>Your trusted places</h2><p>Manual address text is allowed, but a location is marked verified only after a fresh, accurate device GPS capture.</p></div>
          <button type="button" class="btn btn-primary" id="grh-add-location">Add verified location</button>
        </div>
        <div id="grh-saved-locations"><div class="spinner"></div></div>
        <form id="grh-location-form" class="grh-location-form" hidden>
          <div class="field"><label for="grh-loc-label">Label</label><input id="grh-loc-label" maxlength="60" placeholder="Home, Office, Warehouse"></div>
          <div class="field"><label for="grh-loc-address">Address / landmark</label><input id="grh-loc-address" maxlength="180" placeholder="House number, street, landmark"></div>
          <div class="grh-location-grid">
            <div class="field"><label for="grh-loc-barangay">Barangay</label><input id="grh-loc-barangay" maxlength="80"></div>
            <div class="field"><label for="grh-loc-city">City / Municipality</label><input id="grh-loc-city" maxlength="80"></div>
            <div class="field"><label for="grh-loc-province">Province</label><input id="grh-loc-province" maxlength="80"></div>
          </div>
          <label class="grh-default-check"><input type="checkbox" id="grh-loc-default"> Make this my default location</label>
          <div class="grh-gps-security-note">🔒 Coordinates cannot be typed manually. When you save, GoRentHive captures a fresh GPS fix and rejects stale or low-accuracy readings.</div>
          <div class="grh-location-form-actions"><button type="button" class="btn btn-outline" id="grh-cancel-location">Cancel</button><button type="submit" class="btn btn-primary">Verify GPS & save</button></div>
        </form>
      </div>`;
    host.prepend(section);

    const photoInput = section.querySelector('#grh-profile-photo-input');
    photoInput?.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      try {
        const url = await uploadProfilePhoto(file);
        const wrap = section.querySelector('.grh-profile-photo-wrap');
        wrap.innerHTML = `<img src="${escText(url)}" alt="${escText(u.full_name || 'Profile')}" class="grh-profile-photo">`;
        Root.toast('Profile photo updated.', 'success');
      } catch (e) { Root.toast(e.message, 'error'); }
      finally { photoInput.value = ''; }
    });

    const form = section.querySelector('#grh-location-form');
    const list = section.querySelector('#grh-saved-locations');
    section.querySelector('#grh-add-location')?.addEventListener('click', () => { form.hidden = false; form.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    section.querySelector('#grh-cancel-location')?.addEventListener('click', () => { form.hidden = true; form.reset(); });
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      try {
        submit.disabled = true;
        submit.textContent = 'Capturing GPS…';
        const fix = await captureGps();
        submit.textContent = 'Saving…';
        await API.post('/profile/locations', {
          ...fix,
          label: section.querySelector('#grh-loc-label').value,
          address: section.querySelector('#grh-loc-address').value,
          barangay: section.querySelector('#grh-loc-barangay').value,
          city: section.querySelector('#grh-loc-city').value,
          province: section.querySelector('#grh-loc-province').value,
          is_default: section.querySelector('#grh-loc-default').checked,
        });
        form.reset(); form.hidden = true;
        await renderLocations(list);
        Root.toast('Location verified and saved.', 'success');
      } catch (e) { Root.toast(e.message, 'error'); }
      finally { submit.disabled = false; submit.textContent = 'Verify GPS & save'; }
    });

    try { await renderLocations(list); } catch (e) { list.innerHTML = `<div class="grh-empty-location">Saved locations are unavailable until the latest database migration is applied.</div>`; }
  }

  if (originalViewProfile) {
    Root.viewProfile = async function viewProfileWithSavedLocations() {
      await originalViewProfile();
      await mountProfileTools();
    };
  }
})();
