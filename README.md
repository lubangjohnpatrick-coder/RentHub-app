# GoRentHive 🐝

> **Need it? Rent it. Own it? Earn from it.**

GoRentHive is a **peer-to-peer rental marketplace** where people rent items from each other. Owners list the things they already own; renters search, book, pay, and return them. GoRentHive facilitates discovery, verification, booking, payment, rental agreements, security deposits, communication, reviews, disputes, and platform fees.

It is built as a **mobile-first Progressive Web App (PWA)**, so it runs in any browser and can be **installed to a phone** to work like an app — and is architected for later packaging into **Android/iOS** apps (e.g. with Capacitor).

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start with an empty pilot database (created automatically)android\app\build\outputs\apk\debug\app-debug.apk
npm start
```

Then open **http://localhost:4000** (or use the port in `.env`).

> The app uses Node's **built-in `node:sqlite`** (Node 22+), so no native compilation is needed — node:sqlite must be available (Node 24 works out of the box).

## Supabase Pilot API

The hosted Supabase REST endpoint is configured through `.env`:

```bash
SUPABASE_REST_URL=https://tdztzjetxnjqwvgolpvz.supabase.co/rest/v1
SUPABASE_ANON_KEY=your-project-anon-key
```

The SQL starter schema is in [supabase/schema.sql](supabase/schema.sql). The current pilot UI still uses the local Express `/api` routes and SQLite for its full marketplace workflow; migrating every route to Supabase requires the project anon key and a deliberate data/auth migration. Never put a Supabase service-role key in GitHub or the Android app.

---

## Pilot Accounts

| Role | Email | Password |
|------|-------|----------|
| **Admin** | `admin@gorenthive.online` | `admin123` |
| **Owner** (Juan, Toyota Vios) | `juan@gorenthive.online` | `owner123` |
| **Owner** (Maria, gown/PS5) | `maria@gorenthive.online` | `owner123` |
| **Owner** (Pedro, generator) | `pedro@gorenthive.online` | `owner123` |
| **Owner** (Carlos, cameras) | `cam@gorenthive.online` | `owner123` |
| **Owner** (Ana, tents) | `tent@gorenthive.online` | `owner123` |
| **Owner** (Berto, speakers) | `bee@gorenthive.online` | `owner123` |
| **Renter** (Mia) | `mia@gorenthive.online` | `renter123` |
| **Renter** (Leo) | `leo@gorenthive.online` | `renter123` |

There are no demo accounts or sample listings. Register a real pilot account from the app, then complete email, phone, identity, and Terms & Conditions requirements before listing.

---

## What's Inside

### Marketplace (Renter side)
- Homepage hero **"RENT ANYTHING."** with search, location, and date selectors
- Category browser with subcategories and "Other/Anything Legal"
- Search with filters: keyword, category, city, price, sort, featured, bundles
- **Rental Bundles** — Camping, Party, Pickleball, Content Creator packages
- Listing detail page: gallery, price, deposit, owner profile, reviews, condition, accessories, availability, rules, delivery/pickup, **Report Listing**
- Live booking quote (rental fee + platform fee + delivery + **refundable deposit**)
- **💬 In-app chat** with anti-circumvention warnings for off-platform transactions (GCash/Maya/Facebook/phone numbers, etc.)
- **🙏 "I NEED SOMETHING"** demand marketplace — post a request, owners nearby get notified

### Booking / transaction lifecycle
`Request → Approve → Sign agreement (both parties) → Active → Check-in condition → Return → Deposit release → Review`

- Auto-generated **digital rental agreement** with per-transaction details
- **Security deposit** held separately from platform revenue (escrow-style), released or partially deducted on return
- **Condition documentation** (check-in/check-out photos, serial, accessories, damage)
- Cancellation with policy-based refunds (48h free / 24h partial)
- Late-return fees and damage deductions
- Ratings: renter ↔ owner (1–5★)
- **Dispute system** with categories, evidence, and admin resolution

### Owner side
- **Rent-to-Earn dashboard**: this-month income, all-time earnings, items listed, active rentals, pending requests
- **Top Earning Items**
- List an item (multi-photo upload, price, deposit, delivery, conditions, rules, verification level)
- Incoming booking requests
- Promote listings (🔥 Featured) — basic / plus / premium ($49/$99/$199, configurable)

### Wallet & Ledger
- Every user gets a **wallet** balance driven by a proper **financial ledger** (`ledger_entries`) with running balances — **never** computed from the frontend
- **Platform fee = 4% of rental price, min ₱20** (fully configurable in Admin → Settings)
- Withdrawals (bank / GCash / Maya) simulated as payouts
- Referral program: friend gets ₱50 credit, you get ₱50 after their first completed rental

### Admin dashboard
- Analytics (users, listings, bookings, gross value, platform revenue, disputes, top categories, top items/owners)
- User management (verification, roles, suspend)
- Listing management (status, feature/unfeature, remove)
- Dispute resolution, refunds, payouts approval
- **Marketplace fee settings** (commission %, min/max, featured pricing, referral rewards, cancellation windows) — change without touching code
- Broadcast notifications, audit log

### Legal pages
Terms & Conditions, Privacy Policy, Rental Agreement, Cancellation, Refund, Damage & Loss, Prohibited Items, Owner Agreement, Renter Agreement — all versioned with electronic acceptance (`I Agree & Continue`).

### Security
- bcrypt password hashing, httpOnly session cookies, role-based access control
- Server-side input validation, rate-limiting-ready structure, image upload validation
- Anti-circumvention chat warnings
- Separate financial & audit logging

### Payment architecture
`server/payment.js` is a **provider-agnostic gateway**:
- A `PaymentProvider` interface (`charge`, `refund`, `releaseHold`)
- Ships with a **Sandbox provider** for instant demo
- Swap in **GCash / Maya / Stripe** by implementing the interface and setting `gateway.provider`
- Raw card numbers are never stored — only provider tokens
- real payments/deposits handled as escrow

### PWA / mobile
- Installable manifest + service worker + splash/icon
- Responsive mobile-first layout with bottom nav
- Phone push notification hook + geolocation-ready (latitude/longitude on listings & users)

---

## Photos and Notifications

Authenticated owners can upload up to eight image files per listing, with an 8 MB limit per file. Uploaded listing photos are stored under `public/uploads` for local pilot use. New messages create an in-app notification for the recipient, and publishing a listing creates a confirmation notification for its owner.

For a clean local pilot database, stop the server and delete `data/gorenthive.db*`, then run `npm start`. This removes local pilot data; it does not affect Supabase.

## Android APK

The Capacitor Android project is included. Install Node.js 22+ and JDK 17, set `JAVA_HOME`, then run:

```bash
npm install
npx cap sync android
cd android
gradlew.bat assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. The APK uses the bundled web app; API data still comes from the server configured for the device, so production hosting and an Android network URL are required for phone testing.

---

## Project Structure

```
gorenthive/
├─ server/
│  ├─ index.js            # Express app, static + API routing
│  ├─ db/schema.js        # SQLite schema (node:sqlite), default settings/categories
│  ├─ auth.js             # auth middleware, session + password helpers
│  ├─ ledger.js           # financial ledger (commissions, balances, splits)
│  ├─ payment.js          # provider-agnostic payment gateway (+ sandbox)
│  ├─ settings.js         # commission & platform config
│  ├─ notify.js           # notifications + anti-circumvention detection
│  ├─ svggen.js           # branded SVG placeholder images
│  └─ routes/             # auth, listings, bookings, messages, reviews, requests,
│                         #    wallet, admin, legal, categories, notifications
├─ public/
│  ├─ index.html          # SPA shell + footer
│  ├─ css/styles.css      # mobile-first marketplace theme
│  ├─ js/api.js           # API client + helpers
│  ├─ js/app.js           # SPA router + all views
│  ├─ manifest.webmanifest
│  ├─ service-worker.js
│  └─ icons/              # PWA icons
└─ package.json
```

---

## Future / Built-to-extend

AI rental recommendations & pricing · photo condition comparison · delivery partners · insurance/protection products · business rental stores · subscriptions · rent-to-own · corporate rentals · event package generator · dynamic pricing · loyalty program · promo codes · affiliate program · public API · native apps.

---

## Note

These legal policies are drafts for demonstration. **Have qualified Philippine legal counsel review the Terms, payment/deposit structure, liability, consumer protection, privacy (Data Privacy Act), and vehicle-rental requirements before commercial launch.**
