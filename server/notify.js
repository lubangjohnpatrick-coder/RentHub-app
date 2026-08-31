'use strict';

const db = require('./db/schema');

function notify(userId, type, title, body, link = '') {
  if (!userId) return;
  db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES (?,?,?,?,?,?)'
  ).run(userId, type, title, body, link, Date.now());
}

function notifyMany(userIds, type, title, body, link = '') {
  userIds.forEach((id) => notify(id, type, title, body, link));
}

// Detect attempts to move transactions off-platform. Returns a warning string or ''.
const OFF_PLATFORM_PATTERNS = [
  /gcash/i,
  /maya/i,
  /paypal/i,
  /facebook/i,
  /fb\b/i,
  /messenger/i,
  /whatsapp/i,
  /viber/i,
  /telegram/i,
  /tiktok/i,
  /instagram/i,
  /\b\d{11}\b/,            // PHL mobile numbers
  /(\+63|0)\d{10}/,
  /\b9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/,  // spaced 09xx
  /\b09\d{2}[-\s]?\d{3}[-\s]?\d{4}\b/,
  /bit\.ly/i,
  /tinyurl/i,
  /@gmail\.com/i,
  /@yahoo\.com/i,
  /@hotmail\.com/i,
  /@outlook\.com/i,
  /(^|\W)(mail|email|e-?mail)(\W|$)/i,
  /(send|add|message)\s+(me\s+)?(your\s+)?(number|contact|fb|facebook)/i,
  /transfer/i,
  /bank account/i,
  /bank transfer/i,
  /(g\s*-?\s*cash|g\s*-?\s*c)/i,
];

function detectCircumvention(text) {
  for (const re of OFF_PLATFORM_PATTERNS) {
    if (re.test(text)) {
      return 'For your protection, keep payments and rental arrangements inside GoRentHive.';
    }
  }
  return '';
}

module.exports = { notify, notifyMany, detectCircumvention };
