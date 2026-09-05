# GoRentHive verification providers

GoRentHive sends account-verification messages directly from the server. No generic webhook relay is required.

## Email — Resend

Required Render environment variables:

```text
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=GoRentHive <verify@mail.gorenthive.online>
```

Production setup:

1. Create a Resend account.
2. Add and verify a sending domain or subdomain, recommended: `mail.gorenthive.online`.
3. Add the DNS records Resend provides until the domain shows as verified.
4. Create a Resend API key with permission to send email.
5. Add the key to Render as `RESEND_API_KEY`.
6. Set `RESEND_FROM_EMAIL` to an address on the verified domain.

GoRentHive sends verification mail through `POST https://api.resend.com/emails` using Bearer authorization. Verification links expire after 30 minutes.

## SMS OTP — Semaphore Philippines

Required Render environment variables:

```text
SEMAPHORE_API_KEY=...
SEMAPHORE_SENDER_NAME=GORENTHIVE
```

Production setup:

1. Create a Semaphore account.
2. Add SMS credits.
3. Create/copy the Semaphore API key.
4. Register/approve a sender name such as `GORENTHIVE`.
5. Add the API key and sender name to Render.

GoRentHive uses Semaphore's dedicated OTP endpoint:

```text
POST https://api.semaphore.co/api/v4/otp
```

GoRentHive generates the six-digit code server-side and passes it to Semaphore using the endpoint's custom `code` parameter. OTPs expire after 10 minutes and are limited to five incorrect attempts.

## Render variables

The complete verification section should contain only:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
SEMAPHORE_API_KEY
SEMAPHORE_SENDER_NAME
```

The old variables below are retired and should be removed from Render once the direct-provider deployment is live:

```text
SMS_SENDER_WEBHOOK_URL
SMS_SENDER_WEBHOOK_SECRET
EMAIL_SENDER_WEBHOOK_URL
EMAIL_SENDER_WEBHOOK_SECRET
```

## Security

Never expose provider API keys in `public/`, browser JavaScript, screenshots, support messages, or Git commits. They belong only in Render's server-side environment.

Production intentionally fails closed if either verification provider is not configured. The readiness endpoint reports `smsVerificationSender` and `emailVerificationSender` as false until the required variables are present.
