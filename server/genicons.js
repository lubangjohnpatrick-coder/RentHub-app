'use strict';

// GoRentHive brand assets are curated, not procedurally generated.
// This command intentionally validates the canonical identity files instead of
// recreating the retired orange-circle icon that previously caused inconsistent
// browser/PWA branding.
const fs = require('fs');
const path = require('path');

const BRAND_DIR = path.join(__dirname, '..', 'public', 'brand');
const required = [
  path.join(BRAND_DIR, 'gorenthive-mark.png'),
  path.join(BRAND_DIR, 'gorenthive-wordmark.png'),
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing canonical GoRentHive brand asset: ${file}`);
  if (fs.statSync(file).size < 1024) throw new Error(`Brand asset looks invalid or truncated: ${file}`);
}

console.log('GoRentHive canonical brand assets verified. No generated logo variants are produced.');
