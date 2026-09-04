/*
 * GoRentHive legal acceptance adapter.
 *
 * Legacy app.js exposes two historical Root.acceptTerms call shapes:
 *   Root.acceptTerms()       -> mandatory account Terms update
 *   Root.acceptTerms(type)   -> individual legal document acceptance
 *
 * This module intentionally owns that compatibility boundary until app.js is
 * split into route modules. Do not move this behavior into presentation code.
 */
(() => {
  'use strict';

  if (!window.Root || !window.API) return;

  function closeModalStack() {
    document.querySelectorAll('.modal-backdrop').forEach((element) => element.remove());
  }

  function findMandatoryTermsButton() {
    return [...document.querySelectorAll('.modal-backdrop button')]
      .find((button) => /accept the terms/i.test(button.textContent || '')) || null;
  }

  async function acceptLegalDocument(type) {
    try {
      await API.post(`/legal/${encodeURIComponent(type)}/accept`);
      Root.toast('Accepted', 'success');
    } catch (error) {
      Root.toast(error.message || 'Could not save acceptance', 'error');
    }
  }

  async function acceptAccountTerms() {
    const button = findMandatoryTermsButton();
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving acceptance…';
    }

    try {
      await API.post('/auth/terms/accept');

      // Update local state before reconciliation so the blocking modal cannot
      // reopen while /auth/me catches up with the successful write.
      Root.state.termsAccepted = true;
      closeModalStack();
      Root.renderNav();
      Root.toast('Terms accepted', 'success');

      try {
        const response = await API.get('/auth/me');
        if (response?.user) Root.state.user = response.user;
        if (response?.verification) Root.state.verification = response.verification;
        if (response?.termsAccepted !== undefined) Root.state.termsAccepted = !!response.termsAccepted;
      } catch (_) {
        // The acceptance POST already succeeded. A reconciliation read failure
        // must not undo that state or re-block the user.
      }
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = 'I accept the Terms & Conditions';
      }
      Root.toast(`Could not save acceptance: ${error.message || 'Please try again'}`, 'error');
    }
  }

  Root.acceptTerms = async function acceptTerms(type) {
    if (type) return acceptLegalDocument(type);
    return acceptAccountTerms();
  };
})();
