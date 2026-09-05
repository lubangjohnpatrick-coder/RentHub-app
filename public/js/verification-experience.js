/* GoRentHive verification UX hardening.
 * Keeps production verification understandable: successful sends show feedback,
 * emailed verification links are consumed automatically for signed-in users,
 * and the verification center displays the actual account destinations.
 */
(() => {
  'use strict';
  if (!window.Root || !window.API) return;

  const originalViewVerify = Root.viewVerify ? Root.viewVerify.bind(Root) : null;
  const originalSendMobileOtp = Root.sendMobileOtp ? Root.sendMobileOtp.bind(Root) : null;

  function verificationQueryToken() {
    const fromState = Root.state && Root.state.params && Root.state.params.query && Root.state.params.query.token;
    if (fromState) return String(fromState);
    try { return new URLSearchParams(location.search).get('token') || ''; } catch (_) { return ''; }
  }

  function updateVerificationNotes() {
    const app = document.getElementById('app');
    const user = Root.state && Root.state.user;
    if (!app || !user) return;
    app.querySelectorAll('.list-row').forEach((row) => {
      const title = row.querySelector('.t');
      const note = row.querySelector('.s');
      if (!title || !note) return;
      const label = (title.textContent || '').trim().toLowerCase();
      if (label.startsWith('email address') && user.email) {
        note.textContent = user.email_verified ? `Verified: ${user.email}` : `Verification will be sent to ${user.email}`;
      }
      if (label.startsWith('phone number')) {
        if (user.phone) note.textContent = user.mobile_verified ? `Verified: ${user.phone}` : `SMS code will be sent to ${user.phone}`;
        else note.textContent = 'No mobile number is saved on this account yet.';
      }
    });
  }

  Root.requestOtp = async function requestOtp() {
    try {
      const d = await API.post('/auth/verify/mobile/send');
      const el = document.getElementById('otp-demo');
      if (d && d.demoCode && el) el.textContent = 'Demo only: your code is ' + d.demoCode;
      if (d && d.alreadyVerified) {
        this.toast('Your mobile number is already verified.', 'success');
        this.closeModal();
        return this.refreshUser();
      }
      this.toast(`Verification code sent${this.state.user && this.state.user.phone ? ' to ' + this.state.user.phone : ''}.`, 'success', 3500);
    } catch (e) {
      this.toast(e.message, 'error', 5000);
    }
  };

  Root.resendOtp = async function resendOtp() {
    try {
      const d = await API.post('/auth/verify/mobile/resend');
      const el = document.getElementById('otp-demo');
      if (d && d.demoCode && el) el.textContent = 'Demo only: your code is ' + d.demoCode;
      if (d && d.alreadyVerified) {
        this.toast('Your mobile number is already verified.', 'success');
        this.closeModal();
        return this.refreshUser();
      }
      this.toast('A new verification code was sent.', 'success', 3500);
    } catch (e) {
      this.toast(e.message, 'error', 5000);
    }
  };

  Root.sendEmailVerifyLink = async function sendEmailVerifyLink() {
    try {
      const d = await API.post('/auth/verify/email/send');
      const el = document.getElementById('em-demo');
      if (d && d.demoToken && el) el.textContent = 'Demo only: token is ' + d.demoToken;
      if (d && d.alreadyVerified) {
        this.toast('Your email address is already verified.', 'success');
        this.closeModal();
        return this.refreshUser();
      }
      this.toast(`Verification email sent${this.state.user && this.state.user.email ? ' to ' + this.state.user.email : ''}.`, 'success', 4000);
    } catch (e) {
      this.toast(e.message, 'error', 5000);
    }
  };

  Root.sendMobileOtp = function sendMobileOtp() {
    const phone = String((this.state.user && this.state.user.phone) || '').trim();
    if (!phone) {
      this.toast('No mobile number is saved on this account. Update the account number before requesting an SMS code.', 'error', 5000);
      return;
    }
    if (originalSendMobileOtp) return originalSendMobileOtp();
  };

  Root.viewVerify = async function hardenedViewVerify() {
    if (originalViewVerify) await originalViewVerify();
    updateVerificationNotes();

    const token = verificationQueryToken();
    if (!token || !this.state.user || this.state.user.email_verified || this._emailTokenProcessing) return;
    this._emailTokenProcessing = true;
    try {
      const result = await API.post('/auth/verify/email', { token });
      if (result && result.user) this.state.user = result.user;
      this.toast('Email verified successfully.', 'success', 4000);
      history.replaceState(null, '', '/verify');
      await this.loadUser();
      return originalViewVerify ? originalViewVerify() : undefined;
    } catch (e) {
      this.toast(e.message, 'error', 5000);
    } finally {
      this._emailTokenProcessing = false;
    }
  };
})();
