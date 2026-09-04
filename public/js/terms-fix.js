/* GoRentHive Terms acceptance hotfix.
 * app.js historically defines Root.acceptTerms twice: once for the mandatory
 * account Terms modal and later for individual legal-document acceptance.
 * The later definition overwrites the first one, so clicking the mandatory
 * Terms button calls /legal/undefined/accept and leaves the modal open.
 * This compatibility handler supports both call sites explicitly.
 */
(() => {
  if (!window.Root || !window.API) return;

  function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
  }

  Root.acceptTerms = async function (legalType) {
    // A type argument means the button came from /legal/:type, not the
    // mandatory account-wide Terms update modal.
    if (legalType) {
      try {
        await API.post('/legal/' + encodeURIComponent(legalType) + '/accept');
        this.toast('Accepted', 'success');
      } catch (e) {
        this.toast(e.message || 'Could not save acceptance', 'error');
      }
      return;
    }

    const button = [...document.querySelectorAll('.modal-backdrop button')]
      .find((b) => /accept the terms/i.test(b.textContent || ''));
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving acceptance…';
    }

    try {
      await API.post('/auth/terms/accept');
      // Mark accepted immediately so promptTerms cannot reopen the blocker
      // while /auth/me catches up with the database write.
      this.state.termsAccepted = true;
      closeAllModals();
      this.renderNav();
      this.toast('Terms accepted', 'success');

      // Reconcile with the server in the background. A failed refresh must not
      // reopen a modal after a successful acceptance POST.
      try {
        const d = await API.get('/auth/me');
        if (d && d.user) this.state.user = d.user;
        if (d && d.verification) this.state.verification = d.verification;
        if (d && d.termsAccepted !== undefined) this.state.termsAccepted = !!d.termsAccepted;
      } catch (_) {}
    } catch (e) {
      if (button) {
        button.disabled = false;
        button.textContent = 'I accept the Terms & Conditions';
      }
      this.toast('Could not save acceptance: ' + (e.message || 'Please try again'), 'error');
    }
  };
})();
