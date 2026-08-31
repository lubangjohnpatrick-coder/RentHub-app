'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:4000';
const SHOT = path.join(__dirname, '..', 'shots');

(async () => {
  const fs = require('fs');
  if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });
  const errors = [];
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => { errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure() || {}).errorText); });

  const step = async (name, hash, wait = 1800) => {
    await page.goto(BASE + '/#' + hash, { waitUntil: 'networkidle0', timeout: 30000 }).catch((e) => errors.push('GOTO ' + name + ': ' + e.message));
    await new Promise((r) => setTimeout(r, wait));
    const text = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log('--- ' + name + ' ---');
    console.log(text.replace(/\n+/g, ' | ').slice(0, 400));
    await page.screenshot({ path: path.join(SHOT, name + '.png') });
  };

  // Home
  await step('home', '/');
  // Login
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));
  await page.type('#a-email', 'mia@gorenthive.online');
  await page.type('#a-pass', 'renter123');
  await page.evaluate(() => Root.doAuth('login'));
  await new Promise((r) => setTimeout(r, 1500));
  console.log('--- after login, hash: ' + await page.evaluate(() => location.hash));

  // Explore
  await step('explore', '/explore');
  // Listing detail
  await step('listing', '/listing/1');
  // Requests
  await step('requests', '/requests');
  // Me
  await step('me', '/me');
  // Wallet
  await step('wallet', '/wallet');
  // Owner perspective - login as owner
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }); });
  await page.type('#a-email', 'juan@gorenthive.online');
  await page.type('#a-pass', 'owner123');
  await page.evaluate(() => Root.doAuth('login'));
  await new Promise((r) => setTimeout(r, 1500));
  await step('owner', '/owner');
  await step('list-form', '/list');

  // Admin
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }); });
  await page.type('#a-email', 'admin@gorenthive.online');
  await page.type('#a-pass', 'admin123');
  await page.evaluate(() => Root.doAuth('login'));
  await new Promise((r) => setTimeout(r, 1500));
  await step('admin-analytics', '/admin?tab=analytics');
  await step('admin-users', '/admin?tab=users');

  // Legal
  await step('legal', '/legal/terms');

  console.log('\n\n======== ERRORS (' + errors.length + ') ========');
  errors.slice(0, 40).forEach((e) => console.log(e));
  await browser.close();
})();
