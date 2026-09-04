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
      brand.innerHTML = '<img src="/brand/gorenthive-wordmark.png" alt="GoRentHive" class="grh-wordmark" width="205" height="58">';
      brand.setAttribute('aria-label', 'GoRentHive home');
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
      ? cats.map(c => `<a class="grh-category-card" href="/explore?category=${encodeURIComponent(String(c.id))}"><span class="grh-category-icon" aria-hidden="true">${c.icon || '📦'}</span><span>${esc(c.name)}</span></a>`).join('')
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
        ].map(([i,n,q]) => `<a class="grh-category-card" href="/explore?q=${encodeURIComponent(q)}"><span class="grh-category-icon" aria-hidden="true">${i}</span><span>${n}</span></a>`).join('');

    this.$app.innerHTML = `
      <section class="grh-home-hero" aria-labelledby="grh-home-title">
        <div class="grh-hero-glow grh-glow-a"></div>
        <div class="grh-hero-glow grh-glow-b"></div>
        <div class="wrap grh-home-grid">
          <div class="grh-hero-copy">
            <div class="grh-kicker"><img src="/brand/gorenthive-mark.png" alt="" aria-hidden="true" width="26" height="26"> Philippine peer-to-peer rental marketplace</div>
            <h1 id="grh-home-title">Rent What You Need.<br><span>Earn From What You Own.</span></h1>
            <p class="grh-hero-sub">Verified nearby rentals. Real people. Real opportunities. Search useful items around you or turn idle assets into extra income.</p>
            <div class="grh-hero-actions">
              <a class="grh-btn grh-btn-primary" href="/explore">Search rentals <span aria-hidden="true">→</span></a>
              <a class="grh-btn grh-btn-secondary" href="/list">List your item</a>
            </div>
            <div class="grh-trust-row" aria-label="GoRentHive trust features">
              <div><span aria-hidden="true">⌖</span><b>Nearby Rentals</b><small>GPS radius search</small></div>
              <div><span aria-hidden="true">✓</span><b>Verified Accounts</b><small>Safer local rentals</small></div>
              <div><span aria-hidden="true">▣</span><b>Protected Payments</b><small>Documented transactions</small></div>
              <div><span aria-hidden="true">▤</span><b>Digital Agreements</b><small>Clear rental terms</small></div>
            </div>
          </div>
          <div class="grh-hero-showcase" aria-hidden="true">
            <div class="grh-honeycomb hc-1"></div><div class="grh-honeycomb hc-2"></div><div class="grh-honeycomb hc-3"></div>
            <div class="grh-hero-item grh-item-camera">📷<small>Camera</small></div>
            <div class="grh-hero-item grh-item-tool">🛠️<small>Tools</small></div>
            <div class="grh-hero-item grh-item-camping">⛺<small>Camping</small></div>
            <div class="grh-hero-item grh-item-tech">💻<small>Tech</small></div>
            <img class="grh-hero-mark" src="/brand/gorenthive-mark.png" alt="" width="190" height="210">
            <div class="grh-adventure-note">Your next need<br><b>is closer than you think.</b></div>
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
              <div><label for="launch-q">What do you need?</label><input id="launch-q" autocomplete="off" aria-label="What do you need to rent?" placeholder="Camera, tent, drill, projector…" onkeydown="if(event.key==='Enter')Root.launchSearch()"></div>
            </div>
            <div class="grh-search-field">
              <span class="grh-search-ico" aria-hidden="true">◎</span>
              <div><label for="launch-radius">Search radius</label><select id="launch-radius" aria-label="Search radius"><option value="5">Within 5 km</option><option value="10" selected>Within 10 km</option><option value="25">Within 25 km</option><option value="50">Within 50 km</option></select></div>
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
            <div class="grh-community-proof"><div class="grh-avatars" aria-hidden="true"><span>👤</span><span>👩</span><span>👨</span></div><p><b>Join the GoRentHive community</b><br>Rent locally. Earn from what you own.</p></div>
          </section>

          <section class="grh-section" aria-labelledby="grh-categories-title">
            <div class="grh-section-head"><div><p class="grh-eyebrow">EXPLORE THE MARKETPLACE</p><h2 id="grh-categories-title">Popular Categories</h2></div><a href="/categories">View All Categories →</a></div>
            <div class="grh-category-grid">${categoryCards}</div>
          </section>

          <section class="grh-value-grid" aria-label="How GoRentHive helps">
            <article><span>01</span><h3>Find it nearby</h3><p>Use verified GPS and a radius that works for you.</p></article>
            <article><span>02</span><h3>Book with confidence</h3><p>Clear agreements, deposits and documented transaction steps.</p></article>
            <article><span>03</span><h3>Document condition</h3><p>Before-and-after photos help protect both sides of the rental.</p></article>
            <article><span>04</span><h3>Earn from idle assets</h3><p>Owners control pricing, availability and rental rules.</p></article>
          </section>

          <section class="grh-closing-banner" aria-label="GoRentHive marketplace message">
            <div><p>THE RENTAL ECONOMY, BUILT FOR LOCAL COMMUNITIES</p><h2>A smarter way to <span>rent.</span><br>A brighter way to <span>earn.</span></h2></div>
            <img src="/brand/gorenthive-mark.png" alt="GoRentHive" width="120" height="120">
          </section>
        </div>
      </div>`;
  };

  setTimeout(() => Root.renderNav && Root.renderNav(), 0);
})();
