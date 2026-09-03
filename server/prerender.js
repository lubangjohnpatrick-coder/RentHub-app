'use strict';

// Server-side HTML prerendering for the public SEO pages.
//
// The app is a hash/history SPA. With JavaScript enabled it renders everything.
// With JavaScript disabled (search-engine crawlers, the reviewer's SEO test)
// the server returns a meaningful <title>, meta description, canonical/OG tags
// and a <noscript> block with an <h1> and real content for each public route.
//
// This is intentionally lightweight: a curated map of the public marketing
// pages. Dynamic routes (listings, profiles) are left to the SPA; a shared
// default shell is used for everything else.

const SITE = 'GoRentHive';
const CANON = 'https://gorenthive.online';

const ROUTES = {
  '/': {
    title: 'GoRentHive | Rent Anything, Earn From What You Own',
    desc: 'A peer-to-peer rental marketplace in the Philippines. Rent tools, vehicles, party equipment, cameras and more from people near you — or turn your unused items into income.',
    h1: 'Need it? Rent it. Own it? Earn from it.',
    intro: 'Rent anything from people near you, or earn from the things you already own.',
  },
  '/explore': {
    title: 'Explore Rentals in the Philippines | GoRentHive',
    desc: 'Rent cameras, tents, speakers, cars, tools and more from local owners in the Philippines.',
    h1: 'Explore rentals near you',
    intro: 'Browse cameras, tents, speakers, vehicles, tools and more from local owners. Rent with secure escrow payments and refundable deposits.',
  },
  '/categories': {
    title: 'Browse Rental Categories | GoRentHive',
    desc: 'Browse rental categories — cameras, tents, speakers, tools, vehicles and more in the Philippines.',
    h1: 'Browse by category',
    intro: 'From cameras and camping gear to party equipment, tools, vehicles and formal wear — find the category you need.',
  },
  '/rent': {
    title: 'Rent Items Near You | GoRentHive',
    desc: 'Find gear, tools, vehicles and more for rent from local owners in the Philippines on GoRentHive.',
    h1: 'How renting works',
    intro: 'Search, book, pay securely and pick up — rent almost anything from a trusted local owner.',
  },
  '/earn': {
    title: 'Earn Money Renting Your Items | GoRentHive',
    desc: 'Turn unused tools, equipment, vehicles and other items into extra income on GoRentHive.',
    h1: 'Earn from the things you already own',
    intro: 'List an item, set your price, and get paid when it rents. GoRentHive handles payments, deposits and agreements.',
  },
  '/pricing': {
    title: 'Pricing & Fees | GoRentHive',
    desc: 'Simple, honest pricing for peer-to-peer rentals in the Philippines.',
    h1: 'Simple, honest pricing',
    intro: 'Renters pay the daily rate plus a small platform fee and a refundable deposit. Owners keep the rental amount minus the platform fee.',
  },
  '/how-it-works': {
    title: 'How GoRentHive Works | GoRentHive',
    desc: 'Rent & earn in the Philippines: find an item, request a rental, pay securely, and return it.',
    h1: 'How GoRentHive works',
    intro: 'Find an item, request a rental, pay securely in escrow, and return it. Both for renters and owners.',
  },
  '/trust-safety': {
    title: 'Trust & Safety | GoRentHive',
    desc: 'GoRentHive is designed for safer peer-to-peer rentals — verified users and secure transactions.',
    h1: 'Trust & safety',
    intro: 'Verified users, secure escrow payments, refundable deposits, digital rental agreements and a dispute resolution process.',
  },
  '/about': {
    title: 'About GoRentHive | GoRentHive',
    desc: 'The peer-to-peer rental marketplace for the things you already own in the Philippines.',
    h1: 'About GoRentHive',
    intro: 'A peer-to-peer rental marketplace for the things you already own.',
  },
  '/help': {
    title: 'Help Center | GoRentHive',
    desc: 'Get help with renting, earning, payments and more on GoRentHive.',
    h1: 'Help Center',
    intro: 'Answers to common questions about renting, earning, payments, deposits and disputes.',
  },
  '/contact': {
    title: 'Contact Us | GoRentHive',
    desc: 'Contact the GoRentHive support team.',
    h1: 'Contact us',
    intro: 'Our support team is ready to help you.',
  },
  '/list': {
    title: 'List an Item | GoRentHive',
    desc: 'List your item on GoRentHive and start earning from the things you no longer use.',
    h1: 'List your item and start earning',
    intro: 'Upload photos and a description, set your price, and GoRentHive handles the rest.',
  },
  '/login': {
    title: 'Log In | GoRentHive',
    desc: 'Log in to your GoRentHive account to rent and earn in the Philippines.',
    h1: 'Log in',
    intro: '',
  },
  '/register': {
    title: 'Create Account | GoRentHive',
    desc: 'Create a free GoRentHive account to rent and earn in the Philippines.',
    h1: 'Create your free account',
    intro: '',
  },
  '/owner': {
    title: 'For Owners | GoRentHive',
    desc: 'Turn your unused items into income. List on GoRentHive and earn from the things you already own.',
    h1: 'Earn from the things you own',
    intro: 'List your items, set your own prices, and get paid when they rent.',
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Returns a { title, desc, noscript } object for the given URL path, or null if
// the route is not in the curated public map (default shell is used).
function routeFor(pathname) {
  const key = ROUTES[pathname] ? pathname : null;
  if (!key) return null;
  const r = ROUTES[key];
  const noscript = `<noscript>
  <div style="max-width:800px;margin:0 auto;padding:48px 20px;text-align:center"><h1>${escapeHtml(r.h1)}</h1><p style="font-size:17px;color:#444;margin-top:12px">${escapeHtml(r.intro)}</p>
  <p style="margin-top:28px"><a href="/explore" style="display:inline-block;padding:14px 26px;background:#E8920C;color:#fff;border-radius:12px;text-decoration:none;font-weight:700">Browse rentals</a></p>
  </div></noscript>`;
  return { title: r.title, desc: r.desc, key, noscript };
}

module.exports = { routeFor, CANON, SITE };