'use strict';

const assert = require('assert');
const {
  getVerificationProviderConfig,
  sendVerificationEmail,
  sendVerificationSms,
} = require('./verification-providers');

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body == null ? '' : JSON.stringify(body); },
  };
}

async function main() {
  const previous = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    SEMAPHORE_API_KEY: process.env.SEMAPHORE_API_KEY,
    SEMAPHORE_SENDER_NAME: process.env.SEMAPHORE_SENDER_NAME,
  };

  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RESEND_FROM_EMAIL = 'GoRentHive <verify@mail.gorenthive.online>';
  process.env.SEMAPHORE_API_KEY = 'sem_test_key';
  process.env.SEMAPHORE_SENDER_NAME = 'GORENTHIVE';

  try {
    const cfg = getVerificationProviderConfig();
    assert.equal(cfg.email.provider, 'resend');
    assert.equal(cfg.sms.provider, 'semaphore');
    assert.equal(cfg.email.configured, true);
    assert.equal(cfg.sms.configured, true);

    let emailRequest = null;
    const email = await sendVerificationEmail({
      to: 'user@example.com',
      verifyUrl: 'https://gorenthive.online/verify?token=abc123',
      fetchImpl: async (url, options) => {
        emailRequest = { url, options };
        return fakeResponse(200, { id: 'email_123' });
      },
    });
    assert.equal(email.provider, 'resend');
    assert.equal(email.providerId, 'email_123');
    assert.equal(emailRequest.url, 'https://api.resend.com/emails');
    assert.equal(emailRequest.options.headers.authorization, 'Bearer re_test_key');
    const emailPayload = JSON.parse(emailRequest.options.body);
    assert.equal(emailPayload.from, 'GoRentHive <verify@mail.gorenthive.online>');
    assert.deepEqual(emailPayload.to, ['user@example.com']);
    assert(emailPayload.html.includes('Verify email'));
    assert(emailPayload.text.includes('https://gorenthive.online/verify?token=abc123'));

    let smsRequest = null;
    const sms = await sendVerificationSms({
      to: '+639171234567',
      code: '123456',
      fetchImpl: async (url, options) => {
        smsRequest = { url, options };
        return fakeResponse(200, [{ message_id: 77, status: 'Pending' }]);
      },
    });
    assert.equal(sms.provider, 'semaphore');
    assert.equal(sms.providerId, 77);
    assert.equal(smsRequest.url, 'https://api.semaphore.co/api/v4/otp');
    const smsForm = new URLSearchParams(smsRequest.options.body);
    assert.equal(smsForm.get('apikey'), 'sem_test_key');
    assert.equal(smsForm.get('sendername'), 'GORENTHIVE');
    assert.equal(smsForm.get('number'), '+639171234567');
    assert.equal(smsForm.get('code'), '123456');
    assert(smsForm.get('message').includes('{otp}'));

    console.log('Verification provider tests passed.');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
