/* GoRentHive location hardening overrides — loaded after app.js */
(() => {
  if (!window.Root) return;

  Root.verifyLocation = function () {
    const loc = this.state.meLocation || {};
    this.modal(`Verify your current location
      <p style="font-size:12.5px;color:var(--ink-soft);margin-top:4px">Nearby search uses your device GPS and a server-calculated radius. Manual coordinates cannot be marked as verified.</p>
      <p style="font-size:12.5px;color:var(--ink-soft);margin-top:6px">Your exact GPS coordinates are used for matching and are not shown in nearby-search results.</p>
      <p style="font-size:12.5px;color:var(--ink-soft);margin-top:6px">Status: <b>${esc(this.state.user.location_status || 'none')}</b>${loc.accuracy_m ? ` · accuracy about ${Math.round(loc.accuracy_m)} m` : ''}</p>
      <button class="btn btn-primary btn-block" style="margin-top:10px" onclick="Root.verifyLocationGps()">📍 Verify using current GPS</button>
      <p style="font-size:11px;color:var(--ink-soft);margin-top:8px">For best accuracy, enable Precise Location and move to an area with a clear GPS signal.</p>`, 'close');
  };

  Root.verifyLocationGps = async function () {
    if (!navigator.geolocation) { this.toast('GPS is not supported on this device', 'error'); return; }
    this.toast('Getting a high-accuracy GPS fix…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const payload = {
            source: 'gps',
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
            captured_at: pos.timestamp || Date.now(),
          };
          const r = await API.post('/auth/verify-location', payload);
          this.state.meLocation = r.location || null;
          this.closeModal();
          this.toast(`Location verified${r.location && r.location.accuracy_m ? ' (±' + Math.round(r.location.accuracy_m) + ' m)' : ''}`, 'success');
          await this.refreshUser();
        } catch (e) { this.toast(e.message, 'error'); }
      },
      (err) => this.toast('Could not get an accurate GPS location: ' + (err.message || 'permission denied'), 'error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  Root.verifyLocationManual = function () {
    this.toast('Manual coordinates can be saved as an address, but they cannot be used as a verified location. Use device GPS.', 'error', 4500);
  };
})();
