# GoRentHive Frontend Architecture

This document defines production ownership so new features do not recreate the old override-stack problem.

## Runtime ownership

1. `public/js/api.js` — HTTP/API client only.
2. `public/js/app.js` — core SPA state, routing and legacy feature views.
3. `public/js/location-hardening.js` — verified GPS/radius behavior only.
4. `public/js/launch-ready.js` — hardened rental lifecycle and launch-specific marketplace behavior.
5. `public/js/private-media.js` — private evidence/identity media only.
6. `public/js/legal-acceptance.js` — Terms/legal acceptance compatibility only.
7. `public/js/ui-shell.js` — presentation shell for navigation branding and homepage only.

Do not add another file that monkey-patches `Root.viewHome`, `Root.renderNav`, or `Root.init`. Extend the existing owner instead.

## CSS ownership

1. `public/css/styles.css` — legacy/base components and layout primitives.
2. `public/css/launch-ready.css` — launch-flow-specific components.
3. `public/css/app-theme.css` — final production theme and homepage presentation.

Do not add another `*-refresh.css`, `*-redesign.css`, `*-hotfix.css`, or reference stylesheet. Production visual changes belong in `app-theme.css`.

## Engineering rules

- Business decisions are server-authoritative.
- Never trust client-provided prices, fees, distances, coordinates, booking status, payout status or payment success.
- Avoid inline `onclick`, `onchange`, and `onkeydown` handlers in new UI.
- Use explicit event listeners after render.
- Escape server/database strings before inserting them into HTML templates.
- Do not rewrite static footer or shell markup at runtime when it can be correct in `index.html`.
- Do not patch `Root.init()` for visual work.
- Use one canonical GoRentHive wordmark/mark path from `/public/brand`.
- Keep exact/private coordinates and private evidence out of public DOM/data payloads.
- All new public pages need title, description, heading hierarchy and a canonical route in `server/prerender.js` where applicable.

## Refactor roadmap

`public/js/app.js` remains the largest technical-debt item. It should be split incrementally by domain, not rewritten wholesale:

- auth/account
- listings/search
- booking lifecycle
- messaging
- wallet/payments
- reviews/disputes
- admin
- shared rendering utilities

Each extraction should preserve existing behavior and have a regression test before the next domain is moved.
