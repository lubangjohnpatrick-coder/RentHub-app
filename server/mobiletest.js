'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:4000';

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); // mobile
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url()));

  // login as renter
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));
  await page.type('#a-email', 'mia@renthub.ph');
  await page.type('#a-pass', 'renter123');
  await page.evaluate(() => Root.doAuth('login'));
  await new Promise((r) => setTimeout(r, 1500));

  // create a fresh booking on the tent (id=2)
  await page.goto(BASE + '/#/listing/2', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  // set dates via the quote inputs
  const sd = await page.$('#bk-sd'); if (sd) { const d = new Date(); d.setDate(d.getDate()+3); await sd.evaluate((el,val)=>el.value=val, d.toISOString().split('T')[0]); }
  const ed = await page.$('#bk-ed'); if (ed) { const d = new Date(); d.setDate(d.getDate()+5); await ed.evaluate((el,val)=>el.value=val, d.toISOString().split('T')[0]); }
  await new Promise((r) => setTimeout(r, 800));
  const quoteText = await page.evaluate(() => { const q = document.getElementById('bk-quote'); return q ? q.innerText : 'NO QUOTE'; });
  console.log('MOBILE booking quote panel:\n' + quoteText.replace(/\n+/g,' | '));
  // screenshot booking widget
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'mobile-booking.png') });

  // click request rent
  const btn = await page.$('#bk-quote'); 
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('Request to Rent')); if(b) b.click(); });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('after booking hash: ' + await page.evaluate(() => location.hash));
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'mobile-booking-detail.png') });

  // mobile home screenshots
  await page.goto(BASE + '/#/', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'mobile-home.png') });
  console.log('mobile home bottom nav: ' + await page.evaluate(()=>document.querySelector('#bottomnav').innerText.replace(/\n+/g,' | ')));

  console.log('\nERRORS: ' + errors.length);
  errors.slice(0,30).forEach(e=>console.log(e));
  await browser.close();
})();
