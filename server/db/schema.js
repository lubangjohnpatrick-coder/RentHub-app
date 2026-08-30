'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'renthub.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// node:sqlite returns objects with null-prototype; normalize into plain lookups we can spread.
// Prepare a helper so downstream code using .prepare().run()/.get()/.all() behaves the same.
function wrap(db) {
  const origPrepare = db.prepare.bind(db);
  db.prepare = function (sql) {
    const stmt = origPrepare(sql);
    const origRun = stmt.run.bind(stmt);
    const origGet = stmt.get.bind(stmt);
    const origAll = stmt.all.bind(stmt);
    stmt.run = function (...args) {
      const info = origRun(...args);
      // node:sqlite run() returns { changes, lastInsertRowid }
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    };
    stmt.get = function (...args) {
      const row = origGet(...args);
      return row ? Object.assign({}, row) : undefined;
    };
    stmt.all = function (...args) {
      return origAll(...args).map((r) => Object.assign({}, r));
    };
    return stmt;
  };
  db.transaction = function (fn) {
    return function (...args) {
      db.exec('BEGIN;');
      try {
        const result = fn(...args);
        db.exec('COMMIT;');
        return result;
      } catch (e) {
        db.exec('ROLLBACK;');
        throw e;
      }
    };
  };
  return db;
}
wrap(db);

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT,
  full_name TEXT,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user',        -- 'user' | 'admin'
  is_owner BOOLEAN NOT NULL DEFAULT 0,
  is_business BOOLEAN NOT NULL DEFAULT 0,
  mobile_verified BOOLEAN NOT NULL DEFAULT 0,
  email_verified BOOLEAN NOT NULL DEFAULT 0,
  identity_status TEXT NOT NULL DEFAULT 'none', -- 'none' | 'pending' | 'verified' | 'rejected'
  identity_level INTEGER NOT NULL DEFAULT 1,    -- 1..4
  id_type TEXT,
  id_number TEXT,
  id_selfie TEXT,
  address TEXT,
  barangay TEXT,
  city TEXT,
  province TEXT,
  latitude REAL,
  longitude REAL,
  location_status TEXT NOT NULL DEFAULT 'none',           -- 'none'|'pending'|'verified'
  location_verified_by TEXT DEFAULT '',                    -- 'gps'|'manual'
  location_verified_at INTEGER,
  vessel_rating REAL NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  successful_rentals INTEGER NOT NULL DEFAULT 0,
  cancelled_rentals INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT,
  referred_by_user_id INTEGER,
  referrer_credit INTEGER NOT NULL DEFAULT 0,
  wallet_balance INTEGER NOT NULL DEFAULT 0,     -- cents/pesos (int)
  suspended BOOLEAN NOT NULL DEFAULT 0,
  banned BOOLEAN NOT NULL DEFAULT 0,
  banned_reason TEXT DEFAULT '',
  last_terms_accepted TEXT DEFAULT '',           -- 'terms' + version, e.g. 'terms:1'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'mobile',        -- 'mobile' | 'email'
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at INTEGER NOT NULL,
  used BOOLEAN NOT NULL DEFAULT 0,
  meta TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used BOOLEAN NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS identity_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  id_type TEXT,
  id_number TEXT,
  id_front TEXT,
  id_back TEXT,
  selfie TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by INTEGER,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT '',
  description TEXT DEFAULT '',
  color TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  category_id INTEGER,
  subcategory_id INTEGER,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_per_day INTEGER NOT NULL,              -- PHP
  security_deposit INTEGER NOT NULL DEFAULT 0, -- PHP refundable (derived from deposit_tier)
  estimated_value INTEGER NOT NULL DEFAULT 0,  -- PHP item replacement value (sets the tier)
  deposit_tier TEXT NOT NULL DEFAULT 'low',    -- 'low'|'medium'|'high' (owner-selected, validated vs value)
  availability_start INTEGER,
  availability_end INTEGER,
  location_barangay TEXT,
  location_city TEXT NOT NULL,
  location_province TEXT,
  latitude REAL,
  longitude REAL,
  delivery_available BOOLEAN NOT NULL DEFAULT 0,
  pickup_available BOOLEAN NOT NULL DEFAULT 0,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  min_verification_level INTEGER NOT NULL DEFAULT 2,
  rules TEXT DEFAULT '',
  cancellation_policy TEXT NOT NULL DEFAULT 'standard', -- 'standard'|'flexible'|'strict'
  condition TEXT DEFAULT '',
  accessories TEXT DEFAULT '',
  serial_number TEXT,
  featured BOOLEAN NOT NULL DEFAULT 0,
  featured_until INTEGER,
  status TEXT NOT NULL DEFAULT 'active',  -- 'draft'|'active'|'paused'|'removed'
  is_bundle BOOLEAN NOT NULL DEFAULT 0,
  bundle_items TEXT DEFAULT '',           -- JSON array of { title, description }
  view_count INTEGER NOT NULL DEFAULT 0,
  favorite_count INTEGER NOT NULL DEFAULT 0,
  rental_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS listing_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (listing_id) REFERENCES listings(id)
);

CREATE TABLE IF NOT EXISTS listing_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

-- Per-booking mutual ratings. The reviewer is the user leaving the review; the
-- target is who is being reviewed. Both the owner and renter may rate each other
-- exactly once per completed booking (enforced by the unique reviewer/booking key).
CREATE TABLE IF NOT EXISTS booking_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (booking_id, reviewer_id),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_ref TEXT NOT NULL UNIQUE,
  renter_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  rental_days INTEGER NOT NULL,
  rental_fee INTEGER NOT NULL,
  security_deposit INTEGER NOT NULL DEFAULT 0,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  delivery_requested BOOLEAN NOT NULL DEFAULT 0,
  pickup_option TEXT NOT NULL DEFAULT 'pickup',
  delivery_method TEXT NOT NULL DEFAULT 'pickup',        -- 'pickup' | 'lalamove'
  delivery_distance_km REAL NOT NULL DEFAULT 0,
  delivery_vehicle_type TEXT DEFAULT '',
  dropoff_address TEXT DEFAULT '',
  lalamove_fee INTEGER NOT NULL DEFAULT 0,               -- carrier cost passed through to the platform
  platform_fee INTEGER NOT NULL DEFAULT 0,
  total_charged INTEGER NOT NULL DEFAULT 0,      -- rental + delivery + deposit + fee
  amount_due_owner INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending|approved|rejected|active|returned|completed|disputed|cancelled
  escrow_payment BOOLEAN NOT NULL DEFAULT 0,      -- full amount escrowed into app at booking
  escrow_released BOOLEAN NOT NULL DEFAULT 0,     -- owner funds released on completion
  return_proposed_deduction INTEGER NOT NULL DEFAULT -1,  -- -1 = none proposed; >=0 = owner-requested deposit deduction
  return_proposed_reason TEXT DEFAULT '',
  return_proposed_by INTEGER,
  return_completed_at INTEGER,
  agreement_signed_renter BOOLEAN NOT NULL DEFAULT 0,
  agreement_signed_owner BOOLEAN NOT NULL DEFAULT 0,
  checkin_confirmed BOOLEAN NOT NULL DEFAULT 0,
  checkout_confirmed BOOLEAN NOT NULL DEFAULT 0,
  late_fee INTEGER NOT NULL DEFAULT 0,
  cancellation_reason TEXT DEFAULT '',
  cancelled_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (renter_id) REFERENCES users(id),
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (listing_id) REFERENCES listings(id)
);

CREATE TABLE IF NOT EXISTS booking_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  price_per_day INTEGER NOT NULL,
  days INTEGER NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rental_agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  body TEXT NOT NULL,      -- generated agreement text
  renter_signed_at INTEGER,
  owner_signed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

CREATE TABLE IF NOT EXISTS condition_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  phase TEXT NOT NULL,        -- 'checkin' | 'checkout'
  uploaded_by INTEGER NOT NULL,
  photos TEXT DEFAULT '',     -- JSON array
  serial_number TEXT,
  accessories TEXT DEFAULT '',
  damage_notes TEXT DEFAULT '',
  confirmed_by_other INTEGER,
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

-- Delivery via Lalamove / provider-agnostic carrier requests
CREATE TABLE IF NOT EXISTS delivery_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  phase TEXT NOT NULL,                       -- 'dispatch' (owner->renter) | 'return' (renter->owner)
  provider TEXT NOT NULL DEFAULT 'sandbox',  -- 'lalamove' | 'sandbox'
  provider_order_id TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',  -- quoted|requested|accepted|pickup_ready|in_transit|delivered|cancelled|failed
  vehicle_type TEXT DEFAULT 'motorcycle',
  distance_km REAL NOT NULL DEFAULT 0,
  fee INTEGER NOT NULL DEFAULT 0,
  origin_address TEXT DEFAULT '',
  dropoff_address TEXT DEFAULT '',
  dropoff_lat REAL,
  dropoff_lng REAL,
  tracking_url TEXT DEFAULT '',
  proof_photo TEXT DEFAULT '',
  driver_name TEXT DEFAULT '',
  driver_phone TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

-- Public-place meeting points agreed for pickup/delivery handover
CREATE TABLE IF NOT EXISTS meeting_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  point_name TEXT NOT NULL,                 -- e.g. 'SM Mall of Asia - North Entrance'
  point_address TEXT DEFAULT '',
  latitude REAL,
  longitude REAL,
  proposed_by INTEGER NOT NULL,             -- renter proposes a public place
  renter_confirmed BOOLEAN NOT NULL DEFAULT 0,
  owner_confirmed BOOLEAN NOT NULL DEFAULT 0,
  handover_confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (proposed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_ref TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  booking_id INTEGER,
  type TEXT NOT NULL,           -- 'rental' | 'deposit' | 'refund' | 'payout' | 'platform_fee' | 'featured' | 'referral' | 'withdrawal'
  method TEXT NOT NULL DEFAULT 'sandbox',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|succeeded|failed|refunded|held|released
  gross_amount INTEGER NOT NULL,
  platform_fee INTEGER NOT NULL DEFAULT 0,
  net_amount INTEGER NOT NULL DEFAULT 0,
  meta TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS security_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  renter_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',   -- pending|held|released|partially_deducted|disputed|refunded
  deduction INTEGER NOT NULL DEFAULT 0,
  released_at INTEGER,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  method TEXT DEFAULT '',
  account TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  payment_id INTEGER,
  renter_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER,
  user_id INTEGER,
  type TEXT NOT NULL,             -- gross|platform_fee|owner_earning|deposit|delivery_fee|refund|penalty|payout|credit
  amount INTEGER NOT NULL,        -- signed: negative for outflow
  balance_after INTEGER NOT NULL,
  meta TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',  -- open|under_review|resolved|dismissed
  resolution TEXT DEFAULT '',
  evidence TEXT DEFAULT '{}',    -- JSON
  resolved_by INTEGER,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  warning TEXT DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  plan TEXT NOT NULL,        -- basic|plus|premium corresponding to fees
  fee INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|rewarded
  reward_amount INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rent_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT '',
  city TEXT,
  latitude REAL,
  longitude REAL,
  start_date INTEGER,
  end_date INTEGER,
  budget INTEGER,
  status TEXT NOT NULL DEFAULT 'open',  -- open|fulfilled|closed
  created_at INTEGER NOT NULL,
  FOREIGN KEY (requester_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS admin_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS terms_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,        -- terms|rental_agreement|privacy|cancellation|refund|damage|prohibited|owner|renter
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_terms_acceptance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  terms_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS featured_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded',
  created_at INTEGER NOT NULL
);
`);

// ---- Migration: add columns to pre-existing databases ----
(function migrate() {
  const hasCol = (table, col) => {
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all();
      return rows.some((r) => r.name === col);
    } catch (e) { return false; }
  };
  const addIfMissing = (table, col, type) => {
    if (!hasCol(table, col)) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type};`); } catch (e) { /* already added */ }
    }
  };
  addIfMissing('users', 'suspended', 'BOOLEAN NOT NULL DEFAULT 0');
  addIfMissing('users', 'banned', 'BOOLEAN NOT NULL DEFAULT 0');
  addIfMissing('users', 'banned_reason', 'TEXT DEFAULT \'\'');
  addIfMissing('users', 'last_terms_accepted', 'TEXT DEFAULT \'\'');
  addIfMissing('bookings', 'escrow_payment', 'BOOLEAN NOT NULL DEFAULT 0');
  addIfMissing('bookings', 'escrow_released', 'BOOLEAN NOT NULL DEFAULT 0');
  addIfMissing('bookings', 'return_proposed_deduction', 'INTEGER NOT NULL DEFAULT -1');
  addIfMissing('bookings', 'return_proposed_reason', 'TEXT DEFAULT \'\'');
  addIfMissing('bookings', 'return_proposed_by', 'INTEGER');
  addIfMissing('bookings', 'return_completed_at', 'INTEGER');
  addIfMissing('bookings', 'delivery_method', 'TEXT NOT NULL DEFAULT \'pickup\'');
  addIfMissing('bookings', 'delivery_distance_km', 'REAL NOT NULL DEFAULT 0');
  addIfMissing('bookings', 'delivery_vehicle_type', 'TEXT DEFAULT \'\'');
  addIfMissing('bookings', 'dropoff_address', 'TEXT DEFAULT \'\'');
  addIfMissing('bookings', 'lalamove_fee', 'INTEGER NOT NULL DEFAULT 0');
  addIfMissing('listings', 'deposit_tier', 'TEXT NOT NULL DEFAULT \'low\'');
  addIfMissing('listings', 'estimated_value', 'INTEGER NOT NULL DEFAULT 0');
  addIfMissing('delivery_requests', 'proof_signature', 'TEXT DEFAULT \'\'');
  addIfMissing('listings', 'serial_number', 'TEXT DEFAULT \'\'');
  addIfMissing('users', 'location_status', 'TEXT NOT NULL DEFAULT \'none\'');
  addIfMissing('users', 'location_verified_by', 'TEXT DEFAULT \'\'');
  addIfMissing('users', 'location_verified_at', 'INTEGER');
})();

// ---- Seed default admin settings ----
function defaultSettings() {
  const now = Date.now();
  const items = [
    ['platform_percent', '4'],
    ['platform_min_fee', '20'],
    ['platform_max_fee', ''],
    ['referral_reward', '50'],
    ['referrer_reward', '50'],
    ['featured_fee_basic', '49'],
    ['featured_fee_plus', '99'],
    ['featured_fee_premium', '199'],
    ['free_cancellation_hours', '48'],
    ['partial_cancellation_hours', '24'],
    ['platform_name', 'RentHub'],
    ['platform_tagline', 'Need it? Rent it. Own it? Earn from it.'],
    ['terms_version', '1'],
    ['max_verification_level', '4'],
    ['deposit_tier_low', '300'],
    ['deposit_tier_medium', '1000'],
    ['deposit_tier_high', '3500'],
    ['deposit_tier_low_max_value', '3000'],
    ['deposit_tier_medium_max_value', '15000'],
    ['lalamove_enabled', '1'],
    ['lalamove_base_fee', '70'],
    ['lalamove_per_km', '20'],
    ['lalamove_vehicle_motorcycle', '0'],
    ['lalamove_vehicle_car', '120'],
    ['lalamove_vehicle_truck', '300'],
    ['location_radius_options', '5,10,25'],
    ['require_location', '1'],
    ['trust_deposit_discount_enabled', '1'],
    ['trust_deposit_min_score', '80'],
    ['trust_deposit_discount_pct', '50'],
    ['review_dedup_enabled', '1'],
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?)');
  const tx = db.transaction(() => items.forEach(([k, v]) => stmt.run(k, v, now)));
  tx();
  // Backfill any previously-created DBs that predate a setting key.
  const latest = db.prepare('SELECT key FROM admin_settings').all().map((r) => r.key);
  const missing = items.filter(([k]) => !latest.includes(k));
  if (missing.length) {
    const tx2 = db.transaction(() => missing.forEach(([k, v]) => stmt.run(k, v, now)));
    tx2();
  }
}

function seedCategories() {
  const cats = [
    ['Photography & Videography', 'photography-videography', '📷', '#6C5CE7'],
    ['Camping & Outdoor', 'camping-outdoor', '⛺', '#27AE60'],
    ['Events & Party', 'events-party', '🔊', '#E84393'],
    ['Fashion & Formal Wear', 'fashion-formal', '👗', '#F39C12'],
    ['Cars & Vehicles', 'cars-vehicles', '🚗', '#3498DB'],
    ['Sports & Fitness', 'sports-fitness', '🏋️', '#E74C3C'],
    ['Tools & Equipment', 'tools-equipment', '🛠️', '#8E44AD'],
    ['Power & Emergency', 'power-emergency', '⚡', '#F1C40F'],
    ['Home', 'home', '🏠', '#E67E22'],
    ['Baby & Family', 'baby-family', '👶', '#1ABC9C'],
    ['Technology', 'technology', '💻', '#2C3E50'],
    ['Gaming', 'gaming', '🎮', '#9B59B6'],
    ['Construction', 'construction', '🏗️', '#7F8C8D'],
    ['Production', 'production', '🎬', '#C0392B'],
    ['Travel', 'travel', '🚐', '#16A085'],
    ['Special Occasions', 'special-occasions', '🎉', '#E056FD'],
    ['Other', 'other', '📦', '#95A5A6'],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO categories (name, slug, icon, color, sort_order) VALUES (?,?,?,?,?)');
  const tx = db.transaction(() => {
    let i = 0;
    cats.forEach(([n, s, ic, c]) => ins.run(n, s, ic, c, i++));
  });
  tx();
}

defaultSettings();
seedCategories();

module.exports = db;
