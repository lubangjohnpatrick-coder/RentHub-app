/* GoRentHive verification UX hardening.
 * Production verification never exposes demo credentials. The UI reports
 * sender status clearly and surfaces provider/configuration errors in-place.
 */
(() => {
  'use strict';
  if (!window.Root || !window.API) return;

  const originalViewVerify = Root.viewVerify ? Root.viewVerify.bind(Root) : null;

  function verificationQueryToken() {
    const fromState = Root.state && Root.state.params && Root.state.params.query && Root.state.params.query.token;
    if (fromState) return String(fromState);
    try { return new URLSearchParams(location.search).get('token') || ''; } catch (_) { return ''; }
  }

  function safeText(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function setStatus(id, message, tone = 'neutral') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.style.color = tone === 'error' ? 'var(--red, #b42318)'
      : tone === 'success' ? 'var(--green, #16875f)'
        : 'var(--ink-soft)';
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

  function scrubLegacyDemoText() {
    ['otp-demo', 'em-demo'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && /undefined|demo only/i.test(el.textContent || '')) el.textContent = '';
    });
  }

  Root.sendMobileOtp = function sendMobileOtp() {
    const phone = String((this.state.user && this.state.user.phone) || '').trim();
    if (!phone) {
      this.toast('No mobile number is saved on this account. Update your mobile number before requesting a code.', 'error', 5000);
      return;
    }

    this.modal(`Verify your mobile number
      <p style="font-size:13px;color:var(--ink-soft);margin-top:4px">A 6-digit code will be sent by SMS to <b>${safeText(phone)}</b>. It expires in 10 minutes.</p>
      <div class="form-row"><label>6-digit code</label><input id="otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></div>
      <button class="btn btn-primary btn-block" onclick="Root.confirmMobileOtp()">Verify code</button>
      <button class="btn btn-link btn-block" style="margin-top:6px;color:var(--brand)" onclick="Root.resendOtp()">Resend code</button>
      <div id="otp-status" role="status" aria-live="polite" style="font-size:12px;color:var(--ink-soft);margin-top:10px">Preparing SMS…</div>`, 'close');
    this.requestOtp();
  };

  Root.requestOtp = async function requestOtp() {
    const phone = String((this.state.user && this.state.user.phone) || '').trim();
    setStatus('otp-status', 'Sending verification code…');
    scrubLegacyDemoText();
    try {
      const d = await API.post('/auth/verify/mobile/send');
      if (d && d.alreadyVerified) {
        setStatus('otp-status', 'This mobile number is already verified.', 'success');
        this.toast('Your mobile number is already verified.', 'success');
        this.closeModal();
        return this.refreshUser();
      }
      if (d && d.demoCode) {
        // Development-only response. Production never returns the OTP.
        setStatus('otp-status', `Development code: ${d.demoCode}`, 'success');
      } else {
        setStatus('otp-status', `Code sent to ${phone}. Check your SMS inbox; delivery can take a minute.`, 'success');
      }
      this.toast(`Verification code sent${phone ? ' to ' + phone : ''}.`, 'success', 3500);
    } catch (e) {
      const message = e && e.message ? e.message : 'Could not send the verification code.';
      setStatus('otp-status', message, 'error');
      this.toast(message, 'error', 6000);
    }
  };

  Root.resendOtp = async function resendOtp() {
    const phone = String((this.state.user && this.state.user.phone) || '').trim();
    setStatus('otp-status', 'Requesting a new code…');
    scrubLegacyDemoText();
    try {
      const d = await API.post('/auth/verify/mobile/resend');
      if (d && d.alreadyVerified) {
        setStatus('otp-status', 'This mobile number is already verified.', 'success');
        this.toast('Your mobile number is already verified.', 'success');
        this.closeModal();
        return this.refreshUser();
      }
      if (d && d.demoCode) setStatus('otp-status', `Development code: ${d.demoCode}`, 'success');
      else setStatus('otp-status', `A new code was sent to ${phone}.`, 'success');
      this.toast('A new verification code was sent.', 'success', 3500);
    } catch (e) {
      const message = e && e.message ? e.message : 'Could not resend the verification code.';
      setStatus('otp-status', message, 'error');
      this.toast(message, 'error', 6000);
    }
  };

  Root.sendEmailVerify = function sendEmailVerify() {
    const email = String((this.state.user && this.state.user.email) || '').trim();
    if (!email) {
      this.toast('No email address is saved on this account.', 'error', 5000);
      return;
    }
    this.modal(`Verify your email address
      <p style="font-size:13px;color:var(--ink-soft);margin-top:4px">We'll send a verification link to <b>${safeText(email)}</b>. Open the email and tap <b>Verify email</b>.</p>
      <button class="btn btn-primary btn-block" onclick="Root.sendEmailVerifyLink()">Send verification email</button>
      <div id="email-status" role="status" aria-live="polite" style="font-size:12px;color:var(--ink-soft);margin-top:10px">Ready to send.</div>`, 'close');
    this.sendEmailVerifyLink();
  };

  Root.sendEmailVerifyLink = async function sendEmailVerifyLink() {
    const email = String((this.state.user && this.state.user.email) || '').trim();
    setStatus('email-status', 'Sending verification email…');
    scrubLegacyDemoText();
    try {
      const d = await API.post('/auth/verify/email/send');
      if (d && d.alreadyVerified) {
        setStatus('email-status', 'This email address is already verified.', 'success');
        this.toast('Your email address is already verified.', 'success');
        this.closeModal();
        return this.refreshUser();
      }
      setStatus('email-status', `Verification email sent to ${email}. Check your inbox and spam folder.`, 'success');
      this.toast(`Verification email sent${email ? ' to ' + email : ''}.`, 'success', 4000);
    } catch (e) {
      const message = e && e.message ? e.message : 'Could not send the verification email.';
      setStatus('email-status', message, 'error');
      this.toast(message, 'error', 6000);
    }
  };

  Root.viewVerify = async function hardenedViewVerify() {
    if (originalViewVerify) await originalViewVerify();
    updateVerificationNotes();
    scrubLegacyDemoText();

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

  // Clean up any already-rendered legacy demo status when this patch loads.
  queueMicrotask(scrubLegacyDemoText);
})();
