# GoRentHive Architecture

## Production frontend

GoRentHive keeps source modules separated by responsibility but ships a compact production shell.

`server/build-assets.js` owns the explicit source order and generates:

- `public/dist/app.css`
- `public/dist/app.js`
- `public/dist/manifest.json`

The generated directory is intentionally not committed. Render builds it during deployment and Launch QA builds it before asset/performance tests.

The production HTML therefore loads only:

1. the Supabase browser vendor
2. `supabase-config.js`
3. `dist/app.js`
4. `dist/app.css`

Do not add a new production `<script>` or `<link rel="stylesheet">` for an application feature. Add the source module to the explicit bundle list instead.

## Source responsibilities

- `app.js` — SPA routing and legacy application shell
- `ui-shell.js` — public shell/navigation compatibility
- `marketplace-upgrades.js` / `marketplace-pro.js` — marketplace experience and account features
- `homepage-v2.js` — conversion homepage source
- `homepage-v2-fixes.js` — temporary integrity compatibility layer; should eventually be folded into the canonical homepage source
- `premium-finish.js` — small accessibility/integrity safeguards only, not business rules
- `motion.js` — presentation motion controller
- `private-media.js` — signed private-evidence viewer
- `payment-experience.js` — browser payment UX only; financial truth stays server-side

The remaining `v2`/compatibility naming is technical debt, but it is no longer a production network-layer cost. Future cleanup should merge compatibility code only when regression coverage proves behavior is unchanged.

## Server domains

Hardened routes are mounted before broad compatibility routes. Important domains include:

- authentication and verification
- listings and availability
- bookings
- payments and financial ledger
- messaging and notifications
- rental agreements
- condition evidence
- QR/PIN handover
- vehicle compliance and incidents
- owner/business verification
- admin operations

Financial mutations, private evidence access, regulatory verification and privileged state changes remain server-side.

## Deployment gates

A release is not production-ready until all of the following pass:

- Launch QA
- production bundle/asset audit
- production architecture/performance/accessibility budget test
- Supabase migrations applied in order
- readiness endpoint green with production providers
- desktop and mobile staging transaction completed end-to-end

## UI principles

- real listings only; no fabricated social proof or inventory
- exact private coordinates and identity documents never exposed publicly
- navy/honey-gold GoRentHive identity
- restrained motion that respects `prefers-reduced-motion`
- keyboard-visible focus states
- responsive layout from phone to desktop
- trust actions visible at the point of transaction, not hidden in legal copy
