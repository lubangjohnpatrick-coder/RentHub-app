'use strict';

const express = require('express');
const db = require('../db/schema');
const { requireAuth } = require('../auth');
const router = express.Router();

const DEFAULT_TERMS = {
  terms: `TERMS & CONDITIONS
-------------------
Welcome to GoRentHive, a peer-to-peer rental marketplace. By creating an account and using GoRentHive, you agree to these Terms & Conditions.

1. USER AGREEMENT: Users agree to provide accurate information about themselves and their listings.
2. RENTAL AGREEMENT: Owners and renters agree to the rental terms established for each transaction.
3. PLATFORM FEE: GoRentHive automatically deducts its service fee (default 4% of rental price, minimum P20) from each completed transaction.
4. SECURITY DEPOSIT & ESCROW: All rental and deposit funds are held by GoRentHive in escrow as a custodian only, and never as a party to the underlying rental. Escrow funds are released (a) to the owner only upon confirmed return under the Return & Damage policies, (b) to the renter upon cancellation/refund per policy, or (c) as decided by GoRentHive's dispute resolution. GoRentHive holds these funds in trust and does not commingle them with operating revenue beyond what is permitted by law.
5. CANCELLATION: Cancellation windows and fees apply as defined in the Cancellation Policy.
6. LATE RETURN: Late-return fees may apply at a rate agreed in the policy.
7. DAMAGE: Renters may be responsible for damage beyond normal wear and tear per the Damage & Loss Policy.
8. LOST/STOLEN ITEM: Clear responsibility and dispute procedures apply.
9. FRAUD: Accounts may be suspended or terminated for fraudulent activity.
10. PROHIBITED ITEMS: No illegal, dangerous or prohibited goods may be listed.
11. PRIVACY: Personal information is handled according to applicable Philippine privacy law (RA 10173 - Data Privacy Act).
12. CONSUMER PROTECTION: To the extent applicable, these Terms comply with the Philippine Consumer Act of 1992 (R.A. 7394). Nothing herein limits any non-waivable right a consumer may hold under Philippine law.
13. FACILITATION & LIMITATION OF LIABILITY: GoRentHive is a marketplace facilitator and not the owner, seller, lessor, insurer, or carrier of any listed item. Items are offered and returned entirely between owner and renter; GoRentHive does not verify the condition or title of any item beyond stored evidence. To the maximum extent permitted by law (and subject to RA 7394), GoRentHive's aggregate liability arising out of any booking is limited to (a) the escrowed funds held by GoRentHive and (b) pending any abuse, acts or omissions that are grossly negligent, fraudulent, or in violation of law. GoRentHive is not liable for loss of or damage to items, personal injury, consequential or indirect losses, carrier/delivery performance, or the failure of a user to perform. Users are responsible for insuring their own valuables and for any claims between themselves.
14. DISPUTES: Disputes are submitted and resolved through the in-platform dispute system with photo, chat, and agreement evidence.
15. ELECTRONIC ACCEPTANCE: By clicking "I Agree & Continue" you accept the applicable terms.

NOTE: These policies should be reviewed by qualified Philippine legal counsel before commercial launch.`,

  rental_agreement: `RENTAL AGREEMENT TERMS
-------------------
Every confirmed booking automatically generates a digital rental agreement covering the item, owner, renter, rental period, rental fee, security deposit, platform fee, pickup/return information, item condition, accessories, and applicable policies. Both parties must accept the agreement electronically before the rental becomes active. The agreement is entered into between the owner and the renter; GoRentHive is not a party thereto but provides the escrow, verification, delivery-facilitation, and dispute-resolution service. Subject to R.A. 7394, the renter and owner covenant to comply with applicable consumer protection and rental law.`,
  privacy: `PRIVACY POLICY
-------------------
GoRentHive collects and processes personal data under the Philippine Data Privacy Act (RA 10173). We collect account information, verification documents, transaction data, and communication data to operate the marketplace. Your personal contact information is not exposed to other users before a confirmed booking. We do not sell your personal data. Please consult legal counsel for full compliance.`,
  cancellation: `CANCELLATION POLICY
-------------------
- Free cancellation more than 48 hours before the rental start.
- Partial refund (50%) between 24-48 hours before the start.
- Reduced/no refund under 24 hours before the start.
Security deposits are always released on cancellation. Owners may configure stricter policies.`,
  refund: `REFUND POLICY
-------------------
Refunds are processed according to the cancellation policy and the outcome of any dispute. Approved refunds are credited back to the renter's GoRentHive wallet.`,
  damage: `DAMAGE & LOSS POLICY
-------------------
The renter is responsible for damage or loss beyond normal wear and tear. Deductions are taken from the security deposit in the event of damage. Renters and owners may dispute deductions through the dispute system with photo/chat/agreement evidence.`,
  prohibited: `PROHIBITED ITEMS POLICY
-------------------
GoRentHive does not allow the listing of illegal, dangerous, or controlled goods including weapons, illegal substances, or any item prohibited by applicable law or platform policy. GoRentHive reserves the right to remove prohibited listings and suspend offending accounts.`,
  owner: `OWNER AGREEMENT
-------------------
Owners agree to provide accurate listings, honor approved bookings, release items in the stated condition, and accept GoRentHive's platform fee deduction. Owners must respond to bookings in a timely manner.`,
  renter: `RENTER AGREEMENT
-------------------
Renters agree to provide accurate information, pay the rental fee and security deposit, return items in the same condition subject to normal wear and tear, and coordinate with the owner for pickup/return.`,
};

function getOrCreateTerms(type) {
  const row = db.prepare('SELECT * FROM terms_versions WHERE type=? ORDER BY version DESC LIMIT 1').get(type);
  const content = DEFAULT_TERMS[type] || `TERMS & CONDITIONS\n-------------------\nPlease review and accept this policy.`;
  // If the latest stored version differs from the current default text (e.g. when
  // legal wording is hardened), publish a new version so users must re-accept.
  if (row && row.content !== content) {
    const next = (parseInt(row.version, 10) || 0) + 1;
    db.prepare('INSERT INTO terms_versions (type, version, title, content, created_at) VALUES (?,?,?,?,?)').run(
      type, next, type.toUpperCase(), content, Date.now()
    );
    return db.prepare('SELECT * FROM terms_versions WHERE type=? ORDER BY version DESC LIMIT 1').get(type);
  }
  if (row) return row;
  db.prepare('INSERT INTO terms_versions (type, version, title, content, created_at) VALUES (?,?,?,?,?)').run(
    type, 1, type.toUpperCase(), content, Date.now()
  );
  return db.prepare('SELECT * FROM terms_versions WHERE type=? ORDER BY version DESC LIMIT 1').get(type);
}

router.get('/:type', (req, res) => {
  const t = getOrCreateTerms(req.params.type);
  res.json(t);
});

router.get('/', (req, res) => {
  const types = Object.keys(DEFAULT_TERMS);
  res.json(types.map(getOrCreateTerms));
});

router.post('/:type/accept', requireAuth, (req, res) => {
  const t = getOrCreateTerms(req.params.type);
  db.prepare('INSERT INTO user_terms_acceptance (user_id, terms_type, version, accepted_at) VALUES (?,?,?,?)').run(
    req.user.id, t.type, t.version, Date.now()
  );
  res.json({ ok: true });
});

module.exports = router;
