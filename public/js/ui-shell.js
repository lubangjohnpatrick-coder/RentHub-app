/*
 * GoRentHive UI shell
 * Owns presentation-only overrides for navigation, footer and homepage.
 * Payment, booking, location, media and legal state remain in their dedicated modules.
 */
(() => {
  'use strict';

  if (!window.Root) return;

  const originalRenderNav = Root.renderNav ? Root.renderNav.bind(Root) : null;
  const originalInit = Root.init ? Root.init.bind(Root) : null;

  const LOGO = '<img src="/brand/gorenthive-wordmark.png" class="brand-refresh-logo grh-wordmark" width="188" height="54" alt="GoRentHive — Rent What You Need. Earn From What You Own.">';

  function enhanceBrand(root = document) {
    root.querySelectorAll('.brand').forEach((brand) => {
      brand.classList.add('brand-refresh', 'grh-brand');
      brand.innerHTML = LOGO;
      brand.setAttribute('aria-label', 'GoRentHive home');
    });
  }

  function enhanceNavigation() {
    const top = document.getElementById('topnav');
    if (!top) return;

    enhanceBrand(top);

    const nav = top.querySelector('.nav-link-pad');
    if (nav && !nav.querySelector('.brand-nav-how')) {
      const ownerLink = [...nav.querySelectorAll('a')].find((a) => /for owners/i.test(a.textContent || ''));
      if (ownerLink) {
        const how = document.createElement('a');
        how.className = 'brand-nav-how';
        how.href = '/how-it-works';
        how.textContent = 'How It Works';
        ownerLink.insertAdjacentElement('afterend', how);
      }
    }

    const signup = [...top.querySelectorAll('a')].find((a) => /sign up|create account/i.test(a.textContent || ''));
    if (signup) {
      signup.textContent = 'Create Account';
      signup.classList.add('brand-cta');
    }
  }

  function enhanceFooter() {
    const footer = document.querySelector('.footer');
    if (!footer) return;
    enhanceBrand(footer);
  }

  Root.renderNav = function renderNav() {
    if (originalRenderNav) originalRenderNav();
    enhanceNavigation();
  };

  Root.viewHome = async function viewHome() {
    const cats = (this.state.categories || []).slice(0, 9);

    this.setMeta(
      'GoRentHive | Rent What You Need. Earn From What You Own.',
      'Find verified nearby rentals by radius in the Philippines, or earn from items you already own. Protected payments, agreements and condition documentation.',
      '/'
    );

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

    const categoryCards = cats.length
      ? cats.map((category) => `
          <a class="grh-category-card" href="/explore?category=${encodeURIComponent(String(category.id))}">
            <span class="grh-category-icon" aria-hidden="true">${category.icon || '📦'}</span>
            <span>${esc(category.name)}</span>
          </a>`).join('')
      : fallbackCategories.map(([icon, name, query]) => `
          <a class="grh-category-card" href="/explore?q=${encodeURIComponent(query)}">
            <span class="grh-category-icon" aria-hidden="true">${icon}</span>
            <span>${name}</span>
          </a>`).join('');

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
            <img class="grh-hero-mark" src="/brand/gorenthive-mark.png" alt="" width="145" height="160">
            <div class="grh-adventure-note">Your Next Adventure<br><b>Starts Here.</b></div>
          </div>
        </div>

        <div class="wrap grh-search-wrap">
          <div class="grh-search-panel" role="search" aria-label="Search GoRentHive rentals">
            <div class="grh-search-field">
              <span class="grh-search-ico" aria-hidden="true">⌖</span>
              <div><label>Location</label><strong>Uses your verified GPS location</strong></div>
            </div>
            <div class="grh-search-field">
              <span class="grh-search-ico" aria-hidden="true">▦</span>
              <div>
                <label for="launch-q">What do you need?</label>
                <input id="launch-q" autocomplete="off" aria-label="What do you need to rent?" placeholder="Camera, tent, drill, projector…" onkeydown="if(event.key==='Enter')Root.launchSearch()">
              </div>
            </div>
            <div class="grh-search-field">
              <span class="grh-search-ico" aria-hidden="true">◎</span>
              <div>
                <label for="launch-radius">Search radius</label>
                <select id="launch-radius" aria-label="Search radius">
                  <option value="5">Within 5 km</option>
                  <option value="10" selected>Within 10 km</option>
                  <option value="25">Within 25 km</option>
                  <option value="50">Within 50 km</option>
                </select>
              </div>
            </div>
            <button type="button" class="grh-search-button" onclick="Root.launchSearch()"><span aria-hidden="true">⌕</span> <span>Search Rentals</span></button>
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
            <div class="grh-category-grid">${categoryCards}</div>
          </section>

          <section class="grh-closing-banner" aria-label="GoRentHive marketplace message">
            <div><h2>A smarter way to <span>rent.</span><br>A brighter way to <span>earn.</span></h2></div>
            <img src="/brand/gorenthive-mark.png" alt="GoRentHive" width="120" height="120">
          </section>
        </div>
      </div>`;
  };

  if (originalInit) {
    Root.init = async function init() {
      await originalInit();
      this.renderNav();
      enhanceFooter();
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    queueMicrotask(() => {
      enhanceNavigation();
      enhanceFooter();
    });
  });
})();
