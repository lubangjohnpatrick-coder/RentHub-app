/* Private media adapter for identity documents and rental condition evidence. */
(() => {
  if (!window.Root || !window.API) return;

  async function uploadPrivate(files, scope, bookingId) {
    const fd = new FormData();
    [...files].forEach((f) => fd.append('files', f));
    let url = '/api/upload?scope=' + encodeURIComponent(scope);
    if (bookingId) url += '&booking_id=' + encodeURIComponent(bookingId);
    const res = await fetch(url, { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Upload failed');
    return body.urls || [];
  }

  Root.saveCondition = async function (id, phase) {
    const input = document.getElementById('ck-files');
    const files = input ? [...input.files] : [];
    if (files.length < 4) { this.toast('Upload at least 4 photos: front, back, left side and right side.', 'error', 4500); return; }
    if (files.length > 12) { this.toast('Maximum 12 evidence photos per condition record.', 'error'); return; }
    try {
      const photos = await uploadPrivate(files, 'evidence', id);
      const serial = document.getElementById('ck-serial')?.value || '';
      const acc = document.getElementById('ck-acc')?.value || '';
      const damage = document.getElementById('ck-damage')?.value || '';
      await API.post(`/bookings/${id}/condition`, { phase, photos, serial_number: serial, accessories: acc, damage_notes: damage });
      this.closeModal();
      this.toast('Condition evidence submitted privately. The other party must confirm it.', 'success', 4000);
      this.viewBookingDetail(id);
    } catch (e) { this.toast(e.message, 'error'); }
  };

  Root.submitIdentity = async function () {
    const id_type = document.getElementById('id-type')?.value || '';
    const id_number = (document.getElementById('id-num')?.value || '').trim();
    const file = document.getElementById('id-selfie')?.files?.[0];
    if (!id_type || !id_number) { this.toast('ID type and number are required.', 'error'); return; }
    if (!file) { this.toast('Upload the requested identity/selfie image.', 'error'); return; }
    try {
      const urls = await uploadPrivate([file], 'identity');
      await API.post('/auth/verify/identity', { id_type, id_number, selfie: urls[0] || '' });
      this.toast('Identity verification submitted for review.', 'success');
      this.closeModal();
      this.refreshUser();
    } catch (e) { this.toast(e.message, 'error'); }
  };

  const signing = new Map();
  async function sign(ref) {
    if (signing.has(ref)) return signing.get(ref);
    const p = API.get('/media/sign?ref=' + encodeURIComponent(ref)).then((r) => r.url).finally(() => signing.delete(ref));
    signing.set(ref, p);
    return p;
  }

  async function hydratePrivateImages(root = document) {
    const imgs = [...root.querySelectorAll('img')].filter((img) => String(img.getAttribute('src') || '').startsWith('private://') && !img.dataset.privateLoading);
    for (const img of imgs) {
      const ref = img.getAttribute('src');
      img.dataset.privateLoading = '1';
      try {
        img.src = await sign(ref);
        img.dataset.privateRef = ref;
      } catch (_) {
        img.alt = 'Private image unavailable';
        img.removeAttribute('src');
      } finally {
        delete img.dataset.privateLoading;
      }
    }
  }

  const app = document.getElementById('app');
  if (app) {
    new MutationObserver(() => hydratePrivateImages(app)).observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    setTimeout(() => hydratePrivateImages(app), 0);
  }
})();
