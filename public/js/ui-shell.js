/*
 * GoRentHive UI shell
 *
 * Presentation owner for navigation branding and the public homepage.
 * Business rules remain in app.js and the hardened payment/location/media/legal modules.
 *
 * Design rules:
 * - no inline event handlers
 * - no init monkey-patching
 * - no footer DOM rewrites
 * - no business logic in the presentation layer
 */
(() => {
  'use strict';

  if (!window.Root) return;

  const originalRenderNav = Root.renderNav ? Root.renderNav.bind(Root) : null;
  const WORDMARK = '/brand/gorenthive-wordmark.png';
  const MARK = '/brand/gorenthive-mark.png';

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function brandMarkup() {
    return `<img src="${WORDMARK}" class="brand-refresh-logo grh-wordmark" width="188" height="54" alt="GoRentHive — Rent What You Need. Earn From What You Own.">`;
  }

  function enhanceNavigation() {
    const top = document.getElementById('topnav');
    if (!top) return;

    const brand = top.querySelector('.brand');
    if (brand) {
      brand.classList.add('brand-refresh', 'grh-brand');
      brand.innerHTML = brandMarkup();
      brand.setAttribute('aria-label', 'GoRentHive home');
    }

    const nav = top.querySelector('.nav-link-pad');
    if (nav && !nav.querySelector('.brand-nav-how')) {
      const ownerLink = [...nav.querySelectorAll('a')].find((link) => /for owners/i.test(link.textContent || ''));
      if (ownerLink) {
        const how = document.createElement('a');
        how.className = 'brand-nav-how';
        how.href = '/how-it-works';
        how.textContent = 'How It Works';
        ownerLink.insertAdjacentElement('afterend', how);
      }
    }

    const signup = [...top.querySelectorAll('a')].find((link) => /sign up|create account/i.test(link.textContent || ''));
    if (signup) {
      signup.textContent = 'Create Account';
      signup.classList.add('brand-cta');
    }
  }

  function bindHomepageSearch(root) {
    const queryInput = root.querySelector('#launch-q');
    const searchButton = root.querySelector('#launch-search-button');

    const submit = () => {
      if (typeof Root.launchSearch === 'function') Root.launchSearch();
    };

    queryInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });

    searchButton?.addEventListener('click', submit);
  }

  function renderCategoryCards(categories) {
    const fallbackCategories = [
      ['📷', 'Cameras & Gear', 'camera'],
      ['⛺', 'Outdoor & Camping', 'camping'],
      ['🛠️', 'Tools & Equipment', 'tools'],
      ['💻', 'Electronics', 'electronics'],
      ['🚗', 'Vehicles', 'vehicle'],
      ['🪑', 'Home & Living', 'home'],
      ['🏀', 'Sports & Fitness', 'sports'],
      ['👗', 'Fashion', 'fashion'],
      ['🎮', 'Games & Hobbies', 'gaming'],
    ];

    if (categories.length) {
      return categories.map((category) => `
        <a class="grh-category-card" href="/explore?category=${encodeURIComponent(String(category.id))}">
          <span class="grh-category-icon" aria-hidden="true">${escapeHtml(category.icon || '📦')}</span>
          <span>${escapeHtml(category.name)}</span>
        </a>`).join('');
    }

    return fallbackCategories.map(([icon, name, query]) => `
      <a class="grh-category-card" href="/explore?q=${encodeURIComponent(query)}">
        <span class="grh-category-icon" aria-hidden="true">${icon}</span>
        <span>${name}</span>
      </a>`).join('');
  }

  Root.renderNav = function renderNav() {
    if (originalRenderNav) originalRenderNav();
    enhanceNavigation();
  };

  Root.viewHome = async function viewHome() {
    const categories = (this.state.categories || []).slice(0, 9);

    this.setMeta(
      'GoRentHive | Rent What You Need. Earn From What You Own.',
      'Find verified nearby rentals by radius in the Philippines, or earn from items you already own. Protected payments, agreements and condition documentation.',
      '/'
    );

    this.$app.innerHTML = `
      <section class="grh-home-hero" aria-labelledby="grh-home-title">
        <div class="wrap grh-home-grid">
          <div class="grh-hero-copy">
            <h1 id="grh-home-title">Rent What You Need.<br><span>Earn From What You Own.</span></h1>
            <p class="grh-hero-sub">Verified nearby rentals. Real people. Real opportunities. Search useful items around you or turn idle assets into extra income.</p>

            <div class="grh-trust-row" aria-label="GoRentHive trust features">
              <div><span aria-hidden="true">⌖</span><b>Nearby Rentals</b><small>GPS radius search</small></div>
              <div><span aria-hidden="true">✓</span><b>Verified Accounts</b><small>Safer local rentals</small></div>
              <div><span aria-hidden="true">▣</span><b>Protected Payments</b><small>Documented transactions</small></div>
              <div><span aria-hidden="true">▤</span><b>Digital Agreements</b><small>Clear rental terms</small></div>
            </div>
          </div>

          <div class="grh-hero-showcase" aria-hidden="true">
            <div class="grh-honeycomb hc-1"></div>
            <div class="grh-honeycomb hc-2"></div>
            <div class="grh-honeycomb hc-3"></div>
            <div class="grh-hero-item grh-item-camera">📷<small>Camera</small></div>
            <div class="grh-hero-item grh-item-tool">🛠️<small>Tools</small></div>
            <div class="grh-hero-item grh-item-camping">⛺<small>Camping</small></div>
            <div class="grh-hero-item grh-item-tech">💻<small>Tech</small></div>
            <img class="grh-hero-mark" src="${MARK}" alt="" width="145" height="160">
            <div class="grh-adventure-note">Your Next Adventure<br><b>Starts Here.</b></div>
          </div>
        </div>

        <div class="wrap grh-search-wrap">
          <div class="grh-search-panel" role="search" aria-label="Search GoRentHive rentals">
            <div class="grh-search-field">
              <span class="grh-search-ico" aria-hidden="true">⌖</span>
              <div><span class="label">Location</span><strong>Uses your verified GPS location</strong></div>
            </div>
            <div class="grh-search-field">
              <span class="grh-search-ico" aria-hidden="true">▦</span>
              <div>
                <label for="launch-q">What do you need?</label>
                <input id="launch-q" autocomplete="off" placeholder="Camera, tent, drill, projector…">
              </div>
            </div>
            <div class="grh-search-field">
              <span class="grh-search-ico" aria-hidden="true">◎</span>
              <div>
                <label for="launch-radius">Search radius</label>
                <select id="launch-radius">
                  <option value="5">Within 5 km</option>
                  <option value="10" selected>Within 10 km</option>
                  <option value="25">Within 25 km</option>
                  <option value="50">Within 50 km</option>
                </select>
              </div>
            </div>
            <button id="launch-search-button" type="button" class="grh-search-button"><span aria-hidden="true">⌕</span> <span>Search Rentals</span></button>
          </div>
        </div>
      </section>

      <div class="grh-home-main">
        <div class="wrap">
          <section class="grh-owner-strip" aria-labelledby="grh-owner-title">
            <div class="grh-store-ico" aria-hidden="true">🏪</div>
            <div><h2 id="grh-owner-title">Have items to share?</h2><p>Turn your unused items into extra income.</p></div>
            <a class="grh-btn grh-btn-primary" href="/list">List Your Item <span aria-hidden="true">→</span></a>
            <div class="grh-owner-sep" aria-hidden="true"></div>
            <div class="grh-community-proof">
              <div class="grh-avatars" aria-hidden="true"><span>👤</span><span>👩</span><span>👨</span></div>
              <p><b>Join the GoRentHive community</b><br>Rent locally. Earn from what you own.</p>
            </div>
          </section>

          <section class="grh-section" aria-labelledby="grh-categories-title">
            <div class="grh-section-head">
              <h2 id="grh-categories-title">Popular Categories</h2>
              <a href="/categories">View All Categories →</a>
            </div>
            <div class="grh-category-grid">${renderCategoryCards(categories)}</div>
          </section>

          <section class="grh-closing-banner" aria-label="GoRentHive marketplace message">
            <div><h2>A smarter way to <span>rent.</span><br>A brighter way to <span>earn.</span></h2></div>
            <img src="${MARK}" alt="GoRentHive" width="120" height="120">
          </section>
        </div>
      </div>`;

    bindHomepageSearch(this.$app);
  };
})();
