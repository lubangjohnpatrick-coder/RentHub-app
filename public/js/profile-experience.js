/* GoRentHive profile experience: profile photo + GPS-verified saved locations. */
(() => {
  'use strict';
  if (!window.Root || !window.API) return;

  const originalViewProfile = Root.viewProfile ? Root.viewProfile.bind(Root) : null;
  const originalRenderNav = Root.renderNav ? Root.renderNav.bind(Root) : null;
  const escText = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  let editingLocationId = null;
  let locationCache = [];
  let locationMap = null;
  let locationMarker = null;
  let gpsCircle = null;
  let verifiedGps = null;
  let selectedPin = null;

  function avatarMarkup(user, className = 'grh-profile-photo') {
    if (user && user.avatar) return `<img src="${escText(user.avatar)}" alt="${escText(user.full_name || 'Profile')}" class="${className}">`;
    return `<div class="grh-profile-photo-fallback">${escText(((user && user.full_name) || '?')[0])}</div>`;
  }

  function navAvatar() {
    const u = Root.state.user;
    if (!u || !u.avatar) return;
    document.querySelectorAll('.nav-me .avatar').forEach((el) => {
      el.innerHTML = `<img src="${escText(u.avatar)}" alt="" class="grh-nav-avatar-img">`;
    });
  }

  function syncLegacyProfileAvatar() {
    const u = Root.state.user;
    if (!u || !u.avatar) return;
    const legacyAvatar = Root.$app && Root.$app.querySelector('.grid-2-side .detail-card .avatar.lg');
    if (legacyAvatar) {
      legacyAvatar.innerHTML = `<img src="${escText(u.avatar)}" alt="" class="grh-nav-avatar-img">`;
      legacyAvatar.classList.add('grh-avatar-photo');
    }
  }

  Root.renderNav = function renderNavWithProfilePhoto() {
    if (originalRenderNav) originalRenderNav();
    navAvatar();
  };

  async function uploadProfilePhoto(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Choose a JPG, PNG or WEBP image.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Profile photo must be 5 MB or smaller.');
    const token = await window.__getAccessToken();
    if (!token) throw new Error('Please log in again.');
    const fd = new FormData();
    fd.append('files', file);
    const res = await fetch('/api/upload?scope=profile', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Profile photo upload failed.');
    const baseUrl = data.urls && data.urls[0];
    if (!baseUrl) throw new Error('Profile photo upload did not return a URL.');
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
    const updated = await API.post('/auth/update', { avatar: url });
    if (updated.user) Root.state.user = { ...Root.state.user, ...updated.user };
    Root.renderNav();
    syncLegacyProfileAvatar();
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

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-grh-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.integrity = 'sha256-p4NxAoJBhIINfQ3ynUNBiWqYQxLJYjMZ+PoafM7qGkM=';
        link.crossOrigin = '';
        link.dataset.grhLeaflet = '1';
        document.head.appendChild(link);
      }
      const existing = document.querySelector('script[data-grh-leaflet]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.L), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';
      script.dataset.grhLeaflet = '1';
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error('Unable to load the map. Check your connection and try again.'));
      document.head.appendChild(script);
    });
  }

  function resetMapState() {
    if (locationMap) locationMap.remove();
    locationMap = null;
    locationMarker = null;
    gpsCircle = null;
    verifiedGps = null;
    selectedPin = null;
  }

  async function openMapPicker(section, initialLocation = null) {
    const status = section.querySelector('#grh-map-status');
    status.textContent = 'Getting your current GPS location…';
    const fix = await captureGps();
    if (fix.accuracy_m > 100) throw new Error('GPS accuracy is too low. Move to an open area and try again.');
    verifiedGps = fix;
    const initialLat = initialLocation && Number.isFinite(Number(initialLocation.latitude)) ? Number(initialLocation.latitude) : fix.latitude;
    const initialLng = initialLocation && Number.isFinite(Number(initialLocation.longitude)) ? Number(initialLocation.longitude) : fix.longitude;
    selectedPin = { latitude: initialLat, longitude: initialLng };

    const L = await loadLeaflet();
    if (locationMap) locationMap.remove();
    const mapEl = section.querySelector('#grh-location-map');
    locationMap = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView([initialLat, initialLng], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(locationMap);
    gpsCircle = L.circle([fix.latitude, fix.longitude], { radius: Math.max(10, fix.accuracy_m), weight: 1, fillOpacity: .08 }).addTo(locationMap);
    locationMarker = L.marker([initialLat, initialLng], { draggable: true }).addTo(locationMap);
    locationMarker.on('dragend', () => {
      const p = locationMarker.getLatLng();
      selectedPin = { latitude: p.lat, longitude: p.lng };
      status.textContent = 'Pin adjusted. GoRentHive will verify it is still near your fresh GPS location when you save.';
    });
    locationMap.on('click', (event) => {
      locationMarker.setLatLng(event.latlng);
      selectedPin = { latitude: event.latlng.lat, longitude: event.latlng.lng };
      status.textContent = 'Pin moved. Keep it near your actual GPS location.';
    });
    setTimeout(() => locationMap.invalidateSize(), 80);
    status.textContent = `GPS verified at ±${Math.round(fix.accuracy_m)} m. Drag the pin to your exact gate, building or meetup point.`;
  }

  function fillLocationForm(section, loc) {
    editingLocationId = loc ? String(loc.id) : null;
    section.querySelector('#grh-loc-label').value = loc ? (loc.label || '') : '';
    section.querySelector('#grh-loc-address').value = loc ? (loc.address || '') : '';
    section.querySelector('#grh-loc-barangay').value = loc ? (loc.barangay || '') : '';
    section.querySelector('#grh-loc-city').value = loc ? (loc.city || '') : '';
    section.querySelector('#grh-loc-province').value = loc ? (loc.province || '') : '';
    section.querySelector('#grh-loc-default').checked = !!(loc && loc.is_default);
    section.querySelector('#grh-location-form-title').textContent = loc ? 'Edit saved location' : 'Add a saved location';
    section.querySelector('#grh-location-submit').textContent = loc ? 'Confirm pin & update' : 'Confirm pin & save';
  }

  async function renderLocations(container, section) {
    const data = await API.get('/profile/locations');
    const locations = data.locations || [];
    locationCache = locations;
    container.innerHTML = locations.length ? locations.map((loc) => `
      <article class="grh-saved-location" data-id="${loc.id}">
        <div class="grh-location-pin" aria-hidden="true">📍</div>
        <div class="grow">
          <div class="grh-location-title">${escText(loc.label)} ${loc.is_default ? '<span class="verified-chip">Default</span>' : ''}</div>
          <div class="grh-location-address">${escText([loc.address, loc.barangay, loc.city, loc.province].filter(Boolean).join(', ') || 'GPS verified location')}</div>
          <div class="grh-location-meta">✓ GPS verified · accuracy ±${Math.round(Number(loc.accuracy_m || 0))} m</div>
        </div>
        <div class="grh-location-actions">
          <button type="button" class="btn btn-outline btn-sm" data-action="edit">Edit pin & details</button>
          ${loc.is_default ? '' : `<button type="button" class="btn btn-outline btn-sm" data-action="default">Set default</button>`}
          <button type="button" class="btn btn-danger btn-sm" data-action="delete">Delete</button>
        </div>
      </article>`).join('') : '<div class="grh-empty-location">No saved locations yet. Add a place and confirm its pin using your current GPS.</div>';

    container.querySelectorAll('[data-action]').forEach((btn) => btn.addEventListener('click', async () => {
      const card = btn.closest('[data-id]');
      const id = card && card.dataset.id;
      if (!id) return;
      const location = locationCache.find((item) => String(item.id) === String(id));
      if (btn.dataset.action === 'edit') {
        fillLocationForm(section, location);
        const form = section.querySelector('#grh-location-form');
        form.hidden = false;
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        try { await openMapPicker(section, location); } catch (e) { Root.toast(e.message, 'error'); }
        return;
      }
      try {
        btn.disabled = true;
        if (btn.dataset.action === 'delete') await API.del(`/profile/locations/${id}`);
        if (btn.dataset.action === 'default') await API.request('PATCH', `/profile/locations/${id}`, { is_default: true });
        await renderLocations(container, section);
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
        <div class="grh-profile-photo-wrap">${avatarMarkup(u)}</div>
        <div class="grow"><div class="grh-profile-kicker">PROFILE</div><h2>${escText(u.full_name || 'Your profile')}</h2><p>Add a clear profile photo so renters and owners can recognize who they are dealing with.</p><label class="btn btn-outline grh-upload-profile-btn">Change profile photo<input id="grh-profile-photo-input" type="file" accept="image/png,image/jpeg,image/webp" hidden></label></div>
      </div>
      <div class="grh-location-card">
        <div class="grh-location-head">
          <div><div class="grh-profile-kicker">SAVED LOCATIONS</div><h2>Your trusted places</h2><p>Like Grab: capture your GPS, place the pin on the exact spot, then save the address. This pin powers GoRentHive's distance and radius filtering.</p></div>
          <button type="button" class="btn btn-primary" id="grh-add-location">Add location</button>
        </div>
        <div id="grh-saved-locations"><div class="spinner"></div></div>
        <form id="grh-location-form" class="grh-location-form" hidden>
          <div class="grh-location-form-head"><div><span class="grh-step-chip">STEP 1</span><h3 id="grh-location-form-title">Add a saved location</h3></div><button type="button" class="btn btn-outline btn-sm" id="grh-use-current-location">Use current GPS</button></div>
          <div class="grh-map-shell"><div id="grh-location-map" class="grh-location-map" aria-label="Adjust saved location pin on map"></div><div class="grh-map-crosshair" aria-hidden="true">⌖</div></div>
          <div id="grh-map-status" class="grh-map-status">Tap “Use current GPS” to verify your position and place the pin.</div>
          <div class="grh-location-details-head"><span class="grh-step-chip">STEP 2</span><strong>Add address details</strong><small>The map pin is used for radius filtering. These labels help people recognize the place.</small></div>
          <div class="field"><label for="grh-loc-label">Save as</label><input id="grh-loc-label" maxlength="60" placeholder="Home, Office, Warehouse"></div>
          <div class="field"><label for="grh-loc-address">House / street / landmark</label><input id="grh-loc-address" maxlength="180" placeholder="e.g. Near subdivision gate or building entrance"></div>
          <div class="grh-location-grid"><div class="field"><label for="grh-loc-barangay">Barangay</label><input id="grh-loc-barangay" maxlength="80"></div><div class="field"><label for="grh-loc-city">City / Municipality</label><input id="grh-loc-city" maxlength="80"></div><div class="field"><label for="grh-loc-province">Province</label><input id="grh-loc-province" maxlength="80"></div></div>
          <label class="grh-default-check"><input type="checkbox" id="grh-loc-default"> Make this my default location for nearby searches</label>
          <div class="grh-gps-security-note">🔒 Your exact pin stays private. GoRentHive uses it internally for distance calculations. The pin can only be adjusted near a fresh GPS reading.</div>
          <div class="grh-location-form-actions"><button type="button" class="btn btn-outline" id="grh-cancel-location">Cancel</button><button type="submit" class="btn btn-primary" id="grh-location-submit">Confirm pin & save</button></div>
        </form>
      </div>`;
    host.prepend(section);
    syncLegacyProfileAvatar();

    const photoInput = section.querySelector('#grh-profile-photo-input');
    photoInput?.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      try {
        const url = await uploadProfilePhoto(file);
        section.querySelector('.grh-profile-photo-wrap').innerHTML = `<img src="${escText(url)}" alt="${escText(u.full_name || 'Profile')}" class="grh-profile-photo">`;
        Root.toast('Profile photo updated.', 'success');
      } catch (e) { Root.toast(e.message, 'error'); }
      finally { photoInput.value = ''; }
    });

    const form = section.querySelector('#grh-location-form');
    const list = section.querySelector('#grh-saved-locations');
    section.querySelector('#grh-add-location')?.addEventListener('click', async () => {
      fillLocationForm(section, null);
      form.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      resetMapState();
      try { await openMapPicker(section, null); } catch (e) { Root.toast(e.message, 'error'); }
    });
    section.querySelector('#grh-use-current-location')?.addEventListener('click', async () => {
      try { await openMapPicker(section, null); } catch (e) { Root.toast(e.message, 'error'); }
    });
    section.querySelector('#grh-cancel-location')?.addEventListener('click', () => { editingLocationId = null; form.hidden = true; form.reset(); resetMapState(); });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = section.querySelector('#grh-location-submit');
      try {
        if (!verifiedGps || !selectedPin) throw new Error('Verify your GPS and confirm the map pin first.');
        submit.disabled = true;
        submit.textContent = 'Verifying pin…';
        const payload = {
          latitude: selectedPin.latitude,
          longitude: selectedPin.longitude,
          gps_latitude: verifiedGps.latitude,
          gps_longitude: verifiedGps.longitude,
          gps_accuracy_m: verifiedGps.accuracy_m,
          gps_captured_at: verifiedGps.captured_at,
          source: 'gps',
          label: section.querySelector('#grh-loc-label').value,
          address: section.querySelector('#grh-loc-address').value,
          barangay: section.querySelector('#grh-loc-barangay').value,
          city: section.querySelector('#grh-loc-city').value,
          province: section.querySelector('#grh-loc-province').value,
          is_default: section.querySelector('#grh-loc-default').checked,
        };
        const editing = editingLocationId;
        submit.textContent = 'Saving…';
        if (editing) await API.request('PATCH', `/profile/locations/${editing}`, payload);
        else await API.post('/profile/locations', payload);
        editingLocationId = null;
        form.reset();
        form.hidden = true;
        resetMapState();
        await renderLocations(list, section);
        Root.toast('Location pin verified and saved.', 'success');
      } catch (e) { Root.toast(e.message, 'error'); }
      finally { submit.disabled = false; submit.textContent = editingLocationId ? 'Confirm pin & update' : 'Confirm pin & save'; }
    });

    try { await renderLocations(list, section); } catch (e) { list.innerHTML = '<div class="grh-empty-location">Saved locations are unavailable until the latest database migration is applied.</div>'; }
  }

  if (originalViewProfile) {
    Root.viewProfile = async function viewProfileWithSavedLocations() {
      await originalViewProfile();
      await mountProfileTools();
    };
  }
})();
