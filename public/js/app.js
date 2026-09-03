/* GoRentHive frontend SPA */
const Root = {
  state: {
    user: null,
    view: 'home',
    params: {},
    listings: [],
    collections: null,
    categories: [],
    unread: 0,
  },
  async init() {
    this.cacheEls();
    await this.loadUser();
    await this.loadCategories();
    this.bindNav();
    window.addEventListener('hashchange', () => this.route());
    this.route();
    this.loadUnread();
    if (this.state.user && !this.state.termsAccepted) {
      setTimeout(() => Root.promptTerms(), 700);
    }
  },
  promptTerms() {
    this.modal(`GoRentHive Terms Update
      <p style="font-size:13px;color:var(--ink-soft);margin-top:4px">Our Terms &amp; Conditions have been updated. You must accept them to keep renting and listing on GoRentHive.</p>
      <button class="btn btn-primary btn-block" onclick="Root.acceptTerms()">I accept the Terms &amp; Conditions</button>`, 'close');
  },
  cacheEls() {
    this.$app = document.getElementById('app');
    this.$topnav = document.getElementById('topnav');
    this.$bottom = document.getElementById('bottomnav');
    this.$toastWrap = document.getElementById('toastWrap');
  },
  async loadUser() {
    try {
      const d = await API.get('/auth/me');
      this.state.user = d.user;
      this.state.verification = d.verification || { verified: true, missing: [] };
      this.state.termsAccepted = !!d.termsAccepted;
      this.state.balance = d.user ? (d.balance !== undefined ? d.balance : null) : null;
      this.state.meLocation = d.location || null;
    } catch (e) { this.state.user = null; }
  },
  async loadCategories() {
    try { this.state.categories = await API.get('/categories'); } catch (e) { this.state.categories = []; }
  },
  async loadUnread() {
    if (!this.state.user) return;
    try {
      const msgs = await API.get('/messages');
      this.state.unread = msgs.reduce((s, m) => s + (m.unread || 0), 0);
      this.renderNav();
    } catch (e) {}
  },
  bindNav() {
    this.$topnav.addEventListener('click', (e) => {
      const t = e.target.closest('.menu-toggle');
      if (t) {
        this.$topnav.querySelector('.nav-links')?.classList.toggle('open');
        t.classList.toggle('open');
        return;
      }
      const a = e.target.closest('a[data-nav]');
      if (a) {
        const links = this.$topnav.querySelector('.nav-links');
        if (links && links.classList.contains('open')) {
          links.classList.remove('open');
          this.$topnav.querySelector('.menu-toggle')?.classList.remove('open');
        }
        this.renderNav();
      }
    });
  },
  renderNav() {
    const u = this.state.user;
    let links = '';
    if (u) {
      links = `
        <a data-nav href="#/explore">Explore</a>
        <a data-nav href="#/owner" class="only-wide">For Owners</a>
        ${u.role === 'admin' ? '<a data-nav href="#/admin">Admin</a>' : ''}
        <div class="pos-rel"><a data-nav href="#/messages">Messages${this.state.unread ? `<span class="notif-dot">${this.state.unread}</span>` : ''}</a></div>
        <a data-nav href="#/me"><span class="avatar">${u.full_name ? esc(u.full_name[0]) : '?'}</span></a>
      `;
    } else {
      links = `<a class="btn btn-outline" href="#/login">Log in</a><a class="btn btn-primary" href="#/register">Sign up</a>`;
    }
    this.$topnav.innerHTML = `
      <div class="wrap topnav-inner">
        <a href="#/" class="brand"><span class="logo">🐝</span><span><b>Go</b>RentHive</span></a>
        <button class="menu-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>
        <div class="nav-links"><div class="nav-link-pad">${links}</div></div>
      </div>`;
    this.$bottom.innerHTML = `
      <a href="#/" class="${this.state.view === 'home' ? 'active' : ''}"><span class="bx">🏠</span>Home</a>
      <a href="#/explore" class="${this.state.view === 'explore' ? 'active' : ''}"><span class="bx">🔍</span>Explore</a>
      <a href="#/list" class="${this.state.view === 'list' ? 'active' : ''}"><span class="bx">➕</span>List</a>
      <a href="${u ? '#/messages' : '#/login'}" class="${this.state.view === 'messages' ? 'active' : ''}"><span class="bx">💬</span>Chat${this.state.unread ? '<span class="notif-dot" style="left:auto;right:calc(50% - 14px)">' + this.state.unread + '</span>' : ''}</a>
      <a href="${u ? '#/me' : '#/login'}" class="${this.state.view === 'me' ? 'active' : ''}"><span class="bx">👤</span>Me</a>`;
  },
  toast(msg, type = 'info', ms = 2600) {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    this.$toastWrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
  },
  async route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const parts = hash.split('?')[0].split('/').filter(Boolean);
    const segs = hash.split('?')[1];
    this.renderNav();
    const query = segs ? Object.fromEntries(new URLSearchParams(segs)) : {};
    this.state.params = { parts, query };
    this.setMetaForRoute(parts, query);
    this.$app.innerHTML = `<div class="spinner"></div>`;
    try {
      await this.render(parts, query);
    } catch (e) {
      if (e && e.status === 401 && parts[0] !== 'login' && parts[0] !== 'register') {
        location.hash = '#/login';
        return;
      }
      this.$app.innerHTML = `<div class="empty"><div class="em">⚠️</div><h3>Something went wrong</h3><p>${esc(e && e.message || 'Server error')}</p></div>`;
    }
    window.scrollTo(0, 0);
  },
  setMeta(title, description, canonicalPath) {
    document.title = title;
    const setMeta = (attr, qual, val) => {
      let m = document.querySelector(`meta[${attr}="${qual}"]`);
      if (!m) { m = document.createElement('meta'); m.setAttribute(attr, qual); document.head.appendChild(m); }
      m.setAttribute('content', val);
    };
    setMeta('name', 'description', description);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    let can = document.querySelector('link[rel="canonical"]');
    if (can) can.setAttribute('href', 'https://gorenthive.online' + canonicalPath);
  },
  setMetaForRoute(parts, query) {
    const route = parts[0] || 'home';
    const SITE = 'GoRentHive Philippines';
    const q = (query.q || '').trim();
    const M = {
      home: [ `GoRentHive | Rent Anything, Earn From What You Own`, `Rent tools, vehicles, party equipment, cameras and more from people near you in ${SITE} — or turn your unused items into income.`, '/' ],
      explore: [ `${q ? `${q} for Rent in ${SITE}` : `Explore Rentals | ${SITE}`}`, `Rent cameras, tents, speakers, cars, tools and more from local owners in ${SITE}.`, '/explore' ],
      categories: [ `Categories | ${SITE}`, `Browse rental categories — cameras, tents, speakers, tools, vehicles and more in ${SITE}.`, '/categories' ],
      listing: [ `Rental Details | ${SITE}`, `View and book this item for rent in ${SITE}.`, `/listing/${parts[1] || ''}` ],
      rent: [ `Rent Items Near You | ${SITE}`, `Find gear, tools, vehicles and more for rent from local owners in ${SITE}.`, '/rent' ],
      earn: [ `Earn Money Renting Your Items | ${SITE}`, `Turn unused tools, equipment, vehicles and other items into extra income on GoRentHive.`, '/earn' ],
      pricing: [ `Pricing & Fees | ${SITE}`, `Simple, honest pricing for peer-to-peer rentals in ${SITE}.`, '/pricing' ],
      'how-it-works': [ `How GoRentHive Works | ${SITE}`, `Rent & earn in ${SITE}: find an item, request a rental, pay securely.`, '/how-it-works' ],
      'trust-safety': [ `Trust & Safety | GoRentHive`, `GoRentHive is designed for safer peer-to-peer rentals — verified users and secure transactions.`, '/trust-safety' ],
      about: [ `About GoRentHive | ${SITE}`, `The peer-to-peer rental marketplace for the things you already own.`, '/about' ],
      help: [ `Help Center | GoRentHive`, `Get help with renting, earning, payments and more on GoRentHive.`, '/help' ],
      contact: [ `Contact Us | GoRentHive`, `Contact the GoRentHive support team.`, '/contact' ],
      legal: [ `Legal | GoRentHive`, `GoRentHive legal documents — terms, privacy, rental agreement.`, `/legal/${parts[1] || ''}` ],
      login: [ `Log in | GoRentHive`, `Log in to your GoRentHive account to rent and earn.`, '/login' ],
      register: [ `Create Account | GoRentHive`, `Create a free GoRentHive account to rent and earn in the Philippines.`, '/register' ],
    };
    const m = M[route];
    if (m) this.setMeta(m[0], m[1], m[2]);
  },
  async render(parts, query) {
    const [route = 'home', id] = parts;
    try {
      switch (route) {
        case '': case 'home': return this.viewHome();
        case 'explore': return this.viewExplore(query);
        case 'categories': return this.viewCategories();
        case 'listing': return this.viewListing(id);
        case 'booking': return this.viewBookingDetail(id);
        case 'list': return this.guard(() => this.viewListForm(id || null));
        case 'owner': return this.guard(() => this.viewOwnerDashboard());
        case 'dashboard': return this.guard(() => this.viewSellerDashboard());
        case 'premium': return this.guard(() => this.viewPremium());
        case 'messages': return this.guard(() => this.viewMessages());
        case 'favorites': return this.guard(() => this.viewFavorites());
        case 'wallet': return this.guard(() => this.viewWallet());
        case 'me': return this.guard(() => this.viewProfile());
        case 'profile': return this.viewPublicProfile(id);
        case 'login': return this.viewAuth('login');
        case 'register': return this.viewAuth('register');
        case 'requests': return this.guard(() => this.viewRequests());
        case 'admin': return this.guard(() => this.viewAdmin(query.tab), true);
        case 'legal': return this.viewLegal(id);
        case 'notifications': return this.guard(() => this.viewNotifications());
        case 'verify': return this.guard(() => this.viewVerify());
        case 'earn': return this.viewEarn();
        case 'rent': return this.viewRent();
        case 'pricing': return this.viewPricing();
        case 'trust-safety': return this.viewTrustSafety();
        case 'help': return this.viewHelp();
        case 'how-it-works': return this.viewHowItWorks();
        case 'about': return this.viewAbout();
        case 'contact': return this.viewContact();
        case 'paymongo': return this.handlePayMongoCallback(query);
        default: this.$app.innerHTML = `<div class="empty"><div class="em">🚫</div><h3>Page not found</h3></div>`;
      }
    } catch (e) {
      if (e.status === 401 && route !== 'login' && route !== 'register') {
        location.hash = '#/login';
        return;
      }
      this.$app.innerHTML = `<div class="empty"><div class="em">⚠️</div><h3>Something went wrong</h3><p>${esc(e.message)}</p></div>`;
    }
  },
  guard(fn, isAdmin) {
    if (!this.state.user) { this.$app.innerHTML = `<div class="empty"><div class="em">🔒</div><h3>Please log in</h3><p>You need an account to continue.</p><div style="margin-top:16px"><a class="btn btn-primary" href="#/login">Log in</a> <a class="btn btn-outline" href="#/register">Sign up</a></div></div>`; this.renderNav(); return; }
    if (isAdmin && this.state.user.role !== 'admin') { this.$app.innerHTML = `<div class="empty"><div class="em">🚫</div><h3>Admin only</h3></div>`; return; }
    return fn();
  },
  requireAuth() { return !!this.state.user; },

  /* ================= HOME ================= */
  async viewHome() {
    let collections = this.state.collections;
    if (!collections) {
      try { collections = await API.get('/listings/collections'); this.state.collections = collections; }
      catch (e) { collections = { trending: [], featured: [], bundles: [], topOwners: [] }; }
    }
    const cats = this.state.categories.slice(0, 8);
    this.$app.innerHTML = `
      <section class="hero">
        <div class="wrap">
          <div class="hero-grid">
            <div class="hero-copy">
              <span class="hero-eyebrow">⚡ Peer-to-peer rental marketplace</span>
              <h1>Rent What You Need. <span>Earn From What You Own.</span></h1>
              <p class="sub">Rent tools, vehicles, party supplies, cameras and more from people near you — or turn your own unused things into income.</p>
              <div class="hero-ctas">
                <a class="btn btn-primary" href="#/explore">🔍 Search Items</a>
                <a class="btn btn-outline-light" href="#/list">＋ List Your Item</a>
              </div>
              <div class="hero-trust-strip">
                <span class="ts-item"><b>✓</b> Verified users</span>
                <span class="ts-item"><b>🔒</b> Escrow protected</span>
                <span class="ts-item"><b>🗹</b> Deposit-backed</span>
              </div>
            </div>
            <div class="hero-visual">
              <div class="hv-card hv-c1" style="--hvc:${esc(cats.length ? cats[0].color : '#E8920C')}"><em>${cats.length ? cats[0].icon : '📸'}</em><span>${cats.length ? esc(cats[0].name) : 'Cameras'}</span></div>
              <div class="hv-card hv-c2" style="--hvc:${esc(cats.length > 1 ? cats[1].color : '#6C5CE7')}"><em>${cats.length > 1 ? cats[1].icon : '⛺'}</em><span>${cats.length > 1 ? esc(cats[1].name) : 'Camping'}</span></div>
              <div class="hv-card hv-c3" style="--hvc:${esc(cats.length > 2 ? cats[2].color : '#22A06B')}"><em>${cats.length > 2 ? cats[2].icon : '🔊'}</em><span>${cats.length > 2 ? esc(cats[2].name) : 'Events'}</span></div>
              <div class="hv-badge"><b>★ 4.8</b> trusted community</div>
            </div>
          </div>
          <div class="search-card">
            <div class="field"><label>🔍 What do you need?</label><input id="hp-q" placeholder="Camera, tent, speaker, generator..."></div>
            <div class="field"><label>📍 Where?</label><input id="hp-city" placeholder="City / Barangay"></div>
            <div class="field"><label>📅 Rental dates</label><input id="hp-sd" type="date"><span style="display:inline-flex;align-items:center;padding:0 6px;color:var(--ink-soft)">to</span><input id="hp-ed" type="date"></div>
            <button class="search-btn" onclick="Root.doSearch()">SEARCH →</button>
          </div>
          <div class="hero-examples">
            <a class="chip" href="#/explore?q=Camera">Camera</a>
            <a class="chip" href="#/explore?q=Tent">Tent</a>
            <a class="chip" href="#/explore?q=Speaker">Speaker</a>
            <a class="chip" href="#/explore?q=Generator">Generator</a>
            <a class="chip" href="#/explore?q=Bike">Bike</a>
            <a class="chip" href="#/explore?q=Pickleball">Pickleball paddle</a>
            <a class="chip" href="#/explore?bundle=1">🎁 Bundles</a>
          </div>
          <div class="hero-stats">
            <div><div class="num">${this.state.categories.length}+</div><div class="lbl">Categories</div></div>
            <div><div class="num">${collections.trending.length ? 'Local' : '—'}</div><div class="lbl">Near you</div></div>
            <div><div class="num">4%</div><div class="lbl">Platform fee</div></div>
            <div><div class="num">100%</div><div class="lbl">Escrow-backed</div></div>
          </div>
        </div>
      </section>

      <div class="wrap">
        <section class="section">
          <div class="section-head"><h2>Popular Categories</h2><a class="more" href="#/categories">View all →</a></div>
          <div class="cat-grid">${cats.map(c => this.catCard(c)).join('')}</div>
        </section>

        ${collections.bundles.length ? `<section class="section">
          <div class="section-head"><h2>🎁 Rental Bundles</h2><a class="more" href="#/explore?bundle=1">View all →</a></div>
          <div class="card-grid">${collections.bundles.map(l => this.listingCard(l)).join('')}</div>
        </section>` : ''}

        <section class="section">
          <div class="section-head"><h2>🔥 Trending Rentals</h2><a class="more" href="#/explore">View all →</a></div>
          <div class="card-grid">${collections.trending.map(l => this.listingCard(l)).join('')}</div>
        </section>

        <section class="section">
          <div class="ownbanner">
            <div><h2>OWN SOMETHING PEOPLE NEED?</h2><p style="opacity:.9;margin-top:6px">Turn unused things into income. List an item and watch it earn.</p></div>
            <div class="earn-ex">
              <div class="earn-tag">Camera<b>₱500/day</b></div>
              <div class="earn-tag">Tent<b>₱300/day</b></div>
              <div class="earn-tag">Speaker<b>₱800/day</b></div>
              <div class="earn-tag">Generator<b>₱1,500/day</b></div>
            </div>
            <div><a class="btn btn-primary btn-lg" href="#/list">LIST YOUR ITEM</a></div>
          </div>
        </section>

        ${collections.featured.length ? `<section class="section">
          <div class="section-head"><h2>⭐ Featured Listings</h2></div>
          <div class="card-grid">${collections.featured.map(l => this.listingCard(l)).join('')}</div>
        </section>` : ''}

        ${collections.topOwners.length ? `<section class="section">
          <div class="section-head"><h2>🏅 Top Rated Owners</h2></div>
          <div class="card-grid">${collections.topOwners.map(o => this.ownerCard(o)).join('')}</div>
        </section>` : ''}

        <section class="section">
          <div class="section-head"><h2>How GoRentHive Works</h2></div>
          <div class="steps">
            <div class="step"><div class="n">1</div><h3>Find an Item</h3><p>Find exactly what you need near you.</p></div>
            <div class="step"><div class="n">2</div><h3>Request a Rental</h3><p>Choose dates, pay securely. Deposit held safely.</p></div>
            <div class="step"><div class="n">3</div><h3>Pay & Receive</h3><p>Pick up or get it delivered. Record condition.</p></div>
            <div class="step"><div class="n">4</div><h3>Return & Review</h3><p>Return on time, get deposit back, rate each other.</p></div>
          </div>
        </section>

        <section class="section">
          <div class="section-head"><h2>Built for Safer Rentals</h2></div>
          <div class="card-grid">
            <div class="step"><h3>✅ Verified Users</h3><p>Mobile, email & ID verification with trust levels.</p></div>
            <div class="step"><h3>💰 Secure Payments</h3><p>Provider-agnostic payment & escrow for deposits.</p></div>
            <div class="step"><h3>📄 Rental Agreements</h3><p>Auto-generated, digitally signed agreements.</p></div>
            <div class="step"><h3>🤝 Dispute Resolution</h3><p>Report problems with full evidence trail.</p></div>
          </div>
        </section>
      </div>`;
  },
  catCard(c) {
    return `<a class="cat-card" href="#/explore?category=${c.id}">
      <div class="ic" style="background:${esc(c.color)}18;color:${esc(c.color)}">${c.icon}</div>
      <div><div class="nm">${esc(c.name)}</div><div class="ct">${c.count} items</div></div>
    </a>`;
  },
  listingCard(l) {
    const badges = [];
    if (l.featured) badges.push(`<span class="badge badge-featured">🔥 FEATURED</span>`);
    if (l.is_bundle) badges.push(`<span class="badge badge-bundle">🎁 BUNDLE</span>`);
    const img = (l.images && l.images[0]) || '/images/svg/placeholder.svg';
    return `<a class="listing-card" href="#/listing/${l.id}">
      <div class="thumb">
        <img src="${esc(img)}" alt="${esc(l.title)}" loading="lazy" decoding="async">
        ${badges.join('')}
      </div>
      <div class="listing-body">
        <h3 class="t">${esc(l.title)}</h3>
        <div class="meta">📍 ${esc(l.location_city)} · <span class="rating">${stars(l.avg_rating)}</span> · ${l.rental_count ? l.rental_count + ' rentals' : 'New'}</div>
        <div class="price-row">
          <div class="price">${fmtMoney(l.price_per_day)}<small>/day</small></div>
          <div class="rating">${l.avg_rating ? l.avg_rating + ' ★' : 'New'}</div>
        </div>
        <div class="owner-row">
          <div class="avatar sm">${esc((l.owner && l.owner.full_name || '?')[0])}</div>
          <div class="grow"><div class="nm">${esc(l.owner ? l.owner.full_name : 'Owner')} ${l.owner && l.owner.identity_status === 'verified' ? '<span class="verified-chip">✓</span>' : ''}</div>${l.owner ? this.trustChip(l.owner) : ''}</div>
        </div>
      </div>
    </a>`;
  },
  ownerCard(o) {
    return `<a class="cat-card" href="#/profile/${o.id}">
      <div class="avatar lg">${esc((o.full_name || '?')[0])}</div>
      <div>      <div class="nm">${esc(o.full_name)} ${o.verificationBadge ? '<span class="verified-chip">✓</span>' : ''} ${o.locationBadge ? `<span class="loc-chip">📍</span>` : ''} ${this.trustChip(o)}</div>
      <div class="ct">${o.itemCount} items · ${stars(o.vessel_rating)} ${o.vessel_rating}</div></div>
    </a>`;
  },
  async doSearch() {
    const q = document.getElementById('hp-q').value.trim();
    const city = document.getElementById('hp-city').value.trim();
    const sd = document.getElementById('hp-sd').value;
    const ed = document.getElementById('hp-ed').value;
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (city) p.set('city', city);
    if (sd && ed) p.set('range', sd + ',' + ed);
    location.hash = '#/explore?' + p.toString();
  },

  /* ================= EXPLORE ================= */
  async viewExplore(query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => v && params.set(k, v));
    const url = params.toString() ? '?' + params.toString() : '';
    this.$app.innerHTML = `
      <div class="wrap">
        <section class="section" style="padding-top:28px">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <input id="ex-q" value="${esc(query.q || '')}" placeholder="🔍 Search items..." style="flex:1;min-width:200px;padding:12px 14px;border:1.5px solid var(--line);border-radius:11px">
            <input id="ex-city" value="${esc(query.city || '')}" placeholder="📍 City" style="padding:12px 14px;border:1.5px solid var(--line);border-radius:11px">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select id="ex-cat" style="padding:11px 12px;border:1.5px solid var(--line);border-radius:11px"><option value="">All categories</option>${this.state.categories.map(c => `<option value="${c.id}" ${String(query.category) === String(c.id) ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>
            <select id="ex-sort" style="padding:11px 12px;border:1.5px solid var(--line);border-radius:11px">
              <option value="">Sort: Featured</option><option value="price_asc">Price: Low to High</option><option value="price_desc">Price: High to Low</option><option value="popular">Most Popular</option><option value="rating">Top Rated</option>
            </select>
            <select id="ex-radius" style="padding:11px 12px;border:1.5px solid var(--line);border-radius:11px" title="Nearby radius">
              <option value="">📍 Near me: Any</option><option value="5">Within 5 km</option><option value="10">Within 10 km</option><option value="25">Within 25 km</option>
            </select>
            ${query.bundle ? '<a class="btn btn-outline btn-sm" href="#/explore">Clear bundle</a>' : '<label class="checkbox-label" style="gap:6px"><input type="checkbox" id="ex-bundle">🎁 Bundles</label>'}
            <button class="btn btn-primary btn-sm" onclick="Root.applyExplore()">Apply</button>
          </div>
          <div id="ex-results" style="margin-top:20px"><div class="spinner"></div></div>
        </section>
      </div>`;
    await this.applyExplore(true);
  },
  async applyExplore(initial) {
    const q = document.getElementById('ex-q').value.trim();
    const city = document.getElementById('ex-city').value.trim();
    const cat = document.getElementById('ex-cat').value;
    const sort = document.getElementById('ex-sort').value;
    const radius = document.getElementById('ex-radius') ? document.getElementById('ex-radius').value : '';
    const bundle = document.getElementById('ex-bundle') ? document.getElementById('ex-bundle').checked : (this.state.params.query.bundle === '1');
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (city) p.set('city', city);
    if (cat) p.set('category', cat);
    if (sort) p.set('sort', sort);
    if (bundle) p.set('bundle', '1');
    if (radius) {
      const coords = await this.resolveRadiusCoords();
      if (coords && coords.lat != null && coords.lng != null) { p.set('radius', radius); p.set('lat', coords.lat); p.set('lng', coords.lng); }
      else { this.toast('Enable location access or verify your location to search nearby.', 'error'); }
    }
    if (!initial) history.replaceState(null, '', '#/explore?' + p.toString());
    const data = await API.get('/listings?' + p.toString());
    const el = document.getElementById('ex-results');
    if (!data.length) { el.innerHTML = `<div class="empty"><div class="em">🔍</div><h3>No items found</h3><p>Can't find it? <a href="#/requests" style="color:var(--brand);font-weight:700">Post a rental request →</a></p></div>`; return; }
    el.innerHTML = `<div class="card-grid">${data.map(l => this.listingCard(l)).join('')}</div>`;
  },
  async resolveRadiusCoords() {
    const me = this.state.meLocation;
    if (me && me.latitude != null && me.longitude != null) return { lat: me.latitude, lng: me.longitude };
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('geolocation unavailable'));
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 });
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) { return null; }
  },

  /* ================= CATEGORIES ================= */
  viewCategories() {
    this.$app.innerHTML = `<div class="wrap"><section class="section" style="padding-top:28px">
      <div class="section-head"><h2>Browse by Category</h2></div>
      <div class="cat-grid">${this.state.categories.map(c => this.catCardExpanded(c)).join('')}</div>
      <p class="alt" style="text-align:left">Renting something unusual? <a href="#" onclick="Root.newCategory();return false">Suggest a category</a> or <a href="#/list">list it</a>.</p>
    </section></div>`;
  },
  catCardExpanded(c) {
    return `<details class="cat-card" style="cursor:pointer;display:block">
      <summary style="display:flex;gap:12px;align-items:center;list-style:none">
        <div class="ic" style="background:${esc(c.color)}18;color:${esc(c.color)}">${c.icon}</div>
        <div><div class="nm">${esc(c.name)}</div><div class="ct">${c.count} items</div></div>
      </summary>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${(c.subcategories || []).map(s => `<a class="chip" href="#/explore?category=${c.id}">${esc(s.name)}</a>`).join('') || '<span class="chip">View items</span>'}</div>
    </details>`;
  },
  newCategory() { prompt('Suggest a category name:'); this.toast('Category suggestion received. Thanks!', 'success'); },

  /* ================= LISTING DETAIL ================= */
  async viewListing(id) {
    const [l, related] = await Promise.all([API.get('/listings/' + id), API.get('/listings/' + id + '/related').catch(() => [])]);
    const u = this.state.user;
    const canBook = u && u.id !== l.owner.id && l.status === 'active';
    const imgs = l.images || [];
    const bundleHtml = l.is_bundle && l.bundle_items.length ? `
      <div class="detail-card" style="margin-top:16px"><h3>🎁 This is a Rental Bundle</h3>
        <div class="bundle-items">${l.bundle_items.map(it => `<div class="bundle-item"><span class="em">${esc(it.title[0]) || '·'}</span><div><b>${esc(it.title)}</b><div style="font-size:12px;color:var(--ink-soft)">${esc(it.description || '')}</div></div></div>`).join('')}</div>
      </div>` : '';
    this.$app.innerHTML = `
      <div class="wrap" style="padding-top:20px">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span>/</span><a href="#/explore">Explore</a><span>/</span><span>${esc(l.title)}</span></nav>
        <a class="back-btn" href="javascript:history.back()">← Back</a>
        <div class="detail-grid">
          <div>
            <div class="gallery">${imgs[0] ? `<img src="${esc(imgs[0])}" alt="${esc(l.title)}">` : `<div style="height:100%;display:grid;place-items:center;color:var(--ink-soft)">No image</div>`}</div>
            <div style="display:flex;gap:8px;margin-top:10px">${imgs.slice(1, 4).map(i => `<div class="gallery" style="flex:1"><img src="${esc(i)}" style="aspect-ratio:1"></div>`).join('')}</div>
            ${bundleHtml}
            <div class="detail-card" style="margin-top:16px">
              <h3>About this item</h3>
              <div class="detail-desc">${esc(l.description || 'No description provided.')}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">
                ${this.metaCell('Condition', l.condition || '—')}
                ${this.metaCell('Item value', fmtMoney(l.estimated_value || 0))}
                ${this.metaCell('Deposit (' + (l.deposit_tier_info ? l.deposit_tier_info.label : (l.deposit_tier || 'Low')) + ' tier)', fmtMoney(l.security_deposit))}
                ${this.metaCell('Cancellation', l.cancellation_policy || 'Standard')}
                ${this.metaCell('Verification needed', 'Level ' + (l.min_verification_level || 2))}
                ${this.metaCell('Location', esc(l.location_barangay || '') + ' ' + esc(l.location_city))}
                ${this.metaCell('Pickup', l.pickup_available ? 'Available' : 'No')}
                ${this.metaCell('Delivery', l.delivery_available ? 'Yes (+' + fmtMoney(l.delivery_fee) + ')' : 'No')}
                ${this.metaCell('Accessories', l.accessories ? 'Included' : '—')}
              </div>
              ${l.accessories ? `<h4 style="margin-top:14px">Included accessories</h4><p style="font-size:13.5px;color:var(--ink-soft)">${esc(l.accessories)}</p>` : ''}
              ${l.rules ? `<h4 style="margin-top:14px">Rules</h4><p style="font-size:13.5px;color:var(--ink-soft)">${esc(l.rules)}</p>` : ''}
            </div>
            <div class="detail-card" style="margin-top:16px">
              <h3>Owner</h3>
              <div class="owner-card" style="border-top:none;padding-top:4px">
                <div class="avatar lg">${esc((l.owner.full_name || '?')[0])}</div>
                <div class="info grow"><div class="nm">${esc(l.owner.full_name)} ${l.owner.identity_status === 'verified' ? '<span class="verified-chip">✓ Verified</span>' : ''}</div>
                  <div class="sub">${stars(l.owner.vessel_rating)} ${Number(l.owner.vessel_rating).toFixed(1)} · ${l.owner.successful_rentals} successful rentals</div>
                </div>
                <a class="btn btn-outline btn-sm" href="#/profile/${l.owner.id}">View</a>
              </div>
              <div style="display:flex;gap:8px;margin-top:8px">
                ${u ? `<button class="btn btn-outline grow" onclick="Root.openChat('${l.owner.id}', ${l.id})">💬 Message Owner</button>` : `<a class="btn btn-outline grow" href="#/login">💬 Message Owner</a>`}
                <button class="btn btn-outline" onclick="Root.toggleFavorite(${l.id})">♡</button>
              </div>
            </div>
            <div class="detail-card" style="margin-top:16px">
              <h3>Reviews</h3>
              ${l.reviews && l.reviews.length ? l.reviews.map(r => `<div class="list-row" style="box-shadow:none"><div class="body"><div class="rating">${stars(r.rating)}</div><div class="s">${esc(r.comment || 'No comment')}</div></div></div>`).join('') : '<p style="color:var(--ink-soft);font-size:13px;margin-top:8px">No reviews yet.</p>'}
            </div>
          </div>
          <div>
            <div class="booking-box">
              <h3>${esc(l.title)}</h3>
              <div class="detail-price-big">${fmtMoney(l.price_per_day)}<small>/day</small></div>
              <div class="detail-meta">
                <span class="meta-pill">📍 ${esc(l.location_city)}</span>
                <span class="meta-pill rating">${stars(l.avg_rating)}</span>
                <span class="meta-pill">🔄 ${l.rental_count} rentals</span>
                ${l.featured ? '<span class="meta-pill" style="background:var(--brand-soft);color:var(--brand-dark)">🔥 Featured</span>' : ''}
              </div>
              ${canBook ? `
                <div class="field" style="margin-top:8px"><label>Start date</label><input id="bk-sd" type="date" value="${this.todayStr()}"></div>
                <div class="field" style="margin-top:8px"><label>End date</label><input id="bk-ed" type="date" value="${this.addDaysStr(1)}"></div>
                ${l.delivery_available ? `<div class="form-row" style="margin-top:8px"><label>Delivery method</label>
                  <div class="tier-picker dm-picker">
                    <label class="tier-card" data-dm="pickup"><input type="radio" name="bk-dm" value="pickup" checked onchange="Root.onDeliveryChange()"><span class="tier-name">📦 Pickup</span><span class="tier-band">Self-collect / meet the owner</span></label>
                    <label class="tier-card" data-dm="lalamove"><input type="radio" name="bk-dm" value="lalamove" onchange="Root.onDeliveryChange()"><span class="tier-name">🚚 Lalamove</span><span class="tier-band">Door-to-door courier</span></label>
                  </div>
                  <div id="bk-lala" style="display:none;margin-top:10px;background:var(--bg);padding:12px;border-radius:12px">\
                    <label style="display:block;font-size:12px;font-weight:600">Distance (km)</label><input id="bk-dist" type="number" min="0.5" step="0.5" value="5" oninput="Root.updateQuote()">\
                    <label style="display:block;font-size:12px;font-weight:600;margin-top:8px">Vehicle</label><select id="bk-veh" onchange="Root.updateQuote()"><option value="motorcycle">Motorcycle</option><option value="car">Car</option><option value="truck">Truck / Light van</option></select>\
                    <label style="display:block;font-size:12px;font-weight:600;margin-top:8px">Drop-off address</label><input id="bk-drop" type="text" placeholder="Complete address (street, barangay, city)" value="">\
                    <p style="font-size:11px;color:var(--ink-soft);margin-top:8px">🚚 The Lalamove fee is added to your total. A driver is assigned only after the owner approves and your payment clears.</p>\
                  </div></div>` : `<div class="form-row" style="margin-top:8px"><label>Delivery method</label><input id="bk-dm-pickup" type="hidden" value="pickup"><p style="font-size:12px;color:var(--ink-soft)">📦 This item is pickup-only.</p></div>`}
                <div class="form-row" style="margin-top:8px">
                  <label class="checkbox-label" style="gap:6px;align-items:flex-start"><input type="checkbox" id="bk-public" onchange="Root.onPublicPlaceChange()"> <span>📍 Meet at a <b>public place</b> (e.g. mall, barangay hall)<br><small style="color:var(--ink-soft);font-weight:400">Both you and the owner confirm the meeting point in-app before handover.</small></span></label>
                </div>
                <div id="bk-mp" style="display:none;margin-top:8px;background:var(--bg);padding:12px;border-radius:12px">
                  <label style="display:block;font-size:12px;font-weight:600">Agreed public place</label>
                  <input id="bk-mp-name" type="text" placeholder="e.g. SM Mall of Asia - North Entrance">
                  <label style="display:block;font-size:12px;font-weight:600;margin-top:8px">Address / description (optional)</label>
                  <input id="bk-mp-addr" type="text" placeholder="Barangay, city">
                  <p style="font-size:11px;color:var(--ink-soft);margin-top:8px">📍 Choose a safe, busy public place. The exact address is only shared with the owner once the booking is confirmed.</p>
                </div>
                <div id="bk-quote" style="margin-top:10px"></div>
                <button class="btn btn-primary btn-block btn-lg" style="margin-top:14px" onclick="Root.doBook(${l.id})">Request to Rent →</button>` :
                (u && u.id === l.owner.id ? `<p class="alt">This is your listing.</p>` :
                (l.status !== 'active' ? `<p class="alt">This item is currently ${esc(l.status)}.</p>` : `<a class="btn btn-primary btn-block btn-lg" href="#/login">Login to rent</a>`))}
            </div>
          </div>
        </div>
        ${related.length ? `<section class="section"><div class="section-head"><h2>You might also like</h2></div><div class="card-grid">${related.map(r => this.listingCard(r)).join('')}</div></section>` : ''}
      </div>`;
    const sd = document.getElementById('bk-sd'), ed = document.getElementById('bk-ed');
    if (sd && ed) {
      this._quoteListing = l;
      sd.addEventListener('change', () => this.updateQuote());
      ed.addEventListener('change', () => this.updateQuote());
      this.updateQuote();
    }
  },
  onDeliveryChange() {
    const dm = document.querySelector('input[name="bk-dm"]:checked');
    const isLala = dm && dm.value === 'lalamove';
    const panel = document.getElementById('bk-lala');
    if (panel) panel.style.display = isLala ? 'block' : 'none';
    document.querySelectorAll('.dm-picker .tier-card').forEach((c) => c.classList.toggle('on', c.dataset.dm === (dm ? dm.value : 'pickup')));
    this.updateQuote();
  },
  onPublicPlaceChange() {
    const el = document.getElementById('bk-public');
    const panel = document.getElementById('bk-mp');
    if (panel) panel.style.display = (el && el.checked) ? 'block' : 'none';
  },
  metaCell(k, v) { return `<div style="background:var(--bg);padding:10px;border-radius:10px"><div style="font-size:11px;color:var(--ink-soft);font-weight:600">${esc(k)}</div><div style="font-size:13.5px;font-weight:600;margin-top:2px">${v}</div></div>`; },
  todayStr() { const d = new Date(); return d.toISOString().split('T')[0]; },
  addDaysStr(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; },
  async updateQuote() {
    const l = this._quoteListing;
    if (!l) return;
    const sd = document.getElementById('bk-sd').value;
    const ed = document.getElementById('bk-ed').value;
    if (!sd || !ed) { document.getElementById('bk-quote').innerHTML = ''; return; }
    const dm = document.querySelector('input[name="bk-dm"]:checked');
    const method = dm ? dm.value : 'pickup';
    const body = { listing_id: l.id, start_date: sd, end_date: ed, delivery_method: method };
    let lalaLabel = '';
    if (method === 'lalamove') {
      body.distance_km = parseFloat(document.getElementById('bk-dist').value) || 5;
      body.vehicle_type = document.getElementById('bk-veh').value;
      lalaLabel = `🚚 Lalamove`;
    }
    try {
      const q = await API.post('/bookings/quote', body);
      this._quoteTotal = q.total;
      document.getElementById('bk-quote').innerHTML = `
        <div class="price-line"><span>${q.days} day${q.days > 1 ? 's' : ''} × ${fmtMoney(l.price_per_day)}</span><span>${fmtMoney(q.rental_fee)}</span></div>
        ${q.delivery_fee ? `<div class="price-line"><span>${lalaLabel} (${q.distance_km} km · ${q.vehicle_type ? q.vehicle_type[0].toUpperCase() + q.vehicle_type.slice(1) : ''})</span><span>${fmtMoney(q.delivery_fee)}</span></div>` : ''}
        <div class="price-line fee"><span>Platform fee (4%)</span><span>${fmtMoney(q.platform_fee)}</span></div>
        <div class="price-line deposit"><span>Refundable deposit</span><span>${fmtMoney(q.security_deposit)}</span></div>
        ${q.deposit_discount_pct > 0 ? `<div style="font-size:11px;color:var(--green);margin-top:2px">⭐ Trust discount: your ${q.deposit_discount_pct}% deposit discount (was ${fmtMoney(q.security_deposit_full)}) is applied based on your rental history.</div>` : ''}
        <div class="price-line total"><span>Total</span><span>${fmtMoney(q.total)}</span></div>
        <p style="font-size:11px;color:var(--ink-soft);margin-top:6px">🔒 Paid securely through your GoRentHive wallet and held in escrow. Your ${fmtMoney(q.security_deposit)} deposit is refundable after a successful return.</p>`;
    } catch (e) { document.getElementById('bk-quote').innerHTML = `<p style="color:var(--red);font-size:13px">${esc(e.message)}</p>`; }
  },
  async doBook(id) {
    const sd = document.getElementById('bk-sd').value;
    const ed = document.getElementById('bk-ed').value;
    const dm = document.querySelector('input[name="bk-dm"]:checked');
    const method = dm ? dm.value : (document.getElementById('bk-dm-pickup') ? 'pickup' : 'pickup');
    const pubEl = document.getElementById('bk-public');
    const publicPlace = pubEl ? pubEl.checked : false;
    const body = { listing_id: id, start_date: sd, end_date: ed, delivery_method: method, pickup_option: publicPlace ? 'public_place' : 'pickup' };
    if (publicPlace) {
      const mpName = document.getElementById('bk-mp-name').value.trim();
      if (!mpName) { this.toast('Please name the agreed public meeting place.', 'error'); return; }
      body.meeting_point_name = mpName;
      body.meeting_point_address = document.getElementById('bk-mp-addr').value.trim();
    }
    if (method === 'lalamove') {
      body.distance_km = parseFloat(document.getElementById('bk-dist').value) || 5;
      body.vehicle_type = document.getElementById('bk-veh').value;
      if (!publicPlace) {
        body.dropoff_address = document.getElementById('bk-drop').value.trim();
        if (!body.dropoff_address) { this.toast('Please enter your drop-off address.', 'error'); return; }
      }
    }
    try {
      const d = await API.post('/bookings', body);
      this.toast('Booking requested — funds held in escrow!', 'success');
      location.hash = '#/booking/' + d.booking.id;
    } catch (e) {
      if (e.status === 428 && (e.code === 'terms_required')) {
        this.toast('Please accept the Terms & Conditions first.', 'error');
        location.hash = '#/me?tab=verify';
        return;
      }
      if (e.status === 428) {
        this.toast('Complete identity verification to book.', 'error');
        location.hash = '#/verify';
        return;
      }
      if (e.status === 402) {
        // Insufficient wallet balance. Offer direct booking payment via PayMongo,
        // which credits the wallet with the booking total, then retry the booking.
        const total = this._quoteTotal;
        const usePay = await this.tryPayBooking(total, body);
        if (usePay) {
          this.toast('Payment received — wallet credited', 'success');
          // create intent failed or user chose pay path handled inside
          return;
        }
        this.toast('Insufficient wallet balance — top up to continue.', 'error');
        location.hash = '#/wallet?tab=topup';
        return;
      }
      this.toast(e.message || 'Booking failed', 'error');
    }
  },
  async tryPayBooking(total, bookBody) {
    if (!total || total <= 0) return false;
    const cfg = await API.get('/paymongo/config');
    if (!cfg.enabled) return false;
    if (!confirm(`Your wallet balance is not enough for this booking (total ${fmtMoney(total)}).\n\nPay this booking now via GCash/Maya?`)) return false;
    try {
      const intent = await API.post('/bookings/paymongo', { total, method: 'gcash' });
      if (intent.sandbox) {
        await API.post('/paymongo/confirm', { intent_id: intent.intent_id, payment_id: intent.payment_id });
        this.toast(`Booking payment received — ${fmtMoney(total)} credited to your wallet (sandbox)`, 'success');
        // retry the booking now that the wallet has balance
        try { const d = await API.post('/bookings', bookBody); this.toast('Booking requested — funds held in escrow!', 'success'); location.hash = '#/booking/' + d.booking.id; } catch (e2) { location.hash = '#/wallet'; }
        return true;
      }
      await this.runPayMongoIntent(intent, 'booking');
      // payment credited wallet -> go to wallet to complete booking
      this.state._retryBooking = bookBody;
      return true;
    } catch (e2) {
      this.toast('Booking payment failed: ' + (e2.message || 'unknown error'), 'error');
      return false;
    }
  },
  async toggleFavorite(id) {
    try { await API.post(`/listings/${id}/favorite`); this.toast('Updated favorites', 'success'); }
    catch (e) { if (e.status === 401) { location.hash = '#/login'; } else this.toast(e.message, 'error'); }
  },
  async openChat(userId, listingId) {
    location.hash = '#/messages?to=' + userId + '&listing=' + listingId;
  },

  /* ================= BOOKING DETAIL ================= */
  async viewBookingDetail(id) {
    let b;
    try { b = await API.get('/bookings/' + id); } catch (e) { this.$app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const u = this.state.user;
    const isRenter = u.id === b.renter_id;
    const isOwner = u.id === b.owner_id;
    const statusPill = `<span class="pill ${b.status}">${b.status}</span>`;
    this.$app.innerHTML = `
      <div class="wrap" style="padding-top:20px">
        <a class="back-btn" href="javascript:history.back()">← Back</a>
        <div class="grid-2-side">
          <div>
            <div class="detail-card">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <h3>Booking ${b.booking_ref}</h3>${statusPill}
              </div>
              <div style="display:flex;gap:10px;align-items:center;margin-top:14px">
                <img src="${b.listing && b.listing.images[0] ? esc(b.listing.images[0]) : '/images/svg/placeholder.svg'}" style="width:70px;height:70px;border-radius:10px;object-fit:cover">
                <div><a href="#/listing/${b.listing_id}" style="font-weight:700">${esc(b.listing ? b.listing.title : 'Item')}</a>
                <div style="font-size:13px;color:var(--ink-soft)">${fmtDate(b.start_date)} → ${fmtDate(b.end_date)} · ${b.rental_days} day${b.rental_days > 1 ? 's' : ''}</div></div>
              </div>
              <div class="price-line" style="margin-top:12px"><span>Rental fee</span><span>${fmtMoney(b.rental_fee)}</span></div>
              ${b.delivery_fee ? `<div class="price-line"><span>Delivery</span><span>${fmtMoney(b.delivery_fee)}</span></div>` : ''}
              <div class="price-line fee"><span>Platform fee</span><span>${fmtMoney(b.platform_fee)}</span></div>
              <div class="price-line deposit"><span>Security deposit</span><span>${fmtMoney(b.security_deposit)}</span></div>
              <div class="price-line total"><span>Total charged</span><span>${fmtMoney(b.total_charged)}</span></div>
              <div style="font-size:12px;color:var(--ink-soft);margin-top:8px">Owner receives ${fmtMoney(b.amount_due_owner)} after the ${fmtMoney(b.platform_fee)} platform fee.</div>
              <div style="font-size:12px;color:var(--green);background:var(--bg);padding:9px 11px;border-radius:8px;margin-top:10px">🔒 ${fmtMoney(b.total_charged)} was paid securely through GoRentHive and is held in escrow. ${b.status === 'completed' ? 'Owner funds released to their wallet.' : 'Owner funds are released only after the rental is completed and the item is returned.'}</div>
            </div>

            <div class="detail-card" style="margin-top:16px">
              <h3>Rental Agreement</h3>
              ${b.agreement ? `<div class="legal-box" style="margin-top:10px;box-shadow:none"><div class="content">${esc(b.agreement.body)}</div></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
                  ${b.agreement_signed_renter ? '<span class="pill completed">✓ Renter signed</span>' : ''}
                  ${b.agreement_signed_owner ? '<span class="pill completed">✓ Owner signed</span>' : ''}
                </div>` : '<p style="color:var(--ink-soft);font-size:13px;margin-top:8px">Agreement generated on approval.</p>'}
              ${b.status === 'approved' && (isRenter || isOwner) && !(b.agreement_signed_renter && b.agreement_signed_owner) ? `<div style="margin-top:12px"><label class="checkbox-label"><input type="checkbox" id="agree-ck"> I agree to the terms above</label>
                <button class="btn btn-primary btn-block" style="margin-top:10px" onclick="Root.signAgreement(${b.id})">Accept & Sign</button></div>` : ''}
            </div>

            ${this.conditionSection(b, isRenter, isOwner)}

            ${this.meetingSection(b, isRenter, isOwner)}

            ${b.deposit ? `<div class="detail-card" style="margin-top:16px">
              <h3>Security Deposit</h3>
              <div class="list-row" style="box-shadow:none"><div class="body"><div class="t">${fmtMoney(b.deposit.amount)}</div><div class="s">Status: <span class="pill ${b.deposit.status}">${b.deposit.status}</span></div></div></div>
            </div>` : ''}

            ${this.deliverySection(b, isRenter, isOwner)}
          </div>

          <div>
            <div class="booking-box">
              <h3>Parties</h3>
              <div class="list-row" style="box-shadow:none;padding:10px 0"><div class="avatar sm">${esc((b.owner.full_name || '?')[0])}</div><div class="body"><div class="t">Owner: ${esc(b.owner.full_name)}</div><div class="s">${b.owner.mobile_verified ? '✓ verified' : ''} ${b.owner.verificationBadge ? '<span class="verified-chip">' + esc(b.owner.verificationBadge) + '</span>' : ''} ${Root.trustChip(b.owner)}</div></div></div>
              <div class="list-row" style="box-shadow:none;padding:10px 0"><div class="avatar sm">${esc((b.renter.full_name || '?')[0])}</div><div class="body"><div class="t">Renter: ${esc(b.renter.full_name)}</div><div class="s">${b.renter.mobile_verified ? '✓ verified' : ''} ${b.renter.verificationBadge ? '<span class="verified-chip">' + esc(b.renter.verificationBadge) + '</span>' : ''} ${Root.trustChip(b.renter)}</div></div></div>
              <a class="btn btn-outline btn-block" href="#/messages?to=${isRenter ? b.owner.id : b.renter_id}&booking=${b.id}">💬 Message ${isRenter ? 'owner' : 'renter'}</a>
            </div>

            <div class="booking-box" style="margin-top:14px">
              <h3>Actions</h3>
              ${this.bookingActions(b, isRenter, isOwner)}
            </div>
          </div>
        </div>
      </div>`;
  },
  conditionSection(b, isRenter, isOwner) {
    const checkin = b.condition.find(c => c.phase === 'checkin');
    const checkout = b.condition.find(c => c.phase === 'checkout');
    const party = (isRenter || isOwner);
    const canRecord = party && (b.status === 'active' || b.status === 'approved');
    const condBlock = (c, title) => {
      if (!c) return `<div style="font-size:12px;color:var(--ink-soft);margin-top:4px">Not yet recorded</div>`;
      let photos = [];
      try { photos = JSON.parse(c.photos || '[]') || []; } catch (e) {}
      return `<div style="font-size:12px;color:var(--ink-soft);margin-top:4px">Recorded by user#${c.uploaded_by} · ${fmtDateTime(c.created_at)}</div>
        ${c.serial_number ? `<div style="font-size:12px;margin-top:2px">Serial: <b>${esc(c.serial_number)}</b></div>` : ''}
        ${c.accessories ? `<div style="font-size:12px;margin-top:2px">Accessories: ${esc(c.accessories)}</div>` : ''}
        ${c.damage_notes ? `<div style="font-size:12px;margin-top:2px;color:var(--orange)">Notes: ${esc(c.damage_notes)}</div>` : ''}
        ${photos.length ? `<div class="evidence-grid" style="margin-top:6px">${photos.map(p => `<img src="${esc(p)}">`).join('')}</div>` : ''}`;
    };
    return `<div class="detail-card" style="margin-top:16px">
      <h3>📷 Condition Documentation</h3>
      <p style="font-size:12px;color:var(--ink-soft);margin-top:4px">Photo/serial evidence captured by any party on the rental. This protects both sides in a damage dispute.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <div style="background:var(--bg);border-radius:10px;padding:12px">
          <div style="font-weight:700;font-size:13px">CHECK-IN (handover) ${checkin ? '✓' : ''}</div>
          ${condBlock(checkin)}
          ${canRecord && !checkin ? `<button class="btn btn-primary btn-sm btn-block" style="margin-top:8px" onclick="Root.checkinModal(${b.id},'checkin')">Record check-in condition</button>` : ''}
        </div>
        <div style="background:var(--bg);border-radius:10px;padding:12px">
          <div style="font-weight:700;font-size:13px">CHECK-OUT (return) ${checkout ? '✓' : ''}</div>
          ${condBlock(checkout)}
          ${canRecord && !checkout ? `<button class="btn btn-outline btn-sm btn-block" style="margin-top:8px" onclick="Root.checkinModal(${b.id},'checkout')">Record check-out condition</button>` : ''}
          ${b.status === 'active' && isOwner && checkout ? `<button class="btn btn-primary btn-sm btn-block" style="margin-top:8px" onclick="Root.completeModal(${b.id})">Complete rental</button>` : ''}
        </div>
      </div>
    </div>`;
  },
  meetingSection(b, isRenter, isOwner) {
    if (b.pickup_option !== 'public_place' || !(b.meeting_points || []).length) return '';
    const mp = b.meeting_points[0];
    const confirmed = mp.renter_confirmed && mp.owner_confirmed;
    const canConfirm = (isRenter && !mp.renter_confirmed) || (isOwner && !mp.owner_confirmed);
    return `<div class="detail-card" style="margin-top:16px">
      <h3>📍 Public Meeting Place</h3>
      <div class="price-line" style="margin-top:6px"><span>Place</span><span>${esc(mp.point_name)}</span></div>
      ${mp.point_address ? `<div class="price-line"><span>Where</span><span>${esc(mp.point_address)}</span></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <span class="pill ${mp.renter_confirmed ? 'completed' : 'pending'}">Renter ${mp.renter_confirmed ? '✓ confirmed' : 'pending'}</span>
        <span class="pill ${mp.owner_confirmed ? 'completed' : 'pending'}">Owner ${mp.owner_confirmed ? '✓ confirmed' : 'pending'}</span>
      </div>
      <p style="font-size:12px;color:var(--ink-soft);margin-top:8px">Meet at this safe public place to hand over and return the item. Both parties must confirm in-app.</p>
      ${confirmed ? `<div style="font-size:12px;color:var(--green);background:var(--bg);padding:9px 11px;border-radius:8px;margin-top:8px">✅ Meeting place confirmed by both parties.</div>` : ''}
      ${canConfirm ? `<button class="btn btn-primary btn-block" style="margin-top:12px" onclick="Root.confirmMeeting(${b.id})">✓ I confirm this meeting place</button>` : ''}
    </div>`;
  },
  async confirmMeeting(id) {
    if (!confirm('Confirm the agreed public meeting place for this handover?')) return;
    try { await API.post(`/bookings/${id}/meeting/confirm`); this.toast('Meeting place confirmed', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  vehLabel(v) { return ({ motorcycle: 'Motorcycle', car: 'Car', truck: 'Truck / Light van' }[v] || v || '—'); },
  trustChip(u) {
    if (!u || u.trust_score == null) return '';
    const level = u.trust_level || 'New';
    return `<span class="trust-chip ${level}" title="Trust score ${u.trust_score}/100 · ${u.successful_return_rate != null ? u.successful_return_rate + '% successful returns' : 'No rental history yet'}">★ ${level} ${u.trust_score}</span>`;
  },
  deliveryStatusLabel(s) { return ({ accepted: 'Driver assigned', pickup_ready: 'Pickup ready', in_transit: 'In transit', delivered: 'Delivered' }[s] || s || '—'); },
  deliverySection(b, isRenter, isOwner) {
    if (b.delivery_method !== 'lalamove') {
      return `<div class="detail-card" style="margin-top:16px">
        <h3>🚚 Delivery & Pickup</h3>
        <div class="price-line" style="margin-top:6px"><span>Method</span><span>📦 Pickup</span></div>
        <p style="font-size:12px;color:var(--ink-soft);margin-top:4px">Meet the owner to collect and return the item. Payment is still verified in-app before pickup.</p>
      </div>`;
    }
    const dispatch = (b.delivery_requests || []).find(r => r.phase === 'dispatch');
    const ret = (b.delivery_requests || []).find(r => r.phase === 'return');
    const paid = (b.payments || []).some(p => p.type === 'rental' && p.status === 'succeeded');
    const canScheduleReturn = isRenter && b.status === 'active' && !ret;
    return `<div class="detail-card" style="margin-top:16px">
      <h3>🚚 Lalamove Delivery</h3>
      <div class="price-line"><span>Method</span><span>🚚 Lalamove</span></div>
      <div class="price-line"><span>Vehicle</span><span>${this.vehLabel(b.delivery_vehicle_type)}</span></div>
      <div class="price-line"><span>Distance</span><span>${b.delivery_distance_km} km</span></div>
      <div class="price-line"><span>Drop-off</span><span>${esc(b.dropoff_address || '—')}</span></div>
      <div class="price-line"><span>Delivery fee</span><span>${fmtMoney(b.delivery_fee)}</span></div>
      <div class="price-line"><span>Proof of payment</span><span class="pill ${paid ? 'completed' : 'pending'}">${paid ? 'PAID' : 'Pending'}</span></div>
      <p style="font-size:12px;color:var(--ink-soft);margin-top:6px">Show confirmation code <b style="color:var(--ink)">${esc(b.booking_ref)}</b> to the owner/driver as proof of payment before pickup.</p>
      ${paid ? `<div style="font-size:12px;color:var(--green);background:var(--bg);padding:9px 11px;border-radius:8px;margin-top:8px">✅ Payment received in GoRentHive escrow. A driver is dispatched only after the owner approves and your payment clears.</div>` : ''}
      <div style="margin-top:8px">
        ${this.deliveryRequestCard('Dispatch', dispatch, b, isOwner)}
        ${this.deliveryRequestCard('Return', ret, b, isRenter)}
      </div>
      ${canScheduleReturn ? `<button class="btn btn-primary btn-block" style="margin-top:12px" onclick="Root.scheduleReturnDelivery(${b.id})">📦 Schedule return delivery</button>` : ''}
    </div>`;
  },
  deliveryRequestCard(label, dr, b, canUpdate) {
    if (!dr) return `<div style="background:var(--bg);border-radius:10px;padding:12px;margin-top:10px"><div style="font-weight:700;font-size:13px">${label}</div><div style="font-size:12px;color:var(--ink-soft);margin-top:4px">Not scheduled yet</div></div>`;
    const proof = dr.proof_photo ? `<img src="${esc(dr.proof_photo)}" style="width:100%;max-width:200px;border-radius:10px;margin-top:8px">` : '';
    const signed = dr.proof_signature ? `<div style="font-size:12px;margin-top:6px">Signature: <b>${esc(dr.proof_signature)}</b></div>` : '';
    return `<div style="background:var(--bg);border-radius:10px;padding:12px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700;font-size:13px">${label}</div><span class="pill ${dr.status}">${this.deliveryStatusLabel(dr.status)}</span></div>
      <div style="font-size:12px;color:var(--ink-soft);margin-top:6px">Order <b>${esc(dr.provider_order_id)}</b> · ${this.vehLabel(dr.vehicle_type)}</div>
      ${dr.driver_name ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:2px">Driver: <b>${esc(dr.driver_name)}</b>${dr.driver_phone ? ' (' + esc(dr.driver_phone) + ')' : ''}</div>` : ''}
      ${dr.tracking_url ? `<a class="btn btn-outline btn-sm" style="margin-top:8px" href="${esc(dr.tracking_url)}" target="_blank" rel="noopener">🔗 Track delivery</a>` : ''}
      ${dr.proof_photo || dr.proof_signature ? `<div style="margin-top:8px">${proof}${signed}<div style="font-size:11px;color:var(--green);margin-top:4px">✓ Proof of delivery captured</div></div>` : ''}
      ${canUpdate && b.status !== 'completed' ? `<div style="margin-top:8px">${['pickup_ready', 'in_transit'].map(s => `<button class="btn btn-outline btn-sm" style="margin-right:4px;margin-top:4px" onclick="Root.updateDeliveryStatus(${b.id},'${dr.phase}','${s}')">${this.deliveryStatusLabel(s)}</button>`).join('')}
        <button class="btn btn-primary btn-sm" style="margin-top:4px" onclick="Root.deliveryProofModal(${b.id},'${dr.phase}')">📸 Deliver & attach proof</button>
      </div>` : ''}
    </div>`;
  },
  deliveryProofModal(id, phase) {
    this.modal(`Capture Proof of Delivery
      <p style="font-size:12px;color:var(--ink-soft);margin-top:2px">Attach a photo and the recipient's signature when the item is handed over / delivered. This is required before escrowed funds are released for Lalamove returns.</p>
      <div class="form-row"><label>Proof photo</label><input type="file" accept="image/*" id="dp-photo"></div>
      <div class="form-row"><label>Recipient signature</label><input id="dp-sign" placeholder="Type the recipient's name as signature"></div>
      <div class="sign-zone">✍️ Signed electronically in-app</div>
      <button class="btn btn-primary btn-block" onclick="Root.submitDeliveryProof(${id},'${phase}')">Confirm delivered</button>`, 'close');
  },
  async submitDeliveryProof(id, phase) {
    let proofPhoto = '';
    const fileEl = document.getElementById('dp-photo');
    if (fileEl && fileEl.files.length) {
      const fd = new FormData();
      [...fileEl.files].forEach(f => fd.append('files', f));
      const up = await fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
      proofPhoto = (up.urls || [])[0] || '';
    }
    const signature = (document.getElementById('dp-sign') || {}).value || '';
    if (!proofPhoto) { this.toast('A proof-of-delivery photo is required', 'warn'); return; }
    try {
      await API.post(`/bookings/${id}/delivery/${phase}/status`, { status: 'delivered', proof_photo: proofPhoto, proof_signature: signature });
      this.toast('Delivery confirmed with proof', 'success'); this.closeModal(); location.reload();
    } catch (e) { this.toast(e.message, 'error'); }
  },
  async scheduleReturnDelivery(id) {
    if (!confirm('Schedule a Lalamove driver to pick up the returned item from your address?')) return;
    try { await API.post(`/bookings/${id}/delivery/return`); this.toast('Return delivery scheduled', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async updateDeliveryStatus(id, phase, status) {
    try { await API.post(`/bookings/${id}/delivery/${phase}/status`, { status }); this.toast('Delivery status updated', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  bookingActions(b, isRenter, isOwner) {
    const actions = [];
    if (b.status === 'pending' && isOwner) {
      actions.push(`<button class="btn btn-green btn-block" onclick="Root.approve(${b.id})">Approve booking</button>`);
      actions.push(`<button class="btn btn-outline btn-block" style="margin-top:8px" onclick="Root.reject(${b.id})">Reject</button>`);
    }
    if (['pending', 'approved'].includes(b.status) && isRenter) {
      actions.push(`<button class="btn btn-outline btn-block" style="margin-top:8px" onclick="Root.cancelBooking(${b.id})">Cancel booking</button>`);
    }
    if (['pending', 'approved', 'active'].includes(b.status) && (isRenter || isOwner)) {
      actions.push(`<button class="btn btn-outline btn-block" style="margin-top:8px" onclick="Root.openDispute(${b.id})">⚠️ Report a problem</button>`);
    }
    if (b.status === 'returned' && isRenter) {
      const ded = b.return_proposed_deduction >= 0 ? fmtMoney(b.return_proposed_deduction) : fmtMoney(0);
      actions.push(`<div class="ret-box" style="background:var(--bg);padding:10px;border-radius:10px;font-size:12.5px;color:var(--ink-soft);margin-bottom:8px">
        Owner reports damage and proposes a deposit deduction of <b>${ded}</b>${b.return_proposed_reason ? ' — ' + esc(b.return_proposed_reason) : ''}. Review the return condition before choosing.
      </div>`);
      actions.push(`<button class="btn btn-green btn-block" onclick="Root.acceptReturn(${b.id})">✅ Accept deduction</button>`);
      actions.push(`<button class="btn btn-outline btn-block" style="margin-top:8px" onclick="Root.disputeReturn(${b.id})">🚩 Dispute deduction</button>`);
    }
    if (b.status === 'disputed' && (isRenter || isOwner)) {
      actions.push(`<p class="alt">🚩 This booking is under review. Escrowed funds are frozen until admin resolves the dispute.</p>`);
    }
    if (b.status === 'completed' && (isRenter || isOwner)) {
      const other = isRenter ? 'owner' : 'renter';
      actions.push(`<button class="btn btn-outline btn-block" onclick="Root.rateOtherParty(${b.id}, '${isRenter ? b.owner.id : b.renter_id}')">⭐ Rate the ${other}</button>`);
    }
    if (!actions.length) actions.push(`<p class="alt">No actions available for this booking.</p>`);
    return actions.join('');
  },
  rateOtherParty(bookingId, otherUserId) {
    this.modal(`Rate this ${otherUserId ? 'renter' : 'owner'}
      <div class="form-row"><label>Your rating</label>
        <div class="star-picker" id="rv-stars">
          ${[1,2,3,4,5].map(n => `<button class="star" data-v="${n}" onclick="Root.setReviewStar(${n})">★</button>`).join('')}
        </div></div>
      <div class="form-row"><label>Comment (optional)</label><textarea id="rv-comment" placeholder="Share how the rental went"></textarea></div>
      <button class="btn btn-primary btn-block" onclick="Root.submitReview(${bookingId}, '${otherUserId}')">Submit rating</button>`, 'close');
  },
  async setReviewStar(n) {
    const el = document.getElementById('rv-stars');
    if (!el) return;
    el.querySelectorAll('.star').forEach(btn => btn.classList.toggle('on', parseInt(btn.dataset.v, 10) <= n));
    el.dataset.rating = n;
  },
  async submitReview(bookingId, targetUserId) {
    const e = document.getElementById('rv-stars');
    const rating = e && e.dataset.rating ? parseInt(e.dataset.rating, 10) : 5;
    const comment = (document.getElementById('rv-comment') || {}).value || '';
    try {
      const key = 'rh-reviewed-' + bookingId;
      if (localStorage.getItem(key)) { this.toast('You already rated this booking on this device', 'warn'); return; }
      await API.post('/reviews', { booking_id: bookingId, rating, comment, target_user_id: targetUserId });
      localStorage.setItem(key, '1');
      this.toast('Rating submitted', 'success'); this.closeModal();
    } catch (err) { this.toast(err.message, 'error'); }
  },
  async acceptReturn(id) {
    if (!confirm('Accept the owner\'s deposit deduction? The remainder of your deposit will be released to your wallet.')) return;
    try { await API.post(`/bookings/${id}/resolve-return`, { accept: true }); this.toast('Deduction accepted. Deposit released.', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async disputeReturn(id) {
    if (!confirm('Dispute the deposit deduction? Funds will be frozen for admin review.')) return;
    try { await API.post(`/bookings/${id}/resolve-return`, { accept: false }); this.toast('Dispute opened — under admin review', 'warn'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async approve(id) {
    if (!confirm('Approve this booking request?')) return;
    try { await API.post(`/bookings/${id}/approve`); this.toast('Booking approved', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async reject(id) {
    const reason = prompt('Reason for rejection:') || 'Owner declined';
    try { await API.post(`/bookings/${id}/reject`, { reason }); this.toast('Booking rejected', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async signAgreement(id) {
    const ck = document.getElementById('agree-ck');
    if (ck && !ck.checked) { this.toast('Please accept the terms first', 'warn'); return; }
    try { await API.post(`/bookings/${id}/sign-agreement`); this.toast('Signed', 'success'); this.viewBookingDetail(id); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async cancelBooking(id) {
    const reason = prompt('Reason for cancelling (optional):') || '';
    if (!confirm('Cancel this booking?')) return;
    try { await API.post(`/bookings/${id}/cancel`, { reason }); this.toast('Booking cancelled', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  checkinModal(id, phase) {
    const label = phase === 'checkout' ? 'Check-Out (Return)' : 'Check-In (Handover)';
    this.modal(`Record ${label} Condition
      <p style="font-size:12px;color:var(--ink-soft);margin-top:2px">${phase === 'checkout' ? 'Document the condition as the item is returned.' : 'Document the condition as the item is handed over.'} Photo evidence is stored and reviewable by both parties and GoRentHive.</p>
      <div class="form-row"><label>Photos</label><input type="file" accept="image/*" multiple id="ck-files"></div>
      <div class="form-row"><label>Serial number</label><input id="ck-serial" placeholder="Serial number"></div>
      <div class="form-row"><label>Accessories included</label><input id="ck-acc" placeholder="Battery, charger, strap"></div>
      <div class="form-row"><label>Damage / wear notes</label><textarea id="ck-damage" placeholder="Describe any existing damage"></textarea></div>
      <button class="btn btn-primary btn-block" onclick="Root.saveCondition(${id},'${phase}')">Confirm condition</button>`, 'close');
  },
  async saveCondition(id, phase) {
    let photos = [];
    const files = document.getElementById('ck-files').files;
    if (files.length) {
      const fd = new FormData();
      [...files].forEach(f => fd.append('files', f));
      const up = await fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
      photos = up.urls || [];
    }
    const serial = document.getElementById('ck-serial').value;
    const acc = document.getElementById('ck-acc').value;
    const damage = document.getElementById('ck-damage').value;
    try { await API.post(`/bookings/${id}/condition`, { phase, photos, serial_number: serial, accessories: acc, damage_notes: damage }); this.toast('Condition recorded', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  completeModal(id) {
    this.modal(`Complete Rental & Return
      <p style="font-size:12.5px;color:var(--ink-soft);margin-top:4px">Record the check-out condition <b>before</b> completing. If you propose a damage deduction, it goes to the renter for approval (or admin review if disputed) — funds aren't released on one side alone.</p>
      <div class="form-row"><label>Damage deduction from deposit (₱)</label><input id="cp-damage" type="number" min="0" value="0"></div>
      <div class="form-row"><label>Late-return fee (₱)</label><input id="cp-late" type="number" min="0" value="0"></div>
      <div class="form-row"><label>Reason for deduction (if any)</label><textarea id="cp-note" placeholder="Describe damage found on return"></textarea></div>
      ${this.lastBookingHasCheckout(id) ? '' : '<p style="font-size:11.5px;color:var(--orange);margin-top:6px">⚠️ You must record the check-out condition first.</p>'}
      <button class="btn btn-primary btn-block" onclick="Root.complete(${id})">Confirm return & complete</button>`, 'close');
  },
  lastBookingHasCheckout(id) { return true; },
  async complete(id) {
    const damageDeduction = parseInt(document.getElementById('cp-damage').value || '0', 10);
    const lateFees = parseInt(document.getElementById('cp-late').value || '0', 10);
    const condition = document.getElementById('cp-note').value;
    if (!confirm('Confirm the return? ' + (damageDeduction > 0 ? 'This proposes a deposit deduction for the renter to review.' : 'Funds will be released to the owner and deposit to the renter.'))) return;
    try { await API.post(`/bookings/${id}/complete`, { damageDeduction, lateFees, reason: condition }); this.toast(damageDeduction > 0 ? 'Return submitted — awaiting renter approval' : 'Rental completed', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  openDispute(id) {
    this.modal(`Report a Problem
      <div class="form-row"><label>Category</label><select id="dp-cat">
        <option>Item not received</option><option>Item damaged</option><option>Wrong item</option><option>Missing accessories</option>
        <option>Late return</option><option>Owner cancelled</option><option>Renter cancelled</option><option>Payment problem</option>
        <option>Deposit problem</option><option>Fraud concern</option><option>Other</option></select></div>
      <div class="form-row"><label>Description</label><textarea id="dp-desc" placeholder="Explain what happened"></textarea></div>
      <button class="btn btn-primary btn-block" onclick="Root.fileDispute(${id})">Submit report</button>`, 'close');
  },
  async fileDispute(id) {
    const cat = document.getElementById('dp-cat').value;
    const desc = document.getElementById('dp-desc').value;
    try { await API.post(`/admin/bookings/${id}/dispute`, { category: cat, description: desc }); this.toast('Dispute reported', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },

  /* ================= LIST FORM ================= */
  async viewListForm(editId) {
    let l = null;
    if (editId) l = await API.get('/listings/' + editId);
    this.state.currentListing = l;
    this.$app.innerHTML = `<div class="wrap"><section class="section" style="padding-top:24px">
      <div class="form-card wide">
        <div class="form-title">${editId ? 'Edit your item' : 'List an item & start earning'}</div>
        <p class="form-sub">"Turn your unused things into income." Fill in the details below.</p>
        <div class="form-row"><label>Item title *</label><input id="li-title" value="${esc(l ? l.title : '')}" placeholder="e.g. Canon EOS 90D DSLR Camera"></div>
        <div class="form-grid2">
          <div class="form-row"><label>Category *</label><select id="li-cat">${this.state.categories.map(c => `<option value="${c.id}" ${l && l.category && l.category.id === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></div>
          <div class="form-row"><label>City / Location *</label><input id="li-city" value="${esc(l ? l.location_city : '')}" placeholder="e.g. General Trias"></div>
        </div>
        <div class="form-grid2">
          <div class="form-row"><label>Rental price per day (₱) *</label><input id="li-price" type="number" min="0" value="${l ? l.price_per_day : ''}" placeholder="500"></div>
          <div class="form-row"><label>Estimated item value (₱) *</label><input id="li-val" type="number" min="1" value="${l ? l.estimated_value : ''}" placeholder="e.g. 12000" oninput="Root.previewTier()"></div>
        </div>
        <div class="form-row">
          <label>Deposit tier</label>
          <div class="tier-picker">
            ${['low','medium','high'].map(t => `<label class="tier-card ${l && l.deposit_tier === t ? 'on' : ''}" data-tier="${t}">
              <input type="radio" name="li-dep-tier" value="${t}" ${l && l.deposit_tier === t ? 'checked' : ''} onchange="Root.pickTier('${t}')">
              <span class="tier-name">${Root.TIER_META[t].label}</span>
              <span class="tier-band">${Root.TIER_META[t].band}</span>
              <span class="tier-dep">₱${Root.TIER_META[t].deposit}</span>
            </label>`).join('')}
          </div>
          <p id="li-tier-hint" style="font-size:12px;color:var(--ink-soft);margin-top:8px">Deposit is set by your item tier — a lower value means a smaller, more renter-friendly deposit.</p>
        </div>
        <div class="form-row"><label>Security deposit to be held (₱, read-only)</label><input id="li-dep" type="number" min="0" readonly value="${l ? l.security_deposit : ''}" placeholder="Auto-based on tier"></div>
        <div class="form-row"><label>Description</label><textarea id="li-desc" placeholder="Describe your item, its condition, and what makes it great for renters">${esc(l ? l.description : '')}</textarea></div>
        <div class="form-grid2">
          <div class="form-row"><label>Condition</label><input id="li-cond" value="${esc(l ? l.condition : '')}" placeholder="e.g. Good, minimal wear"></div>
          <div class="form-row"><label>Accessories included</label><input id="li-acc" value="${esc(l ? l.accessories : '')}" placeholder="e.g. Battery, charger, strap"></div>
        </div>
        <div class="form-row"><label>Serial number (optional)</label><input id="li-serial" value="${esc(l ? l.serial_number : '')}" placeholder="e.g. SN-12345 — used to verify the exact unit on handover/return"></div>
        <div class="form-row"><label>Rules</label><input id="li-rules" value="${esc(l ? l.rules : '')}" placeholder="e.g. No smoking, return on time"></div>
        <div class="form-grid2">
          <div class="form-row"><label>Minimum verification level</label><select id="li-min"><option value="2">2 (Phone)</option><option value="3">3 (ID)</option><option value="4">4 (Enhanced)</option></select></div>
          <div class="form-row"><label>Cancellation policy</label><select id="li-cancel"><option value="standard">Standard</option><option value="flexible">Flexible</option><option value="strict">Strict</option></select></div>
        </div>
        <div class="form-row"><label>Delivery</label>
          <div style="display:flex;gap:14px;flex-wrap:wrap">
            <label class="checkbox-label"><input type="radio" name="li-del" value="0" ${l && !l.delivery_available ? 'checked' : ''}> Pickup only</label>
            <label class="checkbox-label"><input type="radio" name="li-del" value="1" ${l && l.delivery_available ? 'checked' : ''}> Offer delivery</label>
          </div>
        </div>
        <div class="form-row"><label>Delivery fee (₱)</label><input id="li-del-fee" type="number" min="0" value="${l ? l.delivery_fee : 50}"></div>
        <div class="form-row"><label>Photos</label><input type="file" accept="image/*" multiple id="li-files"><div id="li-photos" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${(l && l.images || []).map(i => `<img src="${esc(i)}" style="width:70px;height:70px;border-radius:10px;object-fit:cover">`).join('')}</div></div>
        <button class="btn btn-primary btn-block btn-lg" onclick="Root.saveListing('${editId || ''}')">${editId ? 'Save changes' : 'Publish listing →'}</button>
      </div>
    </section></div>`;
  },
  async saveListing(editId) {
    let photos = editId ? [...(this.state.currentListing?.images || [])] : [];
    const files = document.getElementById('li-files').files;
    if (files.length) {
      const fd = new FormData();
      [...files].forEach(f => fd.append('files', f));
      const token = await window.__getAccessToken();
      const response = await fetch('/api/upload', { method: 'POST', body: fd, headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
      const up = await response.json();
      if (!response.ok) throw new Error(up.error || 'Photo upload failed');
      photos.push(...(up.urls || []));
    }
    const delVal = document.querySelector('input[name="li-del"]:checked');
    const body = {
      title: document.getElementById('li-title').value.trim(),
      category_id: parseInt(document.getElementById('li-cat').value, 10),
      location_city: document.getElementById('li-city').value.trim(),
      price_per_day: parseInt(document.getElementById('li-price').value, 10),
      estimated_value: parseInt(document.getElementById('li-val').value || '0', 10),
      deposit_tier: (document.querySelector('input[name="li-dep-tier"]:checked') || {}).value || this._recTier(document.getElementById('li-val').value),
      description: document.getElementById('li-desc').value,
      condition: document.getElementById('li-cond').value,
      accessories: document.getElementById('li-acc').value,
      serial_number: document.getElementById('li-serial').value,
      rules: document.getElementById('li-rules').value,
      min_verification_level: parseInt(document.getElementById('li-min').value, 10),
      cancellation_policy: document.getElementById('li-cancel').value,
      delivery_available: delVal && delVal.value === '1',
      delivery_fee: parseInt(document.getElementById('li-del-fee').value || '0', 10),
      pickup_available: true,
      images: photos,
    };
    if (!body.title || !body.price_per_day || !body.location_city) { this.toast('Title, price and city are required', 'error'); return; }
    try {
      if (editId) { await API.put('/listings/' + editId, body); this.toast('Listing updated', 'success'); }
      else { await API.post('/listings', body); this.toast('Listing published!', 'success'); }
      location.hash = '#/owner';
    } catch (e) { this.toast(e.message, 'error'); }
  },

  /* ---------- Deposit tier picker ---------- */
  TIER_META: {
    low: { deposit: 300, label: 'Low', band: 'Up to ₱3,000' },
    medium: { deposit: 1000, label: 'Medium', band: '₱3,001 – ₱15,000' },
    high: { deposit: 3500, label: 'High', band: 'Over ₱15,000' },
  },
  _recTier(value) {
    const v = parseInt(value || '0', 10);
    if (v <= 3000) return 'low';
    if (v <= 15000) return 'medium';
    return 'high';
  },
  pickTier(t) {
    document.querySelectorAll('.tier-card').forEach((c) => c.classList.toggle('on', c.dataset.tier === t));
    document.getElementById('li-dep').value = this.TIER_META[t].deposit;
    const r = this._recTier(document.getElementById('li-val').value);
    document.getElementById('li-tier-hint').textContent = t === r
      ? `Matches this item's value. Deposit held in escrow: ₱${this.TIER_META[t].deposit}.`
      : `Deposit tier does not match this item's value (recommended: ${this.TIER_META[r].label} — ₱${this.TIER_META[r].deposit}). Please adjust the item value or tier.`;
  },
  previewTier() {
    const v = parseInt(document.getElementById('li-val').value || '0', 10);
    if (!v || v < 1) {
      document.getElementById('li-tier-hint').textContent = 'Enter the item’s estimated replacement value first.';
      return;
    }
    const t = this._recTier(v);
    document.querySelector(`input[name="li-dep-tier"][value="${t}"]`).checked = true;
    document.querySelectorAll('.tier-card').forEach((c) => c.classList.toggle('on', c.dataset.tier === t));
    document.getElementById('li-dep').value = this.TIER_META[t].deposit;
    document.getElementById('li-tier-hint').textContent = `Recommended tier for this value: ${this.TIER_META[t].label} — deposit ₱${this.TIER_META[t].deposit} held in escrow.`;
  },

  /* ================= OWNER DASHBOARD ================= */
  async viewOwnerDashboard() {
    const bookings = await API.get('/bookings/mine/owner');
    const listings = await API.get('/listings?owner=' + this.state.user.id);
    const wallet = await API.get('/wallet');
    const active = bookings.filter(b => ['pending', 'approved', 'active'].includes(b.status));
    const completed = bookings.filter(b => b.status === 'completed');
    const thisMonthStart = new Date(); thisMonthStart.setDate(1); thisMonthStart.setHours(0,0,0,0);
    const monthCompleted = completed.filter(b => b.created_at >= thisMonthStart.getTime());
    const monthEarn = monthCompleted.reduce((s, b) => s + b.amount_due_owner, 0);
    const totalEarn = completed.reduce((s, b) => s + b.amount_due_owner, 0);
    const pendingRequests = bookings.filter(b => b.status === 'pending');

    const topEarners = Object.values(bookings.filter(b => b.status === 'completed').reduce((acc, b) => {
      const k = b.listing_id;
      if (!acc[k]) acc[k] = { title: b.listing ? b.listing.title : 'Item', amt: 0, count: 0, img: b.listing && b.listing.images[0] };
      acc[k].amt += b.amount_due_owner; acc[k].count++;
      return acc;
    }, {})).sort((a, b) => b.amt - a.amt).slice(0, 5);

    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="grid-2-side" style="margin-top:0">
        <div>
          <div class="earn-hero">
            <div class="lbl">YOUR RENTAL INCOME · THIS MONTH</div>
            <div class="amt">${fmtMoney(monthEarn)}</div>
            <div style="opacity:.9;font-size:13px;margin-top:6px">All time: ${fmtMoney(totalEarn)} · ${completed.length} completed rentals</div>
          </div>
          <div class="stat-grid" style="margin-top:16px">
            ${this.statCard('📦', listings.length, 'Items Listed')}
            ${this.statCard('🔄', active.length, 'Active Rentals')}
            ${this.statCard('✅', completed.length, 'Completed')}
            ${this.statCard('⏳', pendingRequests.length, 'Pending Requests')}
          </div>

          <div class="detail-card" style="margin-top:16px">
            <h3>Top Earning Items</h3>
            <div class="top-earn" style="margin-top:10px">
              ${topEarners.length ? topEarners.map(te => `<div class="top-earn-item">
                <img src="${esc(te.img || '/images/svg/placeholder.svg')}" style="width:44px;height:44px;border-radius:10px;object-fit:cover">
                <div class="grow"><div class="t">${esc(te.title)}</div><div class="s" style="font-size:12px;color:var(--ink-soft)">${te.count} rental${te.count > 1 ? 's' : ''}</div></div>
                <div class="amt">${fmtMoney(te.amt)}</div>
              </div>`).join('') : '<p style="color:var(--ink-soft)">Complete rentals to see your top earners.</p>'}
            </div>
            <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="location.hash='#/list'">+ ADD ANOTHER ITEM</button>
          </div>

          <div class="detail-card" style="margin-top:16px">
            <h3>Incoming Requests</h3>
            ${pendingRequests.map(b => `<div class="list-row">
              <img src="${b.listing && b.listing.images[0] ? esc(b.listing.images[0]) : '/images/svg/placeholder.svg'}" style="width:48px;height:48px;border-radius:9px;object-fit:cover">
              <div class="body"><div class="t">${esc(b.renter.full_name)} wants ${esc(b.listing ? b.listing.title : 'your item')}</div>
              <div class="s">${fmtDate(b.start_date)} → ${fmtDate(b.end_date)} · ${fmtMoney(b.rental_fee)}</div></div>
              <a class="btn btn-sm btn-dark" href="#/booking/${b.id}">Review</a>
            </div>`).join('') || '<p style="color:var(--ink-soft);font-size:13px">No pending requests.</p>'}
          </div>
        </div>

        <div>
          <div class="booking-box">
            <h3>Your Listings</h3>
            ${listings.map(l => `<a class="list-row" href="#/listing/${l.id}" style="cursor:pointer">
              <img src="${l.images && l.images[0] ? esc(l.images[0]) : '/images/svg/placeholder.svg'}" style="width:48px;height:48px;border-radius:9px;object-fit:cover">
              <div class="body"><div class="t">${esc(l.title)}</div><div class="s">${fmtMoney(l.price_per_day)}/day · ${l.rental_count} rentals</div></div>
              <span class="pill ${l.status}">${l.status}</span>
            </a>`).join('') || '<p style="color:var(--ink-soft);font-size:13px;margin-top:10px">You haven\'t listed anything yet.</p>'}
            <button class="btn btn-outline btn-block" style="margin-top:12px" onclick="location.hash='#/list'">+ List an item</button>
          </div>

          <div class="booking-box" style="margin-top:14px">
            <h3>Wallet</h3>
            <div class="detail-price-big" style="color:var(--green)">${fmtMoney(wallet.balance)}</div>
            <a class="btn btn-outline btn-block" href="#/wallet">View wallet</a>
          </div>

          <div class="booking-box" style="margin-top:14px">
            <h3>Promote a listing</h3>
            <p style="font-size:13px;color:var(--ink-soft);margin-top:6px">Featured listings rank higher in search with the 🔥 FEATURED badge.</p>
            <div style="margin-top:10px">${listings.map(l => `<a class="btn btn-outline btn-sm btn-block" style="margin-bottom:6px" href="#/listing/${l.id}">Promote: ${esc(l.title)}</a>`).join('') || ''}</div>
          </div>
        </div>
      </div>
    </div>`;
  },
  statCard(ic, v, l) { return `<div class="stat-card"><div class="ic">${ic}</div><div class="v">${v}</div><div class="l">${l}</div></div>`; },

  /* ================= MESSAGES ================= */
  async viewMessages() {
    const query = this.state.params.query;
    const convs = await API.get('/messages');
    const to = query.to ? parseInt(query.to, 10) : null;
    const booking = query.booking ? parseInt(query.booking, 10) : null;
    let threadHtml = `<div class="empty"><div class="em">💬</div><h3>Select a conversation</h3><p>Message owners or renters about your bookings.</p></div>`;
    let selectedOther = null;
    if (to) {
      const t = await API.get('/messages/' + to + (booking ? '?booking_id=' + booking : ''));
      selectedOther = t.other;
      threadHtml = this.chatThread(t.messages, t.other, booking);
    }
    this.$app.innerHTML = `<div class="wrap" style="padding-top:20px">
      <div class="grid-2-side" style="margin-top:0">
        <div class="detail-card">
          <h3>Messages ${this.state.unread ? `<span class="notif-dot" style="position:static;display:inline-grid;vertical-align:middle">${this.state.unread}</span>` : ''}</h3>
          <div style="margin-top:12px">${convs.map(c => `
            <a class="list-row" href="#/messages?to=${c.other_id}${c.booking_id ? '&booking=' + c.booking_id : ''}" style="cursor:pointer;${to === c.other_id ? 'border-color:var(--brand);background:var(--brand-soft)' : ''}">
              <div class="avatar sm">${esc((c.other.full_name || '?')[0])}</div>
              <div class="body"><div class="t">${esc(c.other.full_name)} ${c.unread ? `<span class="notif-dot" style="position:static;display:inline-grid;vertical-align:middle">${c.unread}</span>` : ''}</div>
              <div class="s">${esc(c.prev || '')}</div></div>
              <div style="font-size:11px;color:var(--ink-soft)">${timeAgo(c.last_time)}</div>
            </a>`).join('') || '<p style="color:var(--ink-soft);font-size:13px">No conversations yet.</p>'}
          </div>
        </div>
        <div class="booking-box">
          ${to ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div class="avatar">${esc((selectedOther.full_name || '?')[0])}</div><b>${esc(selectedOther.full_name)}</b></div>` : ''}
          ${to ? threadHtml : ''}
        </div>
      </div>
    </div>`;
  },
  chatThread(messages, other, bookingId) {
    return `<div class="chat-safe" style="font-size:12px;padding:8px 10px;border-radius:8px;background:#fff7ed;color:#9a5b00;margin-bottom:8px">
      🔒 For safety, contact details &amp; payments stay inside GoRentHive. Sharing phone numbers, GCash/Maya or social handles before a booking is confirmed is blocked.
    </div>
    <div class="chat-thread" id="thread" style="max-height:380px;overflow-y:auto">
      ${messages.map(m => `<div class="msg ${m.sender_id === Root.state.user.id ? 'me' : 'them'}">
        ${esc(m.body)}
        ${m.warning ? `<span class="warn">⚠️ ${esc(m.warning)}</span>` : ''}
        <span class="time">${timeAgo(m.created_at)}</span>
      </div>`).join('') || '<p style="color:var(--ink-soft);font-size:13px;text-align:center">No messages yet. Say hello!</p>'}
    </div>
    <div class="chat-input">
      <input id="chat-in" placeholder="Type a message..." onkeydown="if(event.key==='Enter')Root.sendChat('${other.id}',${bookingId || 'null'})">
      <button onclick="Root.sendChat('${other.id}',${bookingId || 'null'})">Send</button>
    </div>`;
  },
  async sendChat(receiverId, bookingId) {
    const input = document.getElementById('chat-in');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const r = await API.post('/messages', { receiver_id: receiverId, body: text, booking_id: bookingId });
      if (r.warning) this.toast(r.warning, 'warn', 3500);
      location.reload();
    } catch (e) { this.toast(e.message, 'error'); }
  },

  /* ================= FAVORITES ================= */
  async viewFavorites() {
    const listings = await API.get('/listings');
    // favorites not directly exposed; approximate via a my-favorites endpoint. For MVP show all favorite_count
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px"><div class="detail-card">
      <h3>Favorites</h3><p style="color:var(--ink-soft);font-size:13px;margin-top:6px">Items you've liked across the marketplace.</p>
      <div class="card-grid" style="margin-top:14px">${listings.filter(l => l.favorite_count > 0).map(l => this.listingCard(l)).join('') || '<div class="empty">No favorites yet.</div>'}</div>
    </div></div>`;
  },

  /* ================= WALLET ================= */
  async viewWallet() {
    const w = await API.get('/wallet');
    let cfg = { enabled: false };
    try { cfg = await API.get('/paymongo/config'); } catch (e) {}
    const gatewayNote = cfg.enabled
      ? 'PayMongo active — payments are processed via GCash/Maya. You will be redirected to complete payment.'
      : 'Sandbox gateway active — no real money is moved in the demo.';
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="detail-card">
        <h3>Wallet</h3>
        <div class="detail-price-big" style="color:var(--green)">${fmtMoney(w.balance)}</div>
        <p style="font-size:13px;color:var(--ink-soft)">Available balance. Top up to pay for rentals through GoRentHive's secure escrow.</p>
        <div class="form-row" style="margin-top:14px"><label>Top-up amount (₱)</label><input id="tp-amt" type="number" min="50" value="1000"></div>
        <div class="form-row"><label>Via</label><select id="tp-method"><option>GCash</option><option>Maya</option></select></div>
        <button class="btn btn-green btn-block" onclick="Root.topUp()">💳 Top up wallet</button>
        <p style="font-size:11px;color:var(--ink-soft);margin-top:8px">${gatewayNote}</p>
      </div>
      <div class="grid-2-side" style="margin-top:16px">
        <div class="detail-card">
          <h3>Withdraw Earnings</h3>
          <p style="font-size:12.5px;color:var(--ink-soft)">Owners withdraw earnings to bank, GCash or Maya.</p>
          <div class="form-row" style="margin-top:14px"><label>Amount (₱)</label><input id="wd-amt" type="number" min="0" value="${w.balance}"></div>
          <div class="form-row"><label>Method</label><select id="wd-method" onchange="Root.toggleBankField()"><option>GCash</option><option>Maya</option><option>Bank transfer</option></select></div>
          <div class="form-row"><label>Account holder name</label><input id="wd-name" placeholder="Full name on the account"></div>
          <div class="form-row"><label>Account number</label><input id="wd-acct" placeholder="GCash / Maya / bank account number"></div>
          <div class="form-row" id="wd-bank-row" style="display:none"><label>Bank name</label><input id="wd-bank" placeholder="e.g. BDO, BPI, GCash (bank transfer)"></div>
          <button class="btn btn-primary btn-block" onclick="Root.withdraw()">Request withdrawal</button>
          <p style="font-size:11px;color:var(--ink-soft);margin-top:8px">Your payout details are sent to the admin for manual remittance. Never share your details outside GoRentHive.</p>
        </div>
        <div class="detail-card">
          <h3>↩️ Refund Preference</h3>
          <p style="font-size:12.5px;color:var(--ink-soft)">Set where your deposit / refunds should be sent if they cannot go back to your wallet.</p>
          <div class="form-row" style="margin-top:14px"><label>Method</label><select id="pp-method"><option>GCash</option><option>Maya</option><option>Bank transfer</option></select></div>
          <div class="form-row"><label>Account holder name</label><input id="pp-name" placeholder="Full name on the account"></div>
          <div class="form-row"><label>Account number</label><input id="pp-acct" placeholder="GCash / Maya / bank account number"></div>
          <button class="btn btn-outline btn-block" onclick="Root.saveRefundPreference()">Save refund preference</button>
        </div>
        <div class="detail-card">
          <h3>Transaction History</h3>
          <div style="margin-top:10px">${w.entries.map(e => `<div class="list-row" style="box-shadow:none">
            <div class="body"><div class="t">${esc(this.ledgerLabel(e.type))}</div><div class="s">${fmtDateTime(e.created_at)}</div></div>
            <div style="font-weight:800;${e.amount >= 0 ? 'color:var(--green)' : 'color:var(--red)'}">${e.amount >= 0 ? '+' : ''}${fmtMoney(e.amount)}</div>
          </div>`).join('') || '<p style="color:var(--ink-soft);font-size:13px">No transactions yet.</p>'}
          </div>
        </div>
      </div>
    </div>`;
  },
  ledgerLabel(t) {
    const m = {
      owner_earning: '💰 Owner earnings', deposit: '🔄 Deposit release', referral: '🎁 Referral reward', refund: '↩️ Refund', penalty: '⚠️ Late fee', payout: '💸 Payout', deposit_deduction: 'Damage deduction',
      topup: '💳 Wallet top-up', promotion: '🔥 Promotion fee', rental_escrow: '🔒 Rental escrow (held)', deposit_escrow: '🔒 Deposit escrow (held)',
    };
    return m[t] || t;
  },
  async topUp() {
    const amount = parseInt(document.getElementById('tp-amt').value, 10);
    const method = document.getElementById('tp-method').value;
    if (!amount || amount < 50) { this.toast('Enter an amount of at least ₱50', 'error'); return; }
    try {
      const cfg = await API.get('/paymongo/config');
      if (cfg.enabled) {
        const intent = await API.post('/wallet/paymongo/topup', { amount, method });
        if (intent.sandbox) {
          await API.post('/paymongo/confirm', { intent_id: intent.intent_id, payment_id: intent.payment_id });
          this.toast(`Topped up ${fmtMoney(amount)} (sandbox)`, 'success');
          location.hash = '#/wallet';
          return;
        }
        await this.runPayMongoIntent(intent, 'topup');
        return;
      }
      // Payment gateway not configured — block free/instant top-up
      this.toast('Wallet top-up is unavailable: payment gateway is not configured yet.', 'error');
      return;
    }
    catch (e) { this.toast(e.message, 'error'); }
  },
  toggleBankField() {
    const m = document.getElementById('wd-method');
    const row = document.getElementById('wd-bank-row');
    if (row) row.style.display = (m && m.value === 'Bank transfer') ? 'block' : 'none';
  },
  async withdraw() {
    const amount = parseInt(document.getElementById('wd-amt').value, 10);
    const method = document.getElementById('wd-method').value;
    const account = document.getElementById('wd-acct').value;
    const account_name = document.getElementById('wd-name').value;
    const bank_name = document.getElementById('wd-bank') ? document.getElementById('wd-bank').value : '';
    if (!account_name) { this.toast('Please enter the account holder name', 'error'); return; }
    try { await API.post('/wallet/withdraw', { amount, method, account, account_name, bank_name }); this.toast('Withdrawal requested', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },

  /* ================= PAYMONGO ================= */
  loadPayMongo(pk) {
    if (window.Paymongo) return Promise.resolve(window.Paymongo(pk));
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.paymongo.com/v1/v3.js';
      s.onload = () => resolve(window.Paymongo && window.Paymongo(pk));
      s.onerror = () => reject(new Error('Could not load PayMongo.js'));
      document.head.appendChild(s);
    });
  },
  // Run the client-side PaymentIntent attach flow. Returns true when paid.
  async runPayMongoIntent(intent, kind) {
    try {
      const cfg = await API.get('/paymongo/config');
      const pk = cfg.publicKey;
      if (!pk) throw new Error('PayMongo public key not configured');
      const paymongo = await this.loadPayMongo(pk);
      // PayMongo.js: create a payment method for the chosen e-wallet.
      const paymentMethod = await paymongo.create('payment_method', { type: 'gcash' });
      const result = await paymongo.attach({
        paymentIntentId: intent.intent_id,
        clientKey: intent.client_key,
        paymentMethod: paymentMethod.id,
        returnUrl: intent.return_url,
      });
      // If PayMongo instructs a redirect, send the user there; the callback
      // path (handlePayMongoCallback) resumes after payment.
      if (result && result.nextAction && result.nextAction.redirect && result.nextAction.redirect.url) {
        window.location.href = result.nextAction.redirect.url;
        return false;
      }
      // No redirect needed (e.g. card or already paid) - confirm directly.
      await API.post('/paymongo/confirm', { intent_id: intent.intent_id, payment_id: intent.payment_id });
      this.toast('Payment successful', 'success');
      this.toastRedirect(kind);
      return true;
    } catch (e) {
      this.toast('Payment failed: ' + (e.message || 'unknown error'), 'error');
      return false;
    }
  },
  toastRedirect(kind) {
    if (kind === 'booking') {
      location.hash = '#/wallet';
      this.toast('Payment received — wallet credited. You can now confirm your booking.', 'success');
    } else {
      location.hash = '#/wallet';
    }
  },  // Landing page for PayMongo redirect returns.
  async handlePayMongoCallback(query) {
    const intentId = query && query.payment_intent_id;
    const kind = (query && query.kind) || 'topup';
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px"><div class="detail-card"><h3>Payment</h3><p style="color:var(--ink-soft)">Confirming your ${kind === 'booking' ? 'booking ' : ''}payment…</p></div></div>`;
    try {
      // Find the payment row tied to this intent by asking the server to confirm.
      const confirm = await API.post('/paymongo/confirm', { intent_id: intentId || '' });
      this.toast('Payment confirmed', 'success');
      if (kind === 'booking' && this.state._retryBooking) {
        const bookBody = this.state._retryBooking;
        delete this.state._retryBooking;
        try {
          const d = await API.post('/bookings', bookBody);
          this.toast('Booking requested — funds held in escrow!', 'success');
          location.hash = '#/booking/' + d.booking.id;
          return;
        } catch (e2) {
          this.toast('Payment received — you can now complete your booking', 'success');
          location.hash = '#/wallet';
          return;
        }
      }
      this.toastRedirect(kind);
    } catch (e) {
      this.$app.innerHTML = `<div class="wrap" style="padding-top:24px"><div class="detail-card"><h3>Payment</h3><p style="color:var(--red)">${esc(e.message || 'Could not confirm payment')}</p><p><a class="btn btn-outline" href="#/wallet">Back to wallet</a></p></div></div>`;
    }
  },

  /* ================= SELLER DASHBOARD ================= */
  async viewSellerDashboard() {
    const d = await API.get('/seller/dashboard');
    const u = this.state.user;
    const badge = d.premium ? '<span class="meta-pill" style="background:var(--honey);color:#3a2a00">👑 Premium</span>' : '<span class="meta-pill pending">Free plan</span>';
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0">📊 Seller Dashboard</h3>${badge}
        <span style="margin-left:auto"><a class="btn btn-outline" href="#/list/new">+ New listing</a></span>
      </div>
      <p style="font-size:13px;color:var(--ink-soft);margin-top:6px">Track your listings, sales and gross income.</p>
      <div class="stat-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px">
        ${stat('Active listings', d.counts.active_listings)}
        ${stat('Total listings', d.counts.total_listings)}
        ${stat('Completed rentals', d.counts.completed_bookings)}
        ${stat('Total bookings', d.counts.total_bookings)}
        ${stat('Gross income', fmtMoney(d.money.gross_income), 'var(--green)')}
        ${stat('Platform fees', fmtMoney(d.money.platform_fees), 'var(--red)')}
        ${stat('Net income', fmtMoney(d.money.net_income), 'var(--green)')}
      </div>
      <div class="detail-card" style="margin-top:16px">
        <h3>Business details</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:10px">
          <div><div class="s" style="color:var(--ink-soft);font-size:12px">Owner</div><div class="t">${esc(u.full_name)}</div></div>
          <div><div class="s" style="color:var(--ink-soft);font-size:12px">Email</div><div class="t">${esc(u.email || '—')}</div></div>
          <div><div class="s" style="color:var(--ink-soft);font-size:12px">City</div><div class="t">${esc(u.city || '—')}</div></div>
          <div><div class="s" style="color:var(--ink-soft);font-size:12px">Total rentals sold</div><div class="t">${d.counts.total_rentals}</div></div>
          <div><div class="s" style="color:var(--ink-soft);font-size:12px">Pending bookings</div><div class="t">${d.counts.pending_bookings}</div></div>
        </div>
      </div>
      <div class="detail-card" style="margin-top:16px">
        <h3>My listings</h3>
        <div style="margin-top:10px">${d.listings.map(l => `
          <div class="list-row" style="box-shadow:none">
            <div class="body">
              <div class="t">${esc(l.title)}</div>
              <div class="s">${fmtMoney(l.price_per_day)}/day · ${l.rental_count} rentals · ${l.featured ? '⭐ Featured' : ''}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:12px;color:${l.status === 'active' ? 'var(--green)' : 'var(--ink-soft)'}">${esc(l.status)}</div>
              ${l.status === 'active' ? `<div style="margin-top:4px"><button class="btn btn-outline btn-sm" onclick="Root.boostMySQL(${l.id})">⚡ Boost ₱49</button></div>` : ''}
            </div>
          </div>`).join('') || '<p style="color:var(--ink-soft);font-size:13px">No listings yet. <a href="#/list/new">Create one</a>.</p>'}
        </div>
      </div>
    </div>`;
    function stat(k, v, color) {
      return `<div class="detail-card" style="padding:14px"><div class="s" style="color:var(--ink-soft);font-size:12px">${k}</div><div class="t" style="font-size:20px;font-weight:800;color:${color || 'inherit'}">${v}</div></div>`;
    }
  },
  async boostMySQL(id) {
    try { const r = await API.post('/listings/' + id + '/boost', {}); this.toast(`Featured boost active — ₱${r.fee} ✓`, 'success'); this.viewSellerDashboard(); }
    catch (e) { this.toast(e.message, 'error'); }
  },

  /* ================= PREMIUM ================= */
  async viewPremium() {
    const u = this.state.user;
    const active = u.is_premium;
    const until = u.premium_until ? `expires ${fmtDate(u.premium_until)}` : '';
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="detail-card" style="max-width:520px;margin:0 auto">
        <div style="font-size:34px">👑</div>
        <h3>GoRentHive Premium</h3>
        <p style="font-size:13.5px;color:var(--ink-soft);margin-top:6px">Upgrade to grow your rental business.</p>
        <ul style="margin:14px 0 0;padding-left:20px;font-size:14px;line-height:1.9">
          <li>♾️ <b>Unlimited listings</b> — no monthly cap</li>
          <li>📊 <b>Seller dashboard</b> — track sales, gross &amp; net income</li>
          <li>📈 <b>Business insights</b> to grow your rentals</li>
        </ul>
        <div style="margin-top:16px;padding:14px;border:1px dashed var(--line);border-radius:10px;text-align:center">
          <div style="font-size:26px;font-weight:800">₱1,499<span style="font-size:13px;color:var(--ink-soft)">/year</span></div>
          ${active ? `<div style="margin-top:8px;color:var(--green)">✓ You're Premium${until ? ' (' + until + ')' : ''}</div>` : `<button class="btn btn-primary btn-block" onclick="Root.purchasePremium()">Upgrade to Premium</button>`}
        </div>
      </div>
    </div>`;
  },
  async purchasePremium() {
    try { const r = await API.post('/account/premium', {}); this.toast(`Premium activated — ₱${r.fee} charged ✓`, 'success'); this.refreshUser(); }
    catch (e) { this.toast(e.message, 'error'); }
  },

  /* ================= PROFILE / ME ================= */
  async viewProfile() {
    const u = this.state.user;
    const myListings = u.is_owner ? await API.get('/listings?owner=' + u.id) : [];
    const bookings = await API.get('/bookings/mine/all');
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="grid-2-side" style="margin-top:0">
        <div>
          <div class="detail-card">
            <div style="display:flex;gap:14px;align-items:center">
              <div class="avatar lg">${esc((u.full_name || '?')[0])}</div>
              <div class="grow"><div style="font-size:20px;font-weight:800">${esc(u.full_name)}</div>
              <div style="font-size:13px;color:var(--ink-soft)">${esc(u.email || u.phone || '')} · ${esc(u.city || '')}</div></div>
              <span class="pill ${u.identity_status === 'verified' ? 'verified' : 'pending'}">${u.identity_status}</span>
            </div>
            <div class="detail-meta" style="margin-top:14px">
              ${u.mobile_verified ? '<span class="meta-pill">✓ Mobile verified</span>' : '<span class="meta-pill pending">Mobile unverified</span>'}
              ${u.email_verified ? '<span class="meta-pill">✓ Email verified</span>' : '<span class="meta-pill pending">Email unverified</span>'}
              ${u.identity_status === 'verified' ? `<span class="meta-pill">🪪 Level ${u.identity_level}</span>` : `<span class="meta-pill pending">ID: ${esc(u.identity_status)}</span>`}
              <span class="meta-pill">${stars(u.vessel_rating)} ${Number(u.vessel_rating).toFixed(1)}</span>
              <button class="btn btn-outline btn-sm" onclick="Root.toggleOwner()">${u.is_owner ? '✓ You are an Owner' : 'Become an Owner'}</button>
            </div>
            <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="location.hash='#/verify'">🔐 Security &amp; Verification</button>
          </div>

          <div class="detail-card" style="margin-top:16px">
            <h3>My Bookings (All)</h3>
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
              ${bookings.slice(0, 10).map(b => `<a class="list-row" href="#/booking/${b.id}">
                <div class="body"><div class="t">${esc(b.listing ? b.listing.title : 'Booking ' + b.booking_ref)}</div>
                <div class="s">${b.renter_id === u.id ? 'Renting' : 'Rented out'} · ${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}</div></div>
                <span class="pill ${b.status}">${b.status}</span>
              </a>`).join('') || '<p style="color:var(--ink-soft);font-size:13px">No bookings yet.</p>'}
            </div>
          </div>

          ${u.is_owner ? `<div class="detail-card" style="margin-top:16px">
            <h3>My Listings</h3><div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
            ${myListings.map(l => `<a class="list-row" href="#/listing/${l.id}">
              <img src="${l.images && l.images[0] ? esc(l.images[0]) : '/images/svg/placeholder.svg'}" style="width:44px;height:44px;border-radius:9px;object-fit:cover">
              <div class="body"><div class="t">${esc(l.title)}</div><div class="s">${fmtMoney(l.price_per_day)}/day</div></div>
              <span class="pill ${l.status}">${l.status}</span>
            </a>`).join('') || '<p style="color:var(--ink-soft);font-size:13px">No listings.</p>'}
            <a class="btn btn-outline btn-block" href="#/list">+ List item</a></div>
          </div>` : ''}
        </div>
        <div>
          <div class="booking-box">
            <button class="btn btn-outline btn-block" onclick="location.hash='#/wallet'">💰 Wallet</button>
            ${u.is_owner ? `<button class="btn btn-outline btn-block" style="margin-top:8px" onclick="location.hash='#/dashboard'">📊 Seller Dashboard</button>` : ''}
            <button class="btn ${u.is_premium ? 'btn-outline' : 'btn-primary'} btn-block" style="margin-top:8px" onclick="location.hash='#/premium'">${u.is_premium ? '👑 Premium Active' : '👑 Go Premium'}</button>
            <button class="btn btn-outline btn-block" style="margin-top:8px" onclick="location.hash='#/favorites'">♡ Favorites</button>
            <button class="btn btn-outline btn-block" style="margin-top:8px" onclick="location.hash='#/notifications'">🔔 Notifications</button>
            <button class="btn btn-outline btn-block" style="margin-top:8px" onclick="location.hash='#/requests'">🙏 My Rent Requests</button>
            <button class="btn btn-dark btn-block" style="margin-top:8px" onclick="Root.logout()">Log out</button>
          </div>
        </div>
      </div>
    </div>`;
  },
  sendMobileOtp() {
    this.modal(`Verify your mobile number
      <p style="font-size:13px;color:var(--ink-soft);margin-top:4px">A 6-digit code will be sent to ${esc(this.state.user.phone || 'your phone')}. It expires in 10 minutes.</p>
      <div class="form-row"><label>6-digit code</label><input id="otp-code" inputmode="numeric" maxlength="6" placeholder="000000"></div>
      <button class="btn btn-primary btn-block" onclick="Root.confirmMobileOtp()">Verify</button>
      <button class="btn btn-link btn-block" style="margin-top:6px;color:var(--brand)" onclick="Root.resendOtp()">Resend code</button>
      <div id="otp-demo" style="font-size:11px;color:var(--ink-soft);margin-top:8px"></div>`, 'close');
    this.requestOtp();
  },
  async requestOtp() {
    try { const d = await API.post('/auth/verify/mobile/send'); const el = document.getElementById('otp-demo'); if (el) el.textContent = 'Demo only: your code is ' + d.demoCode; }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async resendOtp() {
    try { const d = await API.post('/auth/verify/mobile/resend'); const el = document.getElementById('otp-demo'); if (el) el.textContent = 'Demo only: your code is ' + d.demoCode; this.toast('Code resent', 'success'); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async confirmMobileOtp() {
    const code = document.getElementById('otp-code').value;
    try { await API.post('/auth/verify/mobile', { code }); this.toast('Mobile verified!', 'success'); this.closeModal(); this.refreshUser(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  sendEmailVerify() {
    this.modal(`Verify your email address
      <p style="font-size:13px;color:var(--ink-soft);margin-top:4px">We'll send a verification link to ${esc(this.state.user.email || 'your email')}. Click it (or paste the token below) to confirm.</p>
      <div class="form-row"><label>Verification token from email</label><input id="em-token" placeholder="Paste token here (demo shows it below)"></div>
      <button class="btn btn-primary btn-block" onclick="Root.confirmEmail()">Confirm email</button>
      <button class="btn btn-link btn-block" style="margin-top:6px;color:var(--brand)" onclick="Root.sendEmailVerifyLink()">Send link</button>
      <div id="em-demo" style="font-size:11px;color:var(--ink-soft);margin-top:8px"></div>`, 'close');
    this.sendEmailVerifyLink();
  },
  async sendEmailVerifyLink() {
    try { const d = await API.post('/auth/verify/email/send'); const el = document.getElementById('em-demo'); if (el) el.textContent = 'Demo only: token is ' + d.demoToken; }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async confirmEmail() {
    const token = document.getElementById('em-token').value;
    try { await API.post('/auth/verify/email', { token }); this.toast('Email verified!', 'success'); this.closeModal(); this.refreshUser(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async refreshUser() {
    try { const d = await API.get('/auth/me'); this.state.user = d.user; this.state.verification = d.verification; location.reload(); }
    catch (e) { location.reload(); }
  },

  // Full verification center
  async viewVerify() {
    const u = this.state.user;
    if (!u) return this.guard(() => {});
    const v = this.state.verification || { verified: true, missing: [] };
    const item = (done, label, action, note) => `
      <div class="list-row" style="box-shadow:none;align-items:center">
        <div class="body"><div class="t">${label} ${done ? '<span style="color:var(--green)">✓</span>' : ''}</div>
        <div class="s" style="font-size:12.5px">${note || ''}</div></div>
        ${done ? '' : `<button class="btn btn-outline btn-sm" onclick="${action}">${action.includes('verifyIdentity') ? 'Submit ID' : 'Verify'}</button>`}
      </div>`;
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="detail-card">
        <h3>🔐 Security &amp; Verification</h3>
        <p style="font-size:13px;color:var(--ink-soft);margin-top:4px">Renting and listing require a fully verified account. Verification helps keep GoRentHive safe and makes sure transactions happen securely in-app.</p>
        <div style="margin-top:12px">
          ${item(u.email_verified, 'Email address', 'Root.sendEmailVerify()', 'Confirm the email on your account')}
          ${item(u.mobile_verified, 'Phone number', 'Root.sendMobileOtp()', 'Receive a one-time 6-digit SMS code')}
          ${item(u.identity_status === 'verified', 'Government ID', 'Root.verifyIdentity()', 'Identity status: ' + esc(u.identity_status))}
          ${item(u.location_verified, 'Verified location', 'Root.verifyLocation()', u.location_verified ? (u.location_verified_by === 'gps' ? '📍 GPS verified' : '📍 Address verified') : 'Confirm your location for nearby search & safer handovers')}
        </div>
        <div style="margin-top:14px;background:var(--bg);padding:12px;border-radius:10px">
          <div style="font-weight:700;font-size:14px">Your verification level: <span style="color:var(--brand)">Level ${u.identity_level}</span></div>
          <div style="font-size:12.5px;color:var(--ink-soft);margin-top:4px">
            Level 2 unlocks renting. Level 3 unlocks premium items &amp; listing as an owner. Level 4 unlocks vehicles &amp; high-value items.<br>
            <b>Note:</b> Your phone and email are never shown to other users. They're only used for verification and booking coordination.
          </div>
        </div>
        <button class="btn btn-outline btn-block" style="margin-top:14px" onclick="Root.acceptTermsPrompt()">📄 Review &amp; accept Terms</button>
      </div>
    </div>`;
  },
  async acceptTermsPrompt() {
    this.modal(`Terms &amp; Conditions
      <p style="font-size:12.5px;color:var(--ink-soft)">By accepting you agree to keep all payments inside GoRentHive, not to share contact details to move bookings off-platform, and to follow GoRentHive's Rental, Cancellation, Refund and Damage policies.</p>
      <button class="btn btn-primary btn-block" onclick="Root.acceptTerms()">I accept the Terms &amp; Conditions</button>`, 'close');
  },
  async acceptTerms() {
    try { await API.post('/auth/terms/accept'); this.state.termsAccepted = true; this.closeModal(); this.toast('Terms accepted', 'success'); this.refreshUser(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  verifyIdentity() {
    this.modal(`Identity Verification
      <div class="form-row"><label>ID type</label><select id="id-type"><option>Driver's License</option><option>Passport</option><option>National ID</option><option>UMID</option><option>PRC ID</option></select></div>
      <div class="form-row"><label>ID number</label><input id="id-num" placeholder="ID number"></div>
      <div class="form-row"><label>Selfie / ID photo</label><input type="file" accept="image/*" id="id-selfie"></div>
      <button class="btn btn-primary btn-block" onclick="Root.submitIdentity()">Submit for review</button>`, 'close');
  },
  async submitIdentity() {
    const id_type = document.getElementById('id-type').value;
    const id_number = document.getElementById('id-num').value;
    let selfie = '';
    const f = document.getElementById('id-selfie').files[0];
    if (f) {
      const fd = new FormData(); fd.append('files', f);
      const up = await fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
      selfie = up.urls[0] || '';
    }
    try { await API.post('/auth/verify/identity', { id_type, id_number, selfie }); this.toast('Submitted for review', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  verifyLocation() {
    const loc = this.state.meLocation || {};
    this.modal(`Verify your location
      <p style="font-size:12.5px;color:var(--ink-soft)">Verifying your location lets GoRentHive show you listings nearby and confirm safe public meeting points for handovers. Your exact location is never shown publicly.</p>
      <p style="font-size:12.5px;color:var(--ink-soft);margin-top:6px">📍 Saved location: <b>${loc.latitude != null ? Number(loc.latitude).toFixed(4) + ', ' + Number(loc.longitude).toFixed(4) : 'Not set'}</b> (${esc(this.state.user.location_status || 'none')})</p>
      <button class="btn btn-primary btn-block" style="margin-top:8px" onclick="Root.verifyLocationGps()">Use my current GPS location</button>
      <div style="text-align:center;color:var(--ink-soft);font-size:12px;margin:8px 0">or enter coordinates manually</div>
      <div class="form-row"><label>Latitude</label><input id="loc-lat" type="number" step="any" placeholder="e.g. 14.5995" value="${loc.latitude != null ? loc.latitude : ''}"></div>
      <div class="form-row"><label>Longitude</label><input id="loc-lng" type="number" step="any" placeholder="e.g. 120.9842" value="${loc.longitude != null ? loc.longitude : ''}"></div>
      <div class="form-row"><label>Address (optional)</label><input id="loc-addr" placeholder="e.g. 123 Mabini St, Makati"></div>
      <button class="btn btn-outline btn-block" onclick="Root.verifyLocationManual()">Verify with entered coordinates</button>`, 'close');
  },
  async verifyLocationGps() {
    if (!navigator.geolocation) { this.toast('GPS not supported', 'error'); return; }
    this.toast('Getting GPS location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const latitude = pos.coords.latitude, longitude = pos.coords.longitude;
          const r = await API.post('/auth/verify-location', { source: 'gps', latitude, longitude });
          this.state.user = r.user; this.refreshUser(); this.closeModal();
          this.toast('Location verified by GPS', 'success'); location.hash = '#/me?tab=verify';
        } catch (e) { this.toast(e.message, 'error'); }
      },
      (err) => this.toast('Could not get GPS: ' + (err.message || 'denied'), 'error'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  },
  async verifyLocationManual() {
    const latitude = parseFloat(document.getElementById('loc-lat').value);
    const longitude = parseFloat(document.getElementById('loc-lng').value);
    const address = document.getElementById('loc-addr').value.trim();
    if (!(Number.isFinite(latitude) && Number.isFinite(longitude))) { this.toast('Enter valid latitude and longitude', 'error'); return; }
    try { const r = await API.post('/auth/verify-location', { source: 'manual', latitude, longitude, address: address || undefined }); this.state.user = r.user; this.refreshUser(); this.closeModal(); this.toast('Location verified', 'success'); location.hash = '#/me?tab=verify'; }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async toggleOwner() {
    try { await API.post('/auth/owner-toggle', { is_owner: !this.state.user.is_owner }); this.toast('Updated', 'success'); this.state.user.is_owner = !this.state.user.is_owner; location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async logout() {
    try { await API.post('/auth/logout'); } catch (e) {}
    this.state.user = null; this.state.collections = null;
    location.hash = '#/';
  },
  async viewPublicProfile(id) {
    // derive from listings owner
    const lists = await API.get('/listings?owner=' + id);
    const owner = lists.length ? lists[0].owner : { full_name: 'User', id };
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="detail-card">
        <div style="display:flex;gap:14px;align-items:center">
          <div class="avatar lg">${esc((owner.full_name || '?')[0])}</div>
          <div><div style="font-size:20px;font-weight:800">${esc(owner.full_name)} ${owner.identity_status === 'verified' ? '<span class="verified-chip">✓ Verified</span>' : ''}</div>
          <div style="font-size:13px;color:var(--ink-soft)">${stars(owner.vessel_rating)} ${Number(owner.vessel_rating).toFixed(1)} · ${owner.successful_rentals} successful rentals · Level ${owner.identity_level}</div></div>
        </div>
        ${this.state.user && this.state.user.id !== owner.id ? `<button class="btn btn-primary btn-block" style="margin-top:14px" onclick="Root.openChat('${owner.id}',null)">💬 Message</button>` : ''}
      </div>
      <div class="section"><div class="section-head"><h2>Listed Items</h2></div><div class="card-grid">${lists.map(l => this.listingCard(l)).join('') || '<p style="color:var(--ink-soft)">No listings.</p>'}</div></div>
    </div>`;
  },

  /* ================= AUTH ================= */
  viewAuth(mode) {
    const isLogin = mode === 'login';
    this.$app.innerHTML = `<div class="wrap" style="padding-top:40px"><div class="form-card">
      <div class="brand" style="justify-content:center;margin-bottom:14px"><span class="logo">🐝</span><span><b>Go</b>RentHive</span></div>
      <div class="form-title" style="text-align:center">${isLogin ? 'Welcome back' : 'Create your account'}</div>
      <p class="form-sub" style="text-align:center">${isLogin ? 'Log in to continue renting & earning.' : 'Join GoRentHive. Need it? Rent it. Own it? Earn from it.'}</p>
      ${isLogin ? '' : `<div class="form-row"><label>Full name</label><input id="a-name" placeholder="Juan Dela Cruz"></div>`}
      <form id="auth-form" onsubmit="event.preventDefault(); Root.doAuth('${mode}')">
      <div class="form-row"><label>Email</label><input id="a-email" type="email" placeholder="you@email.com" autocomplete="email"></div>
      ${isLogin ? '' : `<div class="form-row"><label>Phone (optional)</label><input id="a-phone" placeholder="09xxxxxxxxx" autocomplete="tel"></div>`}
      <div class="form-row"><label>Password</label><input id="a-pass" type="password" placeholder="••••••••" autocomplete="${isLogin ? 'current-password' : 'new-password'}"></div>
      ${isLogin ? '' : `<div class="form-row"><label>City</label><input id="a-city" placeholder="e.g. General Trias"></div>`}
      <button type="submit" class="btn btn-primary btn-block btn-lg">${isLogin ? 'Log in →' : 'Create account →'}</button>
      </form>
      <div class="alt">${isLogin ? `New to GoRentHive? <a href="#/register">Create an account</a>` : `Already have an account? <a href="#/login">Log in</a>`}</div>
    </div></div>`;
  },
  async doAuth(mode) {
    const email = document.getElementById('a-email').value.trim();
    const phone = document.getElementById('a-phone') ? document.getElementById('a-phone').value.trim() : '';
    const password = document.getElementById('a-pass').value;
    try {
      if (mode === 'login') {
        const body = { password };
        if (email.includes('@')) body.email = email; else body.phone = email;
        const d = await API.post('/auth/login', body);
        this.state.user = d.user;
        if (!d.user) { this.toast('Logged in but profile could not load. Please refresh.', 'warn'); }
        else { this.toast('Welcome back, ' + d.user.full_name, 'success'); }
      } else {
        const d = await API.post('/auth/register', {
          full_name: document.getElementById('a-name').value.trim(),
          email, phone, password,
          city: document.getElementById('a-city') ? document.getElementById('a-city').value.trim() : '',
        });
        this.state.user = d.user;
        if (!d.user) { this.toast('Account created but profile could not load. Please refresh.', 'warn'); }
        else { this.toast('Account created 🎉', 'success'); }
      }
      this.state.collections = null;
      this.loadUnread();
      location.hash = '#/';
    } catch (e) { this.toast(e.message, 'error'); }
  },

  /* ================= REQUESTS ================= */
  async viewRequests() {
    let feed = [];
    try { feed = await API.get('/requests'); } catch (e) {}
    const mine = await API.get('/requests/mine').catch(() => []);
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="grid-2-side" style="margin-top:0">
        <div>
          <div class="detail-card">
            <h3>🙏 I NEED SOMETHING</h3>
            <p style="font-size:13px;color:var(--ink-soft);margin-top:6px">Can't find it? Post a request. Owners nearby get notified.</p>
            <div class="form-row" style="margin-top:12px"><label>What do you need?</label><input id="rq-title" placeholder="e.g. A 6-person tent this weekend"></div>
            <div class="form-grid2">
              <div class="form-row"><label>Category</label><select id="rq-cat"><option value="">Any</option>${this.state.categories.map(c => `<option value="${c.name}">${c.icon} ${esc(c.name)}</option>`).join('')}</select></div>
              <div class="form-row"><label>City</label><input id="rq-city" placeholder="City"></div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>From</label><input id="rq-sd" type="date"></div>
              <div class="form-row"><label>To</label><input id="rq-ed" type="date"></div>
            </div>
            <div class="form-row"><label>Budget (₱/day)</label><input id="rq-budget" type="number" min="0" placeholder="Optional"></div>
            <button class="btn btn-primary btn-block" onclick="Root.postRequest()">Post request</button>
          </div>
          <div class="detail-card" style="margin-top:16px"><h3>Open Requests</h3>
            <div style="margin-top:12px">${feed.map(r => `<div class="req-card">
              <div class="t">🔔 ${esc(r.title)}</div>
              <div class="d">${esc(r.description || '')} ${r.city ? '· 📍' + esc(r.city) : ''}</div>
              ${r.start_date ? `<div class="d">📅 ${fmtDate(r.start_date)} ${r.end_date ? '→ ' + fmtDate(r.end_date) : ''}</div>` : ''}
              ${r.budget ? `<div class="d">💰 up to ${fmtMoney(r.budget)}/day</div>` : ''}
              <div class="d" style="margin-top:6px">Posted by ${esc(r.requester ? r.requester.full_name : 'someone')} · ${timeAgo(r.created_at)}</div>
            </div>`).join('') || '<p style="color:var(--ink-soft)">No open requests yet. Be the first to post!</p>'}</div>
          </div>
        </div>
        <div class="detail-card">
          <h3>My Requests</h3>
          <div style="margin-top:10px">${mine.map(r => `<div class="list-row"><div class="body"><div class="t">${esc(r.title)}</div><div class="s"><span class="pill ${r.status}">${r.status}</span></div></div>
            ${r.status === 'open' ? `<button class="btn btn-outline btn-sm" onclick="Root.closeRequest(${r.id})">Close</button>` : ''}</div>`).join('') || '<p style="color:var(--ink-soft)">You haven\'t posted any requests.</p>'}</div>
        </div>
      </div>
    </div>`;
  },
  async postRequest() {
    const title = document.getElementById('rq-title').value.trim();
    if (!title) { this.toast('Describe what you need', 'error'); return; }
    const body = {
      title,
      category: document.getElementById('rq-cat').value,
      city: document.getElementById('rq-city').value.trim(),
      start_date: document.getElementById('rq-sd').value || null,
      end_date: document.getElementById('rq-ed').value || null,
      budget: parseInt(document.getElementById('rq-budget').value || '0', 10) || null,
    };
    try { await API.post('/requests', body); this.toast('Request posted! Owners notified 🔔', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async closeRequest(id) {
    try { await API.post('/requests/' + id + '/close'); this.toast('Request closed', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },

  /* ================= NOTIFICATIONS ================= */
  async viewNotifications() {
    // Use messages + hardcoded notif route isn't in API; implement via a notifications endpoint
    let notifs = [];
    try { notifs = await API.get('/notifications'); } catch (e) {}
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px"><div class="detail-card">
      <h3>Notifications</h3>
      <div style="margin-top:12px">${notifs.map(n => `<div class="list-row"><div class="body"><div class="t">${esc(n.title)}</div><div class="s">${esc(n.body)} · ${timeAgo(n.created_at)}</div></div></div>`).join('') || '<p style="color:var(--ink-soft)">No notifications.</p>'}</div>
    </div></div>`;
  },

  /* ================= LEGAL ================= */
  async viewLegal(type) {
    let t = { type: 'terms', title: 'Terms & Conditions', content: 'Loading...' };
    try { t = await API.get('/legal/' + (type || 'terms')); } catch (e) {}
    const types = ['terms', 'privacy', 'rental_agreement', 'cancellation', 'refund', 'damage', 'prohibited', 'owner', 'renter'];
    const labels = { terms: 'Terms & Conditions', privacy: 'Privacy Policy', rental_agreement: 'Rental Agreement', cancellation: 'Cancellation Policy', refund: 'Refund Policy', damage: 'Damage & Loss Policy', prohibited: 'Prohibited Items', owner: 'Owner Agreement', renter: 'Renter Agreement' };
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="tabs">${types.map(x => `<a class="tab ${x === (type || 'terms') ? 'active' : ''}" href="#/legal/${x}">${labels[x]}</a>`).join('')}</div>
      <div class="legal-box"><div class="content">${esc(t.content)}</div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          ${this.state.user ? `<button class="btn btn-primary" onclick="Root.acceptTerms('${t.type}')">I Agree & Continue</button>` : ''}
        </div>
        <p style="font-size:11px;color:var(--ink-soft);margin-top:12px">Version ${t.version} · Note: legal policies should be reviewed by qualified Philippine legal counsel before commercial launch.</p>
      </div>
    </div>`;
  },
  async acceptTerms(type) {
    try { await API.post('/legal/' + type + '/accept'); this.toast('Accepted', 'success'); } catch (e) { this.toast(e.message, 'error'); }
  },

  /* ================= MODAL helper ================= */
  modal(inner, size) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${size || ''}"><button class="close-x" onclick="this.closest('.modal-backdrop').remove()">✕</button>${inner}</div>`;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    return wrap;
  },
  closeModal() {
    const w = document.querySelector('.modal-backdrop');
    if (w) w.remove();
  },

  /* ================= ADMIN ================= */
  async viewAdmin(tab) {
    tab = tab || 'analytics';
    const nav = [
      ['analytics', '📊 Overview'], ['users', '👥 Users'], ['listings', '📦 Listings'], ['disputes', '⚖️ Disputes'],
      ['settings', '⚙️ Fees'], ['refunds', '↩️ Refunds'], ['payouts', '💸 Payouts'], ['account', '🏦 Founder Pay'], ['audit', '📜 Audit'],
    ];
    this.$app.innerHTML = `<div class="wrap" style="padding-top:24px">
      <div class="admin-grid">
        <div class="admin-side">${nav.map(([k, l]) => `<a href="#/admin?tab=${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div>
        <div id="admin-body"><div class="spinner"></div></div>
      </div>
    </div>`;
    await this.adminTab(tab);
  },
  async adminTab(tab) {
    const el = () => document.getElementById('admin-body');
    try {
      if (tab === 'analytics') {
        const a = await API.get('/admin/analytics');
        el().innerHTML = `
          <div class="stat-grid">${this.statCard('👥', a.totalUsers, 'Total Users')}${this.statCard('🟢', a.activeUsers, 'Active (30d)')}${this.statCard('📦', a.activeListings, 'Active Listings')}${this.statCard('📦', a.listings, 'Total Listings')}
          ${this.statCard('📅', a.bookings, 'Total Bookings')}${this.statCard('✅', a.completed, 'Completed')}${this.statCard('❌', a.cancelled, 'Cancelled')}${this.statCard('⚖️', a.pendingDisputes, 'Open Disputes')}</div>
          <div class="stat-grid" style="margin-top:12px">
            ${this.statCard('💰', fmtMoney(a.gross), 'Gross Rental Value')}${this.statCard('🏦', fmtMoney(a.platformRevenue), 'Platform Revenue')}</div>
          <div class="detail-card" style="margin-top:16px"><h3>Top Categories</h3>
            <div style="margin-top:10px">${a.topCategories.map(c => `<div class="list-row"><div class="body"><div class="t">${esc(c.name)}</div></div><div class="v" style="font-weight:800">${c.c}</div></div>`).join('') || '<p style="color:var(--ink-soft)">No data.</p>'}</div>
          </div>`;
      } else if (tab === 'users') {
        const users = await API.get('/admin/users');
        el().innerHTML = `<div class="detail-card"><h3>Users</h3>
          <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Contact</th><th>City</th><th>Verified</th><th>Role</th><th>Balance</th><th></th></tr></thead><tbody>
          ${users.map(u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.email || u.phone || '')}</td><td>${esc(u.city || '')}</td>
            <td><span class="pill ${u.identity_status === 'verified' ? 'verified' : 'pending'}">${u.identity_status} · L${u.identity_level}</span></td>
            <td>${u.role === 'admin' ? 'Admin' : (u.is_owner ? 'Owner' : 'User')}</td><td>${fmtMoney(u.wallet_balance)}</td>
            <td><button class="btn btn-outline btn-sm" onclick="Root.adminUser('${u.id}')">Manage</button></td></tr>`).join('')}
          </tbody></table></div></div>`;
      } else if (tab === 'listings') {
        const lists = await API.get('/admin/listings');
        el().innerHTML = `<div class="detail-card"><h3>Listings</h3><div class="table-wrap"><table class="table"><thead><tr><th>Title</th><th>Owner</th><th>Price</th><th>Status</th><th>Featured</th><th></th></tr></thead><tbody>
          ${lists.map(l => `<tr><td>${esc(l.title)}</td><td>${esc(l.owner_name || '')}</td><td>${fmtMoney(l.price_per_day)}/d</td>
            <td><span class="pill ${l.status}">${l.status}</span></td><td>${l.featured ? '🔥' : '—'}</td>
            <td><button class="btn btn-outline btn-sm" onclick="Root.adminListing(${l.id})">Manage</button></td></tr>`).join('')}
          </tbody></table></div></div>`;
      } else if (tab === 'disputes') {
        const d = await API.get('/admin/disputes');
        el().innerHTML = `<div class="detail-card"><h3>Disputes</h3><div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Booking</th><th>Category</th><th>Status</th><th>Reported</th><th></th></tr></thead><tbody>
          ${d.map(x => `<tr><td>#${x.id}</td><td>${x.booking ? esc(x.booking.booking_ref) : '—'}</td><td>${esc(x.category)}</td><td><span class="pill ${x.status}">${x.status}</span></td><td>${timeAgo(x.created_at)}</td>
          <td><button class="btn btn-outline btn-sm" onclick="Root.adminDispute(${x.id})">Resolve</button></td></tr>`).join('')}
          </tbody></table></div></div>`;
      } else if (tab === 'settings') {
        const s = await API.get('/admin/settings');
        el().innerHTML = `<div class="detail-card"><h3>Marketplace Fees & Settings</h3>
          <div class="form-row"><label>Platform commission (%)</label><input id="s-percent" type="number" value="${s.platform_percent}"></div>
          <div class="form-row"><label>Minimum platform fee (₱)</label><input id="s-min" type="number" value="${s.platform_min_fee}"></div>
          <div class="form-row"><label>Maximum platform fee (₱, blank = none)</label><input id="s-max" type="number" value="${s.platform_max_fee || ''}"></div>
          <div class="form-grid2">
            <div class="form-row"><label>Featured basic (₱)</label><input id="s-fb" type="number" value="${s.featured_fee_basic}"></div>
            <div class="form-row"><label>Featured plus (₱)</label><input id="s-fp" type="number" value="${s.featured_fee_plus}"></div>
            <div class="form-row"><label>Featured premium (₱)</label><input id="s-fpm" type="number" value="${s.featured_fee_premium}"></div>
            <div class="form-row"><label>Free cancel hours</label><input id="s-fc" type="number" value="${s.free_cancellation_hours}"></div>
          </div>
          <button class="btn btn-primary" onclick="Root.saveSettings()">Save settings</button>
        </div>
        <div class="detail-card" style="margin-top:12px"><h3>Broadcast</h3>
          <div class="form-row"><label>Title</label><input id="bc-title"></div>
          <div class="form-row"><label>Body</label><textarea id="bc-body"></textarea></div>
          <button class="btn btn-primary" onclick="Root.broadcast()">Send to all users</button></div>`;
      } else if (tab === 'refunds') {
        const r = await API.get('/admin/refunds');
        el().innerHTML = `<div class="detail-card"><h3>Refunds</h3><div class="table-wrap"><table class="table"><thead><tr><th>Booking</th><th>Amount</th><th>Reason</th><th>Status</th><th>Date</th></tr></thead><tbody>
          ${r.map(x => `<tr><td>#${x.booking_id}</td><td>${fmtMoney(x.amount)}</td><td>${esc(x.reason)}</td><td><span class="pill ${x.status}">${x.status}</span></td><td>${timeAgo(x.created_at)}</td></tr>`).join('')}</tbody></table></div></div>`;
      } else if (tab === 'payouts') {
        const p = await API.get('/admin/payouts');
        el().innerHTML = `<div class="detail-card"><h3>Payouts</h3><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Amount</th><th>Method</th><th>Account</th><th>Holder</th><th>Status</th><th></th></tr></thead><tbody>
          ${p.map(x => `<tr><td>#${x.user_id}</td><td>${fmtMoney(x.amount)}</td><td>${esc(x.method || '')}</td><td>${esc(x.account || '')}${x.bank_name ? ' · ' + esc(x.bank_name) : ''}</td><td>${esc(x.account_name || '')}</td><td><span class="pill ${x.status}">${x.status}</span></td>
          <td><button class="btn btn-outline btn-sm" onclick="Root.payout('${x.id}','${esc(x.method || '')}','${esc(x.account || '')}')">Mark paid</button></td></tr>`).join('')}</tbody></table></div></div>`;
      } else if (tab === 'account') {
        const rev = await API.get('/admin/revenue');
        const f = rev.founder || {};
        const fmtM = (method) => ({ gcash: 'GCash', maya: 'Maya', bank: 'Bank transfer' }[method] || method || '—');
        const selMethod = ['gcash', 'maya', 'bank'].includes(f.method) ? f.method : 'gcash';
        const faOptions = [['gcash', 'GCash'], ['maya', 'Maya'], ['bank', 'Bank transfer']].map(([v, l]) => `<option value="${v}" ${v === selMethod ? 'selected' : ''}>${l}</option>`).join('');
        el().innerHTML = `<div class="detail-card"><h3>🏦 Founder / Platform Payout Account</h3>
          <p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px">Where GoRentHive's own earnings should be remitted to you. This is your bank / GCash / Maya account.</p>
          <div class="form-row"><label>Method</label><select id="fa-method" onchange="Root.toggleFounderBank()">${faOptions}</select></div>
          <div class="form-row"><label>Account holder name</label><input id="fa-name" value="${esc(f.account_name || '')}"></div>
          <div class="form-row"><label>Account number / GCash / Maya number</label><input id="fa-acct" value="${esc(f.account || '')}"></div>
          <div class="form-row" id="fa-bank-row" style="display:${selMethod === 'bank' ? '' : 'none'}"><label>Bank name</label><input id="fa-bank" value="${esc(f.bank_name || '')}" placeholder="e.g. BDO, BPI, GCash (bank transfer)"></div>
          <button class="btn btn-primary" onclick="Root.saveFounderAccount()">Save payout account</button>
        </div>
        <div class="detail-card" style="margin-top:12px"><h3>💰 Total Platform Revenue</h3>
          <div class="detail-price-big" style="color:var(--green)">${fmtMoney(rev.total)}</div>
          <p style="font-size:12.5px;color:var(--ink-soft);margin-top:6px">This is what you earn from ${fmtM(f.method || 'the platform')} — <b>${esc(f.account || 'no account set yet')}</b>${f.account_name ? ' (' + esc(f.account_name) + ')' : ''}.</p>
          <div style="margin-top:12px">${Object.entries(rev.breakdown || {}).map(([k, v]) => `<div class="list-row"><div class="body"><div class="t">${this.revLabel(k)}</div></div><div style="font-weight:800">${fmtMoney(v)}</div></div>`).join('') || '<p style="color:var(--ink-soft);font-size:13px">No revenue recorded yet.</p>'}</div>
          <p style="font-size:11px;color:var(--orange);margin-top:10px">Note: PayMongo does not auto-payout to your bank. Withdraw your collected balance from your PayMongo dashboard, then record it here as needed.</p>
        </div>`;
      } else if (tab === 'audit') {
        const a = await API.get('/admin/audit');
        el().innerHTML = `<div class="detail-card"><h3>Audit Log</h3><div class="table-wrap"><table class="table"><thead><tr><th>Action</th><th>Detail</th><th>By</th><th>When</th></tr></thead><tbody>
          ${a.map(x => `<tr><td>${esc(x.action)}</td><td>${esc(x.detail)}</td><td>#${x.admin_id || '—'}</td><td>${timeAgo(x.created_at)}</td></tr>`).join('')}</tbody></table></div></div>`;
      }
    } catch (e) { el().innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }
  },
  adminUser(id) {
    this.modal(`Manage User #${id}
      <div class="form-row"><label>Set identity</label><select id="au-ident"><option value="">—</option><option value="verified">Verified (Level 3)</option><option value="pending">Pending</option><option value="rejected">Rejected</option></select></div>
      <div class="form-row"><label>Role</label><select id="au-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
      <button class="btn btn-primary btn-block" onclick="Root.adminUserSave('${id}')">Save</button>`, 'close');
  },
  async adminUserSave(id) {
    const identity_status = document.getElementById('au-ident').value;
    const role = document.getElementById('au-role').value;
    try { await API.post('/admin/users/' + id, { identity_status, role }); this.toast('User updated', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  adminListing(id) {
    this.modal(`Manage Listing #${id}
      <div class="form-row"><label>Status</label><select id="al-status"><option value="active">Active</option><option value="paused">Paused</option><option value="removed">Removed</option></select></div>
      <div class="form-row"><label>Feature</label><select id="al-f"><option value="0">No</option><option value="1">🔥 Featured</option></select></div>
      <button class="btn btn-primary btn-block" onclick="Root.adminListingSave(${id})">Save</button>`, 'close');
  },
  async adminListingSave(id) {
    const status = document.getElementById('al-status').value;
    const featured = document.getElementById('al-f').value;
    try { await API.post('/admin/listings/' + id, { status, featured: parseInt(featured, 10) }); this.toast('Listing updated', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async adminDispute(id) {
    let d = null;
    try {
      const all = await API.get('/admin/disputes');
      d = all.find(x => x.id === id);
    } catch (e) {}
    if (!d) { this.toast('Dispute not found', 'error'); return; }
    const ev = d.evidence || {};
    const cond = (ev.condition || []).map(c => {
      let ph = [];
      try { ph = JSON.parse(c.photos || '[]') || []; } catch (err) {}
      return `<div class="evidence-block"><div class="t">${c.phase === 'checkin' ? 'Check-in' : 'Check-out'} · user#${c.uploaded_by}</div>
        ${c.serial_number ? `<div>Serial: ${esc(c.serial_number)}</div>` : ''}
        ${c.damage_notes ? `<div style="color:var(--orange)">${esc(c.damage_notes)}</div>` : ''}
        ${ph.length ? `<div class="evidence-grid" style="margin-top:4px">${ph.map(p => `<img src="${esc(p)}">`).join('')}</div>` : ''}
        <div style="font-size:11px;color:var(--ink-soft)">${fmtDateTime(c.created_at)}</div></div>`;
    }).join('');
    const chat = (ev.chat || []).map(m => `<div class="chat-line"><b>#${m.sender_id}</b> → #${m.receiver_id}: ${esc(m.body)}${m.warning ? ' <b style="color:var(--orange)">(' + esc(m.warning) + ')</b>' : ''} <span style="float:right;font-size:10px;color:var(--ink-soft)">${fmtDateTime(m.created_at)}</span></div>`).join('') || '<div class="alt" style="font-size:12px">No chat logs.</div>';
    const deliv = (ev.delivery || []).map(r => `<div class="evidence-block"><div class="t">${r.phase} · ${r.status}</div>
      <div>Order ${esc(r.provider_order_id)} · ${r.driver_name || '—'}</div>
      ${r.proof_photo ? `<img src="${esc(r.proof_photo)}" style="width:100%;max-width:180px;border-radius:8px;margin-top:4px">` : ''}
      ${r.proof_signature ? `<div>Signature: <b>${esc(r.proof_signature)}</b></div>` : ''}
      <div style="font-size:11px;color:var(--ink-soft)">${fmtDateTime(r.created_at)}</div></div>`).join('') || '<div class="alt" style="font-size:12px">No delivery records.</div>';
    const pays = (ev.payments || []).map(p => `<div class="evidence-block"><div class="t">${p.type} · ${p.status}</div><div>₱${esc(p.gross_amount)} · ${fmtDateTime(p.created_at)}</div></div>`).join('') || '—';
    this.modal(`Resolve Dispute #${id}<div style="font-size:12px;color:var(--ink-soft);margin:-4px 0 6px">${esc(d.category)} · reported by #${d.reporter_id} · ${esc(d.description || '')}</div>
      <div class="evidence-block"><div class="t">Booking ${esc(ev.booking_ref || '')} · escrow ${ev.escrow && ev.escrow.released ? 'RELEASED' : 'FROZEN'}</div>
        <div>Rental ₱${esc(ev.rental && ev.rental.fee)} · ${fmtDateTime(ev.created_at)}</div></div>
      <div class="evidence-block" style="max-height:180px;overflow:auto"><div class="t">Rental agreement</div><pre style="white-space:pre-wrap;font-size:11px;margin:0">${esc(ev.agreement ? ev.agreement.body : 'Not generated')}</pre></div>
      <div class="evidence-block"><div class="t">Condition evidence</div>${cond || '<div class="alt" style="font-size:12px">No condition records.</div>'}</div>
      <div class="evidence-block"><div class="t">Delivery proof</div>${deliv}</div>
      <div class="evidence-block"><div class="t">Chat log (<b>${(ev.chat || []).length}</b>)</div><div class="chat-log">${chat}</div></div>
      <div class="evidence-block"><div class="t">Payments</div>${pays}</div>
      <div class="form-row"><label>Outcome</label><select id="ad-status"><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></div>
      <div class="form-row"><label>Final deposit deduction (₱)</label><input id="ad-dep" type="number" min="0" placeholder="0"></div>
      <div class="form-row"><label>Resolution</label><textarea id="ad-res"></textarea></div>
      <button class="btn btn-primary btn-block" onclick="Root.adminDisputeSave(${id})">Save resolution</button>`, 'close', 'wide');
  },
  async adminDisputeSave(id) {
    const status = document.getElementById('ad-status').value;
    const resolution = document.getElementById('ad-res').value;
    const depEl = document.getElementById('ad-dep');
    const finalDepositDeduction = depEl && depEl.value !== '' ? parseInt(depEl.value, 10) : undefined;
    try { await API.post('/admin/disputes/' + id, { status, resolution, finalDepositDeduction }); this.toast('Dispute resolved', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async saveSettings() {
    const body = {
      platform_percent: document.getElementById('s-percent').value,
      platform_min_fee: document.getElementById('s-min').value,
      platform_max_fee: document.getElementById('s-max').value || '',
      featured_fee_basic: document.getElementById('s-fb').value,
      featured_fee_plus: document.getElementById('s-fp').value,
      featured_fee_premium: document.getElementById('s-fpm').value,
      free_cancellation_hours: document.getElementById('s-fc').value,
    };
    try { await API.post('/admin/settings', body); this.toast('Settings saved', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  toggleFounderBank() {
    const v = document.getElementById('fa-method').value;
    const row = document.getElementById('fa-bank-row');
    if (row) row.style.display = v === 'bank' ? '' : 'none';
  },
  async saveFounderAccount() {
    const body = {
      method: document.getElementById('fa-method').value,
      account_name: document.getElementById('fa-name').value,
      account: document.getElementById('fa-acct').value,
      bank_name: document.getElementById('fa-bank').value,
    };
    if (!body.account) { this.toast('Payout account is required', 'error'); return; }
    try { await API.post('/admin/founder', body); this.toast('Founder payout account saved', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  revLabel(k) {
    const m = { commission: '📊 Commissions', premium: '👑 Premium', featured: '🔥 Featured / Boost', extra_listing: '📦 Extra listings' };
    return m[k] || k;
  },
  async saveRefundPreference() {
    const method = document.getElementById('pp-method').value;
    const account = document.getElementById('pp-acct').value;
    const account_name = document.getElementById('pp-name').value;
    if (!account) { this.toast('Please enter your account number', 'error'); return; }
    try { await API.post('/me/payout-preference', { method, account, account_name }); this.toast('Refund preference saved', 'success'); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async broadcast() {
    const title = document.getElementById('bc-title').value;
    const body = document.getElementById('bc-body').value;
    if (!title) { this.toast('Title required', 'error'); return; }
    try { const r = await API.post('/admin/broadcast', { title, body }); this.toast('Sent to ' + r.sent + ' users', 'success'); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  async payout(id, method, account) {
    this.modal(`Mark payout #${id} as paid?<div style="font-size:13px;color:var(--ink-soft);margin-top:6px">Remit <b>${fmtMoney(0)}</b>${method ? ' via <b>' + esc(method) + '</b>' : ''}${account ? ' to <b>' + esc(account) + '</b>' : ''}. Confirm only after you have sent the money manually.</div>
      <button class="btn btn-green btn-block" onclick="Root.payoutConfirm(${id})">Yes, money sent</button>`, 'close');
  },
  async payoutConfirm(id) {
    try { await API.post('/admin/payouts/' + id, { status: 'completed' }); this.toast('Payout completed', 'success'); location.reload(); }
    catch (e) { this.toast(e.message, 'error'); }
  },
  /* ================= INFO / LANDING PAGES ================= */
  viewRent() {
    const cats = this.state.categories.slice(0, 8);
    this.$app.innerHTML = `<div class="landing-hero">
      <div class="wrap">
        <span class="hero-eyebrow">🐝 Why buy it when you can rent it?</span>
        <h1>Why Buy It If You <span>Can Rent It?</span></h1>
        <p class="sub">Get access to the things you need without buying them permanently. Rent from trusted people and businesses near you.</p>
        <div class="hero-ctas">
          <a class="btn btn-primary btn-lg" href="#/explore">🔍 Find Something to Rent</a>
        </div>
      </div>
    </div>
    <div class="wrap">
      <section class="section">
        <div class="section-head"><h2>Browse by Category</h2><a class="more" href="#/categories">View all →</a></div>
        <div class="cat-grid">${cats.map(c => this.catCard(c)).join('')}</div>
      </section>
      <section class="section">
        <div class="section-head" style="justify-content:center;text-align:center;flex-direction:column">
          <h2>The Renter Flow</h2>
          <p class="sub" style="max-width:520px;margin:10px auto 0;color:var(--ink-soft);font-size:15px">Search → Compare → Book → Pay → Rent → Return → Review</p>
        </div>
        <div class="steps" style="margin-top:24px">
          <div class="step"><div class="n">1</div><h4>Search</h4><p>Find exactly what you need near you.</p></div>
          <div class="step"><div class="n">2</div><h4>Book &amp; Pay</h4><p>Choose your dates, pay securely, refundable deposit held.</p></div>
          <div class="step"><div class="n">3</div><h4>Rent</h4><p>Pick up or get it delivered. Record condition on handover.</p></div>
          <div class="step"><div class="n">4</div><h4>Return &amp; Review</h4><p>Return on time, get your deposit back, rate each other.</p></div>
        </div>
      </section>
      <section class="section">
        <div class="ownbanner">
          <div><h2>CAN'T FIND IT?</h2><p style="opacity:.9;margin-top:6px">Post what you need and let owners come to you.</p></div>
          <div><a class="btn btn-primary btn-lg" href="#/requests">POST A RENTAL REQUEST</a></div>
        </div>
      </section>
    </div>`;
  },
  viewEarn() {
    this.$app.innerHTML = `<div class="landing-hero">
      <div class="wrap">
        <span class="hero-eyebrow">🐝 Gusto mo bang kumita ng extra income?</span>
        <h1>May gamit kang <span>nakatengga?</span></h1>
        <p class="sub">Huwag mong hayaang masayang lang. I-rent mo at kumita ng extra income.</p>
        <div class="hero-ctas">
          <a class="btn btn-primary btn-lg" href="#/list">Start Earning Today →</a>
        </div>
      </div>
    </div>
    <div class="wrap">
      <section class="section">
        <div class="section-head" style="justify-content:center;text-align:center;flex-direction:column">
          <h2>Turn Your Idle Assets Into Income</h2>
          <p class="sub" style="max-width:600px;margin:14px auto 0;color:var(--ink-soft);font-size:15px">The things you already own could be exactly what someone else needs today.</p>
        </div>
        <div class="steps" style="margin-top:24px">
          <div class="step"><div class="n">1</div><h4>List Your Item</h4><p>Upload photos, set your daily price, and describe its condition.</p></div>
          <div class="step"><div class="n">2</div><h4>Get Booked</h4><p>Verified renters find and reserve your item for their dates.</p></div>
          <div class="step"><div class="n">3</div><h4>Hand It Over</h4><p>Meet at a safe place and record condition on handover.</p></div>
          <div class="step"><div class="n">4</div><h4>Get Paid</h4><p>Funds land in your wallet after a successful rental.</p></div>
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h2>What you can earn with</h2></div>
        <div class="feature-grid">
          ${[
            ['🔨', 'May drill?', 'Rent it out per day.'], ['🔊', 'May speaker?', 'Perfect for events & parties.'], ['⛺', 'May tent?', 'Campers are always looking.'],
            ['📸', 'May camera?', 'Great for creators & students.'], ['🚗', 'May sasakyan?', 'High demand, higher value.'], ['🏗️', 'Equipment?', 'Tools, generators & more.']
          ].map(([i, t, d]) => `<div class="feature-card"><div class="icon">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
        </div>
      </section>
      <section class="section">
        <div class="ownbanner">
          <div><h2>READY TO START EARNING?</h2><p style="opacity:.9;margin-top:6px">Listing is free. You only pay a small platform fee per completed rental.</p></div>
          <div><a class="btn btn-primary btn-lg" href="#/list">Start Earning Today →</a></div>
        </div>
      </section>
    </div>`;
  },
  viewPricing() {
    this.$app.innerHTML = `<div class="landing-hero">
      <div class="wrap">
        <span class="hero-eyebrow">🐝 Simple, honest pricing</span>
        <h1>Grow Your <span>Rental Business</span></h1>
        <p class="sub">Start free and upgrade when you're ready. Only pay for what you use — with no lock-in.</p>
      </div>
    </div>
    <div class="wrap">
      <section class="section">
        <div class="pricing-grid">
          <div class="pricing-card">
            <h3>Free</h3>
            <div class="price-tag">₱0<small>/forever</small></div>
            <ul class="features">
              <li>Up to 15 active listings/month</li>
              <li>Rent items</li>
              <li>List items</li>
              <li>Basic profile &amp; reviews</li>
              <li>Basic booking management</li>
              <li>Messaging</li>
            </ul>
            <a class="btn btn-outline btn-block" href="#/register">Start Free</a>
          </div>
          <div class="pricing-card popular">
            <h3>Premium</h3>
            <div class="price-tag">₱1,499<small>/year</small></div>
            <ul class="features">
              <li>Unlimited listings</li>
              <li>Seller dashboard</li>
              <li>Track sales, gross &amp; net income</li>
              <li>Business insights to grow</li>
              <li>Priority support</li>
            </ul>
            <a class="btn btn-primary btn-block" href="#/premium">Upgrade to Premium</a>
          </div>
          <div class="pricing-card">
            <h3>Boost</h3>
            <div class="price-tag">₱49<small>/one-time</small></div>
            <ul class="features">
              <li>Feature your listing</li>
              <li>Higher visibility in search</li>
              <li>Promote any item anytime</li>
              <li>Per-listing, no subscription</li>
            </ul>
            <a class="btn btn-dark btn-block" href="#/list">Boost a Listing</a>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="detail-card" style="text-align:center">
          <h3 style="font-size:20px">Simple, transparent fees</h3>
          <p style="font-size:14px;color:var(--ink-soft);margin:10px auto 0;max-width:560px">A small 8% platform fee (min ₱20) applies per completed rental. Going over the free listing limit costs ₱10 per extra listing. Refundable security deposits are held at cost.</p>
          <div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <a class="btn btn-primary" href="#/list">Start Earning →</a>
            <a class="btn btn-outline" href="#/help">See Help Center</a>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="detail-card">
          <h3 style="font-size:20px">See what a rental actually costs</h3>
          <p style="font-size:14px;color:var(--ink-soft);margin:8px 0 18px;max-width:620px">Example: a camera rented for 2 days at ₱1,000/day.</p>
          <div class="grid-2-side">
            <div>
              <h4 style="margin-bottom:6px">Renter pays</h4>
              <div class="price-line"><span>2 days × ₱1,000/day</span><span>₱2,000</span></div>
              <div class="price-line"><span>Rental service fee (8%)</span><span>₱160</span></div>
              <div class="price-line total"><span>Rental payment</span><span>₱2,160</span></div>
              <div class="price-line deposit"><span>Refundable security deposit (returned)</span><span>₱1,000</span></div>
              <p style="font-size:12.5px;color:var(--ink-soft);margin-top:10px">The security deposit is held separately and returned when the item is returned on time and in the agreed condition.</p>
            </div>
            <div>
              <h4 style="margin-bottom:6px">Owner receives</h4>
              <div class="price-line"><span>Rental amount</span><span>₱2,000</span></div>
              <div class="price-line fee"><span>Platform fee (8%)</span><span>−₱160</span></div>
              <div class="price-line total"><span>Owner payout</span><span>₱1,840</span></div>
              <p style="font-size:12.5px;color:var(--ink-soft);margin-top:10px">No hidden fees. The full fee breakdown is shown at checkout before you pay.</p>
            </div>
          </div>
        </div>
      </section>
    </div>`;
  },
  viewTrustSafety() {
    const items = [
      ['🪪', 'Identity Verification', 'Mobile, email & government ID verification with trust levels help confirm who you\'re dealing with.'],
      ['💰', 'Secure Payments', 'Transactions are processed through supported payment providers and held securely until the rental completes.'],
      ['🔒', 'Security Deposits', 'Refundable deposits are held separately and returned according to the rental and deposit policy.'],
      ['📄', 'Rental Agreements', 'Bookings can be supported by digital rental agreements, auto-generated and signed in-app.'],
      ['⭐', 'Ratings & Reviews', 'See what other users experienced before you book. Both owners and renters leave reviews.'],
      ['📷', 'Condition Documentation', 'Photo and serial evidence at handover and return protects both owners and renters in a dispute.'],
      ['🤝', 'Dispute Resolution', 'Issues can be reported and reviewed with a full evidence trail for fair mediation.'],
      ['🔐', 'Account Security', 'We protect your account and never expose your private verification information or documents.'],
    ];
    this.$app.innerHTML = `<div class="landing-hero">
      <div class="wrap">
        <span class="hero-eyebrow">🐝 Verified users. Secure transactions. Better rentals.</span>
        <h1>Your <span>Trust</span> Matters</h1>
        <p class="sub">A safe, fair and transparent community is at the heart of GoRentHive. Here's how we protect every rental.</p>
      </div>
    </div>
    <div class="wrap">
      <section class="section">
        <div class="trust-grid">
          ${items.map(([i, t, d]) => `<div class="trust-card"><div class="icon">${i}</div><div><h4>${t}</h4><p>${d}</p></div></div>`).join('')}
        </div>
      </section>
      <section class="section"><div class="detail-card"><h3>Safety Tips</h3>
        <ul style="font-size:13.5px;color:var(--ink-soft);line-height:1.9;padding-left:18px;margin:10px 0 0">
          <li>Always record the item's condition at handover and return.</li>
          <li>Prefer public, busy meeting places — confirm them in-app.</li>
          <li>Keep all payments &amp; communication on GoRentHive.</li>
          <li>Never share your government ID or passwords.</li>
          <li>Report any suspicious behavior to our support team.</li>
        </ul>
      </div></section>
    </div>`;
  },
  viewHelp() {
    const faqs = [
      ['How do I rent an item?', 'Find an item you like, pick your dates, and pay securely. The owner approves, your deposit is held, and you collect or get the item delivered.'],
      ['How do I list an item?', 'Tap "List Your Item" in the nav, add your item details and daily price, then publish. You will start receiving booking requests right away.'],
      ['How do payments work?', 'Rental payment and refundable deposit are held securely. The owner is paid after the rental completes and the item is returned.'],
      ['How do I withdraw earnings?', 'Go to your Wallet and request a withdrawal to your GCash or bank account.'],
      ['What if an item is damaged?', 'Condition documented at handover/return protects both sides. If disputed, file a report and our team mediates with the full evidence trail.'],
    ];
    this.$app.innerHTML = `<div class="landing-hero" style="padding:60px 0 40px">
      <div class="wrap">
        <span class="hero-eyebrow">🐝 We're here to help</span>
        <h1>How Can We Help?</h1>
        <p class="sub">Answers to the questions we hear most.</p>
      </div>
    </div>
    <div class="wrap">
      <section class="section"><div class="legal-box">
        ${faqs.map(f => `<details style="padding:14px 0;border-bottom:1px solid var(--line)"><summary style="font-weight:700;cursor:pointer;font-size:14px">${f[0]}</summary><p style="font-size:13.5px;color:var(--ink-soft);margin:10px 0 0;line-height:1.7">${f[1]}</p></details>`).join('')}
      </div></section>
      <section class="section"><div class="ownbanner"><div><h2>STILL NEED HELP?</h2><p style="opacity:.9;margin-top:6px">Our team is happy to assist you.</p></div><div><a class="btn btn-primary btn-lg" href="#/contact">CONTACT SUPPORT</a></div></div></section>
    </div>`;
  },
  viewContact() {
    this.$app.innerHTML = `<div class="landing-hero" style="padding:60px 0 40px">
      <div class="wrap">
        <span class="hero-eyebrow">🐝 We'd love to hear from you</span>
        <h1>Contact Us</h1>
        <p class="sub">Our team replies within 24 hours.</p>
      </div>
    </div>
    <div class="wrap">
      <section class="section"><div class="form-card">
        <form onsubmit="Root.submitContact(event)">
          <div class="form-row"><label>Name</label><input id="ct-name" required placeholder="Your name"></div>
          <div class="form-row"><label>Email</label><input id="ct-email" type="email" required placeholder="you@email.com"></div>
          <div class="form-row"><label>Subject</label><select id="ct-subject"><option>General Inquiry</option><option>Account Issue</option><option>Booking Problem</option><option>Report a User</option><option>Partnership</option></select></div>
          <div class="form-row"><label>Message</label><textarea id="ct-msg" rows="5" required placeholder="Tell us more..."></textarea></div>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Send Message</button>
        </form>
        <p class="form-sub" style="text-align:center;margin-top:16px">📧 support@gorenthive.online · Mon-Fri, 9am-6pm PHT</p>
      </div></section>
    </div>`;
  },
  submitContact(e) {
    e.preventDefault();
    this.toast('Message sent! We\'ll reply soon.', 'success');
    e.target.reset();
  },
  viewHowItWorks() {
    this.$app.innerHTML = `<div class="landing-hero" style="padding:60px 0 40px">
      <div class="wrap">
        <span class="hero-eyebrow">🐝 Simple, safe, smart</span>
        <h1>How GoRentHive Works</h1>
        <p class="sub">Renting and earning on GoRentHive is simple. Follow these steps to get started.</p>
      </div>
    </div>
    <div class="wrap">
      <section class="section">
        <div class="section-head"><h2>How to Rent</h2></div>
        <div class="steps">
          <div class="step"><div class="n">1</div><h4>Search</h4><p>Find the item you need near you.</p></div>
          <div class="step"><div class="n">2</div><h4>Book</h4><p>Choose your dates and send your booking request.</p></div>
          <div class="step"><div class="n">3</div><h4>Rent</h4><p>Meet the owner or arrange delivery.</p></div>
          <div class="step"><div class="n">4</div><h4>Return</h4><p>Return the item and complete your rental.</p></div>
        </div>
        <div style="text-align:center;margin-top:28px"><a class="btn btn-primary btn-lg" href="#/explore">Start Renting →</a></div>
      </section>
      <section class="section">
        <div class="section-head"><h2>How to Earn</h2></div>
        <div class="steps">
          <div class="step"><div class="n">1</div><h4>List</h4><p>Upload your item with photos and a description.</p></div>
          <div class="step"><div class="n">2</div><h4>Set Your Price</h4><p>Choose your rental price and security deposit.</p></div>
          <div class="step"><div class="n">3</div><h4>Get Bookings</h4><p>Receive requests from verified renters.</p></div>
          <div class="step"><div class="n">4</div><h4>Earn</h4><p>Complete the rental and receive your payout.</p></div>
        </div>
        <div style="text-align:center;margin-top:28px"><a class="btn btn-dark btn-lg" href="#/list">List Your Item →</a></div>
      </section>
    </div>`;
  },
  viewAbout() {
    this.$app.innerHTML = `<div class="landing-hero" style="padding:60px 0 40px">
      <div class="wrap">
        <span class="hero-eyebrow">🐝 Need it? Rent it. Own it? Earn from it.</span>
        <h1>About <span>GoRentHive</span></h1>
        <p class="sub">The Philippine peer-to-peer rental marketplace.</p>
      </div>
    </div>
    <div class="wrap">
      <section class="section"><div class="detail-card">
        <p style="font-size:14px;line-height:1.8;color:var(--ink-soft);margin:0">GoRentHive is a Philippine peer-to-peer rental marketplace. We connect people who have items to spare with people who need them for a short time — without the cost of buying.</p>
        <p style="font-size:14px;line-height:1.8;color:var(--ink-soft);margin:16px 0 0">Whether it's a camera for your trip, a power drill for a home project, or chairs for your event, GoRentHive makes it easy to rent from your neighbors. And when you're not using your stuff, you can list it and turn idle items into income.</p>
      </div></section>
      <section class="section"><div class="steps">
        <div class="step"><h4>🏠 Community</h4><p>Neighbors helping neighbors rent what they need.</p></div>
        <div class="step"><h4>♻️ Sustainability</h4><p>Less buying, more sharing. Items stay in use longer.</p></div>
        <div class="step"><h4>💰 Empowerment</h4><p>Earn from what you already own.</p></div>
      </div></section>
    </div>`;
  },
};
window.Root = Root;
document.addEventListener('DOMContentLoaded', () => Root.init());
