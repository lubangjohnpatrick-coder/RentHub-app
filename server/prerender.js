'use strict';

// Lightweight server-side metadata/prerender content for public marketing pages.
const SITE = 'GoRentHive';
const CANON = 'https://gorenthive.online';

const ROUTES = {
  '/': {
    title: 'GoRentHive | Rent What You Need. Earn From What You Own.',
    desc: 'Philippine peer-to-peer rental marketplace. Find verified nearby rentals by radius or earn from useful items you already own.',
    h1: 'Rent What You Need. Earn From What You Own.',
    intro: 'Find useful items from verified people near you using radius-based search, or list items you own to earn rental income.',
  },
  '/explore': {
    title: 'Explore Rentals Near You | GoRentHive Philippines',
    desc: 'Search nearby tools, event equipment, cameras, vehicles and more using your verified GPS location and preferred radius.',
    h1: 'Explore rentals near you',
    intro: 'Use verified-radius search to browse nearby rentals without exposing exact private location coordinates.',
  },
  '/categories': {
    title: 'Browse Rental Categories | GoRentHive',
    desc: 'Browse construction equipment, party needs, cameras, electronics, fashion, adventure gear, home equipment and more.',
    h1: 'Browse by category',
    intro: 'Find useful rentals across equipment, events, photography, electronics, special occasions, outdoor activities and home needs.',
  },
  '/rent': {
    title: 'Rent Items Near You | GoRentHive',
    desc: 'Search by verified radius, request dates, accept a digital rental agreement, document handover and return the item on time.',
    h1: 'How renting works',
    intro: 'Search nearby, request a booking, sign the agreement, document condition, pick up or meet the owner, then return and review.',
  },
  '/earn': {
    title: 'Earn Money Renting Your Items | GoRentHive',
    desc: 'Turn unused tools, equipment, vehicles and other useful items into rental income on GoRentHive.',
    h1: 'Earn from the things you already own',
    intro: 'List an item, set your price and availability, and keep your rental earnings less GoRentHive’s 8% owner commission.',
  },
  '/pricing': {
    title: 'Pricing & Fees | GoRentHive',
    desc: 'Basic is free, Pro is ₱499/month and Business is ₱999/month. GoRentHive deducts an 8% commission from completed owner rental earnings.',
    h1: 'Simple, transparent pricing',
    intro: 'Start free, upgrade when useful, and pay an 8% marketplace commission from completed owner rental earnings. Security deposits are separate.',
  },
  '/how-it-works': {
    title: 'How GoRentHive Works | Philippines Rental Marketplace',
    desc: 'Search by verified radius, request a rental, sign the booking-specific agreement, document handover and return, then complete payment release.',
    h1: 'How GoRentHive works',
    intro: 'A documented workflow from nearby search and owner approval through agreement, condition evidence, handover, return and completion.',
  },
  '/trust-safety': {
    title: 'Trust & Safety | GoRentHive',
    desc: 'Verified accounts, GPS radius search, protected payments, digital rental agreements, condition evidence and dispute controls.',
    h1: 'Trust & safety',
    intro: 'GoRentHive combines verification, protected payment flow, booking-specific agreements and before/after condition records.',
  },
  '/about': {
    title: 'About GoRentHive | Philippine Peer-to-Peer Rentals',
    desc: 'GoRentHive is a Philippine peer-to-peer marketplace for renting useful items and earning from assets you already own.',
    h1: 'About GoRentHive',
    intro: 'A local rental marketplace designed to make idle assets useful and documented peer-to-peer rentals easier to manage.',
  },
  '/help': {
    title: 'Help Center | GoRentHive',
    desc: 'Get help with renting, listing, verification, protected payments, security deposits, returns and disputes.',
    h1: 'Help Center',
    intro: 'Answers to common questions about renting, earning, verification, payments, deposits, return evidence and disputes.',
  },
  '/contact': {
    title: 'Contact Us | GoRentHive',
    desc: 'Contact the GoRentHive support team for marketplace and booking assistance.',
    h1: 'Contact us',
    intro: 'Contact GoRentHive support for account, booking or marketplace assistance.',
  },
  '/list': {
    title: 'List an Item | Earn on GoRentHive',
    desc: 'List an item on GoRentHive, set your price and availability, and earn when verified renters book it.',
    h1: 'List your item and start earning',
    intro: 'Add clear photos and item details, set your rental price and availability, then manage requests in GoRentHive.',
  },
  '/login': {
    title: 'Log In | GoRentHive',
    desc: 'Log in to your GoRentHive account to rent, list items and manage bookings.',
    h1: 'Log in',
    intro: '',
  },
  '/register': {
    title: 'Create Account | GoRentHive',
    desc: 'Create one GoRentHive account that can both rent items and list items for rent.',
    h1: 'Create your free account',
    intro: 'One account can both rent and list items.',
  },
  '/owner': {
    title: 'For Owners | Earn With GoRentHive',
    desc: 'Turn unused items into income. Set your own rental prices and availability on GoRentHive.',
    h1: 'Earn from the things you own',
    intro: 'List your items, set your own prices and availability, and keep your rental earnings less the 8% owner commission.',
  },
  '/legal/terms': {
    title: 'Terms & Conditions | GoRentHive',
    desc: 'GoRentHive Terms & Conditions governing accounts, listings, rentals, payments and disputes.',
    h1: 'Terms & Conditions',
    intro: 'The rules that govern accounts, listings, rentals, protected payments and dispute handling on GoRentHive.',
  },
  '/legal/privacy': {
    title: 'Privacy Policy | GoRentHive',
    desc: 'How GoRentHive collects, uses and protects account, location, identity and booking data.',
    h1: 'Privacy Policy',
    intro: 'How GoRentHive collects, uses, stores and protects personal and marketplace data.',
  },
  '/legal/rental_agreement': {
    title: 'Rental Agreement | GoRentHive',
    desc: 'GoRentHive standard rental-agreement framework covering parties, item, dates, deposit, condition evidence, late return and disputes.',
    h1: 'Rental Agreement',
    intro: 'Each approved booking generates its own agreement snapshot covering the parties, item, rental period, deposit, return and applicable policies.',
  },
  '/legal/prohibited': {
    title: 'Prohibited Items | GoRentHive',
    desc: 'Items and categories that cannot be listed or rented through GoRentHive.',
    h1: 'Prohibited items',
    intro: 'Review the categories and items that are not allowed on GoRentHive.',
  },
};

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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