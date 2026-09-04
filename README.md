# GoRentHive 🐝

**Rent What You Need. Earn From What You Own.**

GoRentHive is a Philippine peer-to-peer rental marketplace. One account can both rent items and list items for rent. The platform provides discovery, verified-radius search, booking workflow, protected payment state, digital rental agreements, condition evidence, security-deposit accounting, reviews, disputes, and an 8% owner-side marketplace commission.

## Production principles

- **One user account:** renters can become owners and owners can rent.
- **8% marketplace commission:** deducted from completed owner rental earnings.
- **Security deposits are separate:** deposits are not GoRentHive revenue.
- **No GoRentHive delivery service:** owners and renters arrange pickup or meetup themselves.
- **Verified-radius discovery:** nearby search is based on recent verified GPS coordinates and server-side distance calculation.
- **Private evidence:** identity and rental-condition media use private storage and short-lived signed access.
- **Booking-specific agreements:** approved bookings keep a snapshot of the applicable agreement and late-fee rules.
- **Provider-authoritative payments:** the internal ledger records platform state; the payment provider remains the source of truth for actual money movement.

## Stack

- Node.js 22+
- Express 4
- Supabase
- Vanilla JavaScript SPA
- Progressive Web App / service worker
- Capacitor 6 tooling for Android packaging
- PayMongo integration foundation; alternative providers can be added behind a provider boundary

## Local setup

```bash
npm ci
npm run qa
npm start
```

The server listens on `PORT` (default `4000`).

Do not commit production credentials. Configure secrets through local environment variables and the deployment platform.

## Required environment variables

The exact set depends on enabled capabilities, but production normally includes:

```text
NODE_ENV=production
PUBLIC_BASE_URL=https://gorenthive.online
CANON_HOST=gorenthive.online

SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

GATEWAY=paymongo
PAYMONGO_PUBLIC_KEY=...
PAYMONGO_SECRET_KEY=...
PAYMONGO_WEBHOOK_SECRET=...
```

Additional email/SMS verification variables are required when those providers are enabled.

**Never expose `SUPABASE_SERVICE_ROLE_KEY`, `PAYMONGO_SECRET_KEY`, or webhook secrets in browser JavaScript, GitHub, screenshots, or client-side configuration.**

## Database migrations

Apply production migrations through Supabase before deploying server code that depends on them:

```text
supabase/migrations/2026-09-04-launch-hardening.sql
supabase/migrations/2026-09-04-location-hardening.sql
supabase/migrations/2026-09-04-private-media.sql
supabase/migrations/2026-09-04-deployment-readiness.sql
```

Do not rerun the original schema file against an existing production database unless you have explicitly reviewed the consequences.

## Transaction lifecycle

```text
Renter request
  → owner approval
  → payment confirmation
  → both parties sign booking-specific agreement
  → pre-rental condition evidence + counterparty confirmation
  → handover / active rental
  → return evidence
  → owner acceptance or dispute
  → deposit resolution
  → owner payout eligibility
  → review
```

Agreement signing does not by itself activate a rental. Handover requirements are enforced separately.

## Payment model

For a rental amount of `R`:

```text
GoRentHive commission = R × 8%
Owner rental proceeds = R − commission
Security deposit      = separate refundable amount
```

The 8% commission applies to the rental amount, not to the refundable security deposit. GoRentHive does not charge a platform-operated delivery fee.

Payment gateway callbacks must be verified server-side. PayMongo webhook handling fails closed when the webhook secret is missing or the signature is invalid.

## Location model

Nearby discovery uses:

```text
recent device GPS
  → accuracy/freshness validation
  → verified location record
  → server-side radius calculation
  → nearby listings
```

Manual map pins or typed coordinates are not treated as GPS-verified locations. Exact private listing coordinates should not be exposed in public nearby-search responses.

Browser geolocation cannot be made impossible to spoof. Native mobile builds can later add stronger device-attestation and mock-location controls.

## Frontend architecture

The production asset ownership is intentionally small:

```text
public/
├─ index.html
├─ css/
│  ├─ styles.css             # legacy/base component structure
│  ├─ launch-ready.css       # launch-specific functional surfaces
│  └─ app-theme.css          # single production visual/theme owner
├─ js/
│  ├─ api.js                 # API client/helpers
│  ├─ app.js                 # legacy core SPA router/views
│  ├─ location-hardening.js  # verified GPS behavior
│  ├─ launch-ready.js        # hardened launch workflows
│  ├─ private-media.js       # signed/private evidence media
│  ├─ legal-acceptance.js    # compatibility boundary for Terms/legal acceptance
│  └─ ui-shell.js            # nav/footer/homepage presentation owner
├─ service-worker.js
└─ manifest.webmanifest
```

`app.js` is still a large legacy core. New presentation behavior should **not** be added there by default. New work should follow component ownership instead of creating more override files.

Do not add new visual patch files for one page. Extend `app-theme.css` or the responsible component. Security, payment, verification, or legal state belongs in a dedicated module, never in `ui-shell.js`.

## Server architecture

High-risk behavior is server-authoritative. Important modules include:

```text
server/
├─ index.js
├─ booking-v2.js
├─ launch-hardening.js
├─ location.js
├─ rental-policy.js
├─ paymongo-webhook.js
├─ financial.js
├─ private.js
├─ upload.js
├─ verification-v2.js
├─ ledger.js
└─ settings.js
```

Hardened routers are intentionally mounted before legacy/general routes where route overlap exists.

## Quality gates

```bash
npm run qa:syntax   # Node syntax validation for server and browser JS
npm run qa:assets   # local asset references, retired-file checks, shell integrity
npm run qa          # both checks
npm audit --omit=dev --audit-level=high
```

GitHub Actions runs the launch QA workflow for pull requests to `main` and pushes to `main`. The workflow also validates migration presence, payment/location hardening assertions, server route precedence, and production dependency security.

## PWA caching

Application code uses a **network-first** strategy so new deployments are not hidden by stale PWA caches. Static media can use cache-first behavior. When changing the app shell, update both `index.html` and `service-worker.js` and bump the cache version.

## Deployment checklist

Before accepting real transactions:

1. Apply all required Supabase migrations.
2. Verify Render/environment secrets are present and production-safe.
3. Confirm the payment provider account and webhook are approved/configured.
4. Run a complete two-account booking lifecycle in a production-like environment.
5. Test return, late-return, refund/deposit, and dispute paths.
6. Test responsive layouts on real Android/iPhone devices and desktop.
7. Have Philippine legal counsel review Terms, Privacy, Rental Agreement, deposit, damage, late-fee, and dispute language.

## Business/legal note

The software can enforce configured workflow rules, but code does not establish legal enforceability by itself. Commercial terms, consumer obligations, privacy handling, marketplace payment structure, and high-risk rental categories should receive appropriate Philippine legal/compliance review before full public launch.
