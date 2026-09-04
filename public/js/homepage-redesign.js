/* GoRentHive homepage redesign — visual layer only. Keeps hardened marketplace logic intact. */
(() => {
  if (!window.Root) return;

  const oldRenderNav = Root.renderNav ? Root.renderNav.bind(Root) : null;

  Root.renderNav = function () {
    if (oldRenderNav) oldRenderNav();
    const top = document.getElementById('topnav');
    if (!top) return;

    const brand = top.querySelector('.brand');
    if (brand) {
      brand.classList.add('grh-brand');
      brand.innerHTML = '<img src="/brand/gorenthive-wordmark.png" alt="GoRentHive" class="grh-wordmark">';
    }
  };

  Root.viewHome = async function () {
    const cats = (this.state.categories || []).slice(0, 9);
    this.setMeta(
      'GoRentHive | Rent What You Need. Earn From What You Own.',
      'Find verified nearby rentals by radius in the Philippines, or earn from items you already own. Protected payments, agreements and condition documentation.',
      '/'
    );

    const categoryCards = cats.length
      ? cats.map(c => `<a class="grh-category-card" href="/explore?category=${c.id}"><span class="grh-category-icon">${c.icon || '📦'}</span><span>${esc(c.name)}</span></a>`).join('')
      : [
          ['📷','Cameras & Gear','camera'],
          ['⛺','Outdoor & Camping','camping'],
          ['🛠️','Tools & Equipment','tools'],
          ['💻','Electronics','electronics'],
          ['🚗','Vehicles','vehicle'],
          ['🪑','Home & Living','home'],
          ['🏀','Sports & Fitness','sports'],
          ['👗','Fashion','fashion'],
          ['🎮','Games & Hobbies','gaming']
        ].map(([i,n,q]) => `<a class="grh-category-card" href="/explore?q=${encodeURIComponent(q)}"><span class="grh-category-icon">${i}</span><span>${n}</span></a>`).join('');

    this.$app.innerHTML = `
      <section class="grh-home-hero">
        <div class="grh-hero-glow grh-glow-a"></div>
        <div class="grh-hero-glow grh-glow-b"></div>
        <div class="wrap grh-home-grid">
          <div class="grh-hero-copy">
            <div class="grh-kicker"><img src="/brand/gorenthive-mark.png" alt="" aria-hidden="true"> Philippine peer-to-peer rental marketplace</div>
            <h1>Rent What You Need.<br><span>Earn From What You Own.</span></h1>
            <p class="grh-hero-sub">Verified nearby rentals. Real people. Real opportunities. Search useful items around you or turn idle assets into extra income.</p>
            <div class="grh-hero-actions">
              <a class="grh-btn grh-btn-primary" href="/explore">Search rentals <span>→</span></a>
              <a class="grh-btn grh-btn-secondary" href="/list">List your item</a>
            </div>
            <div class="grh-trust-row">
              <div><span>⌖</span><b>Nearby Rentals</b><small>GPS radius search</small></div>
              <div><span>✓</span><b>Verified Accounts</b><small>Safer local rentals</small></div>
              <div><span>▣</span><b>Protected Payments</b><small>Documented transactions</small></div>
              <div><span>▤</span><b>Digital Agreements</b><small>Clear rental terms</small></div>
            </div>
          </div>
          <div class="grh-hero-showcase" aria-hidden="true">
            <div class="grh-honeycomb hc-1"></div><div class="grh-honeycomb hc-2"></div><div class="grh-honeycomb hc-3"></div>
            <div class="grh-hero-item grh-item-camera">📷<small>Camera</small></div>
            <div class="grh-hero-item grh-item-tool">🛠️<small>Tools</small></div>
            <div class="grh-hero-item grh-item-camping">⛺<small>Camping</small></div>
            <div class="grh-hero-item grh-item-tech">💻<small>Tech</small></div>
            <img class="grh-hero-mark" src="/brand/gorenthive-mark.png" alt="">
            <div class="grh-adventure-note">Your next need<br><b>is closer than you think.</b></div>
          </div>
        </div>

        <div class="wrap grh-search-wrap">
          <div class="grh-search-panel">
            <div class="grh-search-field">
              <span class="grh-search-ico">⌖</span>
              <div><label>Your Location</label><strong>Use verified GPS location</strong></div>
            </div>
            <div class="grh-search-field">
              <span class="grh-search-ico">▦</span>
              <div><label>What do you need?</label><input id="launch-q" placeholder="Camera, tent, drill, projector…" onkeydown="if(event.key==='Enter')Root.launchSearch()"></div>
            </div>
            <div class="grh-search-field">
              <span class="grh-search-ico">◎</span>
              <div><label>Search Radius</label><select id="launch-radius"><option value="5">Within 5 km</option><option value="10" selected>Within 10 km</option><option value="25">Within 25 km</option><option value="50">Within 50 km</option></select></div>
            </div>
            <button class="grh-search-button" onclick="Root.launchSearch()">⌕ <span>Search Rentals</span></button>
          </div>
        </div>
      </section>

      <main class="grh-home-main">
        <div class="wrap">
          <section class="grh-owner-strip">
            <div class="grh-store-ico">🏪</div>
            <div><h2>Have items to share?</h2><p>Turn your unused items into extra income.</p></div>
            <a class="grh-btn grh-btn-primary" href="/list">List Your Item <span>→</span></a>
            <div class="grh-owner-sep"></div>
            <div class="grh-community-proof"><div class="grh-avatars"><span>👤</span><span>👩</span><span>👨</span></div><p><b>Join the GoRentHive community</b><br>Rent locally. Earn from what you own.</p></div>
          </section>

          <section class="grh-section">
            <div class="grh-section-head"><div><p class="grh-eyebrow">EXPLORE THE MARKETPLACE</p><h2>Popular Categories</h2></div><a href="/categories">View All Categories →</a></div>
            <div class="grh-category-grid">${categoryCards}</div>
          </section>

          <section class="grh-value-grid">
            <article><span>01</span><h3>Find it nearby</h3><p>Use verified GPS and a radius that works for you.</p></article>
            <article><span>02</span><h3>Book with confidence</h3><p>Clear agreements, deposits and documented transaction steps.</p></article>
            <article><span>03</span><h3>Document condition</h3><p>Before-and-after photos help protect both sides of the rental.</p></article>
            <article><span>04</span><h3>Earn from idle assets</h3><p>Owners control pricing, availability and rental rules.</p></article>
          </section>

          <section class="grh-closing-banner">
            <div><p>THE RENTAL ECONOMY, BUILT FOR LOCAL COMMUNITIES</p><h2>A smarter way to <span>rent.</span><br>A brighter way to <span>earn.</span></h2></div>
            <img src="/brand/gorenthive-mark.png" alt="GoRentHive">
          </section>
        </div>
      </main>`;
  };

  setTimeout(() => Root.renderNav && Root.renderNav(), 0);
})();
