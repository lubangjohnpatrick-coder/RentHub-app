'use strict';

// Direct production delivery providers for GoRentHive account verification.
// Provider credentials remain server-side only.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEMAPHORE_OTP_ENDPOINT = 'https://api.semaphore.co/api/v4/otp';

class VerificationProviderError extends Error {
  constructor(message, code, status = 502) {
    super(message);
    this.name = 'VerificationProviderError';
    this.code = code;
    this.status = status;
  }
}

function clean(value) { return String(value || '').trim(); }

function getVerificationProviderConfig() {
  const resendApiKey = clean(process.env.RESEND_API_KEY);
  const resendFromEmail = clean(process.env.RESEND_FROM_EMAIL);
  const semaphoreApiKey = clean(process.env.SEMAPHORE_API_KEY);
  const semaphoreSenderName = clean(process.env.SEMAPHORE_SENDER_NAME);

  return {
    email: {
      provider: 'resend',
      configured: !!resendApiKey && !!resendFromEmail,
      apiKey: resendApiKey,
      from: resendFromEmail,
    },
    sms: {
      provider: 'semaphore',
      configured: !!semaphoreApiKey && !!semaphoreSenderName,
      apiKey: semaphoreApiKey,
      senderName: semaphoreSenderName,
    },
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function readProviderBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return text; }
}

async function sendVerificationEmail({ to, verifyUrl, expiresMinutes = 30, fetchImpl = fetch }) {
  const cfg = getVerificationProviderConfig().email;
  if (!cfg.configured) {
    throw new VerificationProviderError(
      'Email verification is not configured yet. Add RESEND_API_KEY and RESEND_FROM_EMAIL in Render.',
      'email_provider_required',
      503,
    );
  }

  const safeUrl = escapeHtml(verifyUrl);
  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#071A33">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="background:#ffffff;border-radius:20px;padding:32px;box-shadow:0 10px 30px rgba(7,26,51,.08)">
      <div style="font-size:26px;font-weight:800;margin-bottom:8px">Verify your GoRentHive email</div>
      <p style="font-size:15px;line-height:1.65;color:#5f6b7a">Confirm this email address to strengthen your account and unlock verified marketplace features.</p>
      <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#FFB800;color:#071A33;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px">Verify email</a></p>
      <p style="font-size:13px;line-height:1.6;color:#7b8794">This link expires in ${Number(expiresMinutes)} minutes. If you did not request this, you can ignore this email.</p>
      <p style="font-size:12px;line-height:1.6;color:#9aa4b2;word-break:break-all">${safeUrl}</p>
    </div>
  </div>
</body></html>`;

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: cfg.from,
      to: [to],
      subject: 'Verify your GoRentHive email',
      text: `Verify your GoRentHive email: ${verifyUrl}\n\nThis link expires in ${Number(expiresMinutes)} minutes.`,
      html,
    }),
  });

  const body = await readProviderBody(response);
  if (!response.ok) {
    throw new VerificationProviderError(
      'Resend could not send the verification email. Check the verified sending domain, API key, and sender address.',
      'resend_send_failed',
      502,
    );
  }
  return { ok: true, provider: 'resend', providerId: body && body.id ? body.id : null };
}

async function sendVerificationSms({ to, code, expiresMinutes = 10, fetchImpl = fetch }) {
  const cfg = getVerificationProviderConfig().sms;
  if (!cfg.configured) {
    throw new VerificationProviderError(
      'Mobile verification is not configured yet. Add SEMAPHORE_API_KEY and SEMAPHORE_SENDER_NAME in Render.',
      'sms_provider_required',
      503,
    );
  }

  const form = new URLSearchParams();
  form.set('apikey', cfg.apiKey);
  form.set('number', to);
  form.set('sendername', cfg.senderName);
  form.set('message', `Your GoRentHive verification code is {otp}. It expires in ${Number(expiresMinutes)} minutes. Do not share this code.`);
  form.set('code', code);

  const response = await fetchImpl(SEMAPHORE_OTP_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const body = await readProviderBody(response);
  const rows = Array.isArray(body) ? body : (body ? [body] : []);
  const rejected = rows.some((row) => row && String(row.status || '').toLowerCase() === 'failed');
  if (!response.ok || rejected) {
    throw new VerificationProviderError(
      'Semaphore could not send the verification SMS. Check your API key, credits, recipient number, and approved sender name.',
      'semaphore_send_failed',
      502,
    );
  }

  const first = rows[0] || {};
  return {
    ok: true,
    provider: 'semaphore',
    providerId: first.message_id || first.id || null,
    status: first.status || null,
  };
}

module.exports = {
  VerificationProviderError,
  getVerificationProviderConfig,
  sendVerificationEmail,
  sendVerificationSms,
};
