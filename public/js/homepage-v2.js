/* GoRentHive homepage v2 — conversion, trust, owner recruitment and accessible discovery. */
(() => {
  if (!window.Root || !window.API) return;
  const e = (s) => typeof esc === 'function' ? esc(s) : String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (v) => typeof fmtMoney === 'function' ? fmtMoney(v) : `₱${Number(v || 0).toLocaleString('en-PH')}`;
  const svg = (name) => {
    const paths = {
      search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      map:'<path d="M9 18 3.5 21V6L9 3l6 3 5.5-3v15L15 21l-6-3Z"/><path d="M9 3v15M15 6v15"/>',
      shield:'<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
      agreement:'<path d="M6 2h9l3 3v17H6z"/><path d="M15 2v4h4M9 11h6M9 15h6"/>',
      camera:'<path d="M5 7h3l2-3h4l2 3h3a2 2 0 0 1 2 2v9H3V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>',
      tool:'<path d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-2.5 2.5-2.1-2.1a4 4 0 0 0 5 5L21 17.6 17.6 21l-8.8-8.8"/>',
      party:'<path d="m4 20 7-16 3 7 6 3-16 6Z"/><path d="M15 3h.01M19 7h.01M20 2l-2 2M12 2l1 2"/>',
      tent:'<path d="M3 20 12 4l9 16H3Z"/><path d="m12 4 4 16M8 20l4-6 4 6"/>',
      car:'<path d="m5 17-2-2v-4l2-1 2-4h10l2 4 2 1v4l-2 2H5Z"/><path d="M7 17v2M17 17v2M7 12h10"/>',
      fashion:'<path d="m8 4 4 3 4-3 3 4-3 2v10H8V10L5 8l3-4Z"/>',
      tech:'<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
      sports:'<circle cx="12" cy="12" r="9"/><path d="M5 7c4 1 8 5 10 11M17 5c-1 4-5 8-11 10"/>',
      home:'<path d="m3 11 9-8 9 8v10h-6v-6H9v6H3V11Z"/>',
      power:'<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>',
      music:'<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
      cooking:'<path d="M5 9h14v10H5z"/><path d="M8 9V6a4 4 0 0 1 8 0v3M3 12h2M19 12h2"/>',
      users:'<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 7a3 3 0 0 1 0 6M18 16a5 5 0 0 1 4 5"/>',
      wallet:'<path d="M3 6h16v14H3z"/><path d="M3 9h16M15 13h6v4h-6z"/>',
      handover:'<path d="M8 12h8M12 8l4 4-4 4"/><path d="M5 4h4v16H5M19 4h-4v16h4"/>',
      heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
      calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
      arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
      check:'<path d="m5 12 4 4L19 6"/>',
      message:'<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
      bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.home}</svg>`;
  };
  const categoryIcon = (name) => {
    const n = String(name || '').toLowerCase();
    if (/photo|video|camera|production/.test(n)) return 'camera';
    if (/tool|construction|industrial/.test(n)) return 'tool';
    if (/event|party|occasion/.test(n)) return 'party';
    if (/camp|outdoor|travel/.test(n)) return 'tent';
    if (/car|vehicle|motor/.test(n)) return 'car';
    if (/fashion|formal|clothes|costume/.test(n)) return 'fashion';
    if (/tech|electronic|computer/.test(n)) return 'tech';
    if (/sport|fitness/.test(n)) return 'sports';
    if (/cook|kitchen/.test(n)) return 'cooking';
    if (/music|instrument/.test(n)) return 'music';
    if (/power|emergency|generator/.test(n)) return 'power';
    return 'home';
  };

  Root.dismissAnnouncement = function () {
    document.querySelector('.grh-announcement')?.remove();
    document.body.classList.remove('has-grh-announcement');
  };

  const oldRenderNav = Root.renderNav.bind(Root);
  Root.renderNav = function () {
    oldRenderNav();
    const u = this.state.user;
    const top = this.$topnav;
    if (!top) return;
    const current = (location.pathname || '/').replace(/\/+$/, '') || '/';
    const accountLinks = u
      ? `<a data-nav href="/messages">Messages${this.state.unread ? `<span class="notif-dot">${this.state.unread}</span>` : ''}</a>${u.role === 'admin' ? '<a data-nav href="/admin">Admin</a>' : ''}<a data-nav href="/me" class="grh-account-link">${e((u.full_name || 'Me').split(' ')[0])}</a>`
      : `<a data-nav href="/login">Log In</a><a data-nav href="/register" class="grh-nav-signup">Create Account</a>`;
    top.innerHTML = `<div class="wrap topnav-inner grh-site-nav">
      <a href="/" class="grh-nav-brand" data-nav aria-label="GoRentHive home"><img src="/brand/gorenthive-wordmark.png" alt="GoRentHive" width="170" height="49"></a>
      <button class="menu-toggle" aria-label="Open navigation" aria-expanded="false"><span></span><span></span><span></span></button>
      <div class="nav-links"><div class="nav-link-pad">
        <a data-nav href="/explore" class="${current === '/explore' ? 'active' : ''}">Explore Rentals</a>
        <a data-nav href="/categories">Categories</a>
        <a data-nav href="/how-it-works">How It Works</a>
        <a data-nav href="/trust-safety">Trust & Safety</a>
        <a data-nav href="/pricing">Pricing</a>
        ${accountLinks}
        <a data-nav href="/list" class="grh-nav-list">List Your Item</a>
      </div></div>
    </div>`;
    if (!document.querySelector('.grh-announcement')) {
      const bar = document.createElement('div');
      bar.className = 'grh-announcement';
      bar.innerHTML = `<div class="wrap"><span><b>List your first 5 items for free.</b> Start earning from what you already own.</span><a href="/list">List an Item ${svg('arrow')}</a><button aria-label="Dismiss announcement" onclick="Root.dismissAnnouncement()">×</button></div>`;
      top.parentNode.insertBefore(bar, top);
      document.body.classList.add('has-grh-announcement');
    }
  };

  Root.homeSearch = function () {
    const q = (document.getElementById('grh-home-q')?.value || '').trim();
    const city = (document.getElementById('grh-home-city')?.value || '').trim();
    const start = document.getElementById('grh-home-start')?.value || '';
    const end = document.getElementById('grh-home-end')?.value || '';
    const radius = document.getElementById('grh-home-radius')?.value || '';
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (city) p.set('city', city);
    if (start && end) p.set('range', `${start},${end}`);
    if (radius) p.set('radius', radius);
    this.nav('/explore' + (p.toString() ? '?' + p.toString() : ''));
  };

  Root.setHowPath = function (type, btn) {
    document.querySelectorAll('.grh-how-tab').forEach(x => { x.classList.toggle('active', x.dataset.path === type); x.setAttribute('aria-selected', x.dataset.path === type ? 'true' : 'false'); });
    document.querySelectorAll('.grh-how-panel').forEach(x => x.hidden = x.dataset.path !== type);
    btn?.focus({ preventScroll: true });
  };

  Root.hydrateHomepageListings = async function () {
    const target = document.getElementById('grh-home-listings');
    if (!target) return;
    try {
      const items = await API.get('/listings?sort=popular&limit=8');
      if (!document.getElementById('grh-home-listings')) return;
      target.innerHTML = items.length
        ? items.slice(0, 8).map(l => this.listingCard(l)).join('')
        : `<div class="grh-home-empty"><span>${svg('search')}</span><h3>No public rentals yet</h3><p>Be one of the first local owners to add useful inventory. We never create fake listings or reviews.</p><div><a class="btn btn-primary" href="/list">List Your First Item</a><a class="btn btn-outline" href="/requests">Post a Rental Request</a></div></div>`;
    } catch (err) {
      target.innerHTML = `<div class="grh-home-empty"><span>${svg('search')}</span><h3>Rentals could not load</h3><p>The marketplace is temporarily unavailable. You can still browse the rest of GoRentHive.</p><button class="btn btn-outline" onclick="Root.hydrateHomepageListings()">Try Again</button></div>`;
    }
  };

  Root.viewHome = async function () {
    this.setMeta('GoRentHive | Rent What You Need. Earn From What You Own.', 'Rent useful items near you in the Philippines—or earn from equipment and belongings you already own. Verified users, protected payments, digital agreements and documented handovers.', '/');
    const cats = (this.state.categories || []).slice(0, 12);
    const categoryMarkup = cats.length ? cats.map(c => `<a class="grh-category-v2" href="/explore?category=${encodeURIComponent(c.id)}"><span>${svg(categoryIcon(c.name))}</span><strong>${e(c.name)}</strong><small>Browse rentals</small></a>`).join('') : [
      ['Photography & Videography','camera'],['Tools & Equipment','tool'],['Events & Party','party'],['Camping & Outdoor','tent'],['Cars & Vehicles','car'],['Fashion & Formal Wear','fashion'],['Technology','tech'],['Sports & Fitness','sports'],['Cooking Equipment','cooking'],['Musical Instruments','music'],['Power & Emergency','power'],['Home Equipment','home']
    ].map(([name,icon]) => `<a class="grh-category-v2" href="/explore?q=${encodeURIComponent(name)}"><span>${svg(icon)}</span><strong>${name}</strong><small>Browse rentals</small></a>`).join('');
    const today = new Date(); today.setDate(today.getDate() + 1); const tomorrow = today.toISOString().slice(0,10); const end = new Date(today.getTime() + 86400000).toISOString().slice(0,10);
    this.$app.innerHTML = `
      <section class="grh-home-hero-v2">
        <div class="wrap grh-hero-v2-grid">
          <div class="grh-hero-v2-copy" data-motion="reveal">
            <span class="grh-kicker-v2">Philippine peer-to-peer rental marketplace</span>
            <h1>Rent What You Need.<br><em>Earn From What You Own.</em></h1>
            <p>Find useful items near you—or turn equipment and everyday belongings you already own into extra income.</p>
            <div class="grh-hero-v2-actions"><a class="btn btn-primary btn-lg" href="/explore">Explore Rentals</a><a class="btn btn-outline btn-lg" href="/list">List Your Item</a></div>
            <div class="grh-hero-v2-reassure">${svg('check')} <span>Free to join. List up to 5 items. GoRentHive earns only when a completed rental earns.</span></div>
          </div>
          <div class="grh-product-stage" aria-label="GoRentHive marketplace interface preview" data-motion="reveal">
            <div class="grh-stage-browser"><div class="grh-stage-bar"><span></span><span></span><span></span><b>gorenthive.online</b></div><div class="grh-stage-search">${svg('search')} Search rentals near you</div><div class="grh-stage-listings"><article><div class="grh-stage-photo camera">${svg('camera')}</div><div><small>Photography</small><b>Camera gear</b><strong>From ₱500/day</strong></div></article><article><div class="grh-stage-photo tool">${svg('tool')}</div><div><small>Tools</small><b>Power tools</b><strong>From ₱350/day</strong></div></article></div></div>
            <div class="grh-stage-chip verified">${svg('shield')}<span><b>Verified account</b><small>Identity checks recorded</small></span></div>
            <div class="grh-stage-chip booking">${svg('calendar')}<span><b>Booking confirmed</b><small>Dates reserved</small></span></div>
            <div class="grh-stage-chip agreement">${svg('agreement')}<span><b>Agreement signed</b><small>Booking terms documented</small></span></div>
          </div>
        </div>
        <div class="wrap grh-home-search-wrap">
          <div class="grh-home-search-v2">
            <label><span>What do you need?</span><div>${svg('search')}<input id="grh-home-q" placeholder="Camera, tent, drill, projector…" onkeydown="if(event.key==='Enter')Root.homeSearch()"></div></label>
            <label><span>City or location</span><div>${svg('map')}<input id="grh-home-city" placeholder="General Trias, Cavite"></div></label>
            <label><span>Start date</span><input id="grh-home-start" type="date" min="${tomorrow}" value="${tomorrow}"></label>
            <label><span>End date</span><input id="grh-home-end" type="date" min="${tomorrow}" value="${end}"></label>
            <label><span>Radius</span><select id="grh-home-radius"><option value="">Any</option><option value="5">5 km</option><option value="10">10 km</option><option value="25">25 km</option><option value="50">50 km</option></select></label>
            <button class="btn btn-primary" onclick="Root.homeSearch()">Search Rentals</button>
          </div>
          <p class="grh-search-privacy">You can browse without GPS. Exact owner locations are never displayed publicly; verified-radius search uses private location data server-side.</p>
        </div>
      </section>

      <main class="grh-home-v2">
        <section class="wrap grh-trust-v2" aria-label="GoRentHive trust features">
          ${[['users','Verified Users','Identity and account checks help you know who you are dealing with.'],['shield','Protected Payments','Payment and payout events are documented inside the platform.'],['agreement','Digital Rental Agreements','Approved bookings receive booking-specific terms and signatures.'],['handover','Documented Handovers','Condition evidence and handover confirmations create a rental record.']].map(([icon,title,desc]) => `<button type="button" class="grh-trust-v2-card" title="${e(desc)}"><span>${svg(icon)}</span><div><b>${title}</b><small>${desc}</small></div></button>`).join('')}
        </section>

        <section class="wrap grh-home-section">
          <div class="grh-section-head-v2"><div><span>REAL MARKETPLACE INVENTORY</span><h2>Popular Rentals Near You</h2><p>Real listings only—never fabricated inventory or ratings.</p></div><a href="/explore">View All Rentals ${svg('arrow')}</a></div>
          <div id="grh-home-listings" class="card-grid grh-home-listings-v2" aria-live="polite">${Array.from({length:4},()=>'<div class="grh-listing-skeleton"><i></i><b></b><span></span><span></span></div>').join('')}</div>
        </section>

        <section class="grh-category-band-v2"><div class="wrap grh-home-section"><div class="grh-section-head-v2"><div><span>EXPLORE BY USE CASE</span><h2>What can you rent?</h2><p>From one-day needs to business equipment, browse by category.</p></div><a href="/categories">All Categories ${svg('arrow')}</a></div><div class="grh-category-grid-v2">${categoryMarkup}</div></div></section>

        <section class="wrap grh-home-section">
          <div class="grh-owner-story-v2">
            <div><span class="grh-kicker-v2">FOR LOCAL OWNERS</span><h2>May gamit kang nakatambak?<br><em>Gawin itong extra income.</em></h2><p>Ikaw ang magtatakda ng presyo, availability at handover terms. I-post ang gamit mo sa GoRentHive at kumita sa bawat completed rental.</p><div class="grh-owner-tags-v2"><span>${svg('camera')} Camera</span><span>${svg('tool')} Power tools</span><span>${svg('tent')} Camping gear</span><span>${svg('party')} Speakers & events</span><span>${svg('tech')} Projector</span><span>${svg('fashion')} Gown & costume</span><span>${svg('cooking')} Cooking equipment</span><span>${svg('music')} Instruments</span></div><div class="grh-owner-actions-v2"><a class="btn btn-primary" href="/list">List Your First Item</a><a class="btn btn-outline" href="/earn">See How Owners Earn</a></div></div>
            <aside class="grh-earnings-example-v2"><span>EXAMPLE ONLY</span><h3>What ₱500/day could look like</h3><div><small>Suggested rental price</small><b>₱500/day</b></div><div><small>4 completed rentals</small><b>₱2,000 gross</b></div><div><small>GoRentHive 8% commission</small><b>− ₱160</b></div><div class="total"><small>Estimated owner proceeds</small><b>₱1,840</b></div><p>Actual earnings depend on your pricing, demand, availability and completed bookings.</p></aside>
          </div>
        </section>

        <section class="grh-how-v2"><div class="wrap grh-home-section"><div class="grh-section-head-v2 centered"><div><span>CLEAR FROM START TO FINISH</span><h2>How GoRentHive works</h2><p>One marketplace, two simple paths.</p></div></div><div class="grh-how-tabs-v2" role="tablist" aria-label="How GoRentHive works"><button class="grh-how-tab active" data-path="renter" role="tab" aria-selected="true" onclick="Root.setHowPath('renter',this)">For Renters</button><button class="grh-how-tab" data-path="owner" role="tab" aria-selected="false" onclick="Root.setHowPath('owner',this)">For Owners</button></div>
          <div class="grh-how-panel" data-path="renter">${[['search','Search nearby','Find an item using keyword, city, category, dates or radius.'],['shield','Review the listing','Check pricing, owner profile, rules, availability and trust information.'],['calendar','Select dates & book','Choose the rental period and complete the protected booking flow.'],['handover','Confirm handover','Review condition evidence and confirm the item handover.'],['heart','Return & review','Document the return, resolve the deposit and leave a review.']].map((x,i)=>`<article><span>${i+1}</span><i>${svg(x[0])}</i><h3>${x[1]}</h3><p>${x[2]}</p></article>`).join('')}</div>
          <div class="grh-how-panel" data-path="owner" hidden>${[['users','Create & verify','Set up your account and complete the required verification level.'],['wallet','List & price','Add the item, photos, rules, pricing and availability.'],['calendar','Accept bookings','Review qualified requests and confirm the booking.'],['camera','Document condition','Capture the required before-handover evidence.'],['wallet','Complete & get paid','Confirm the return and receive the eligible owner payout.']].map((x,i)=>`<article><span>${i+1}</span><i>${svg(x[0])}</i><h3>${x[1]}</h3><p>${x[2]}</p></article>`).join('')}</div>
        </div></section>

        <section class="wrap grh-home-section">
          <div class="grh-safety-v2"><div><span class="grh-kicker-v2">TRUST & SAFETY</span><h2>Every rental documented—from booking to return.</h2><p>GoRentHive keeps important transaction steps in one record so owners and renters have more than screenshots and chat promises to rely on.</p><a class="btn btn-outline" href="/trust-safety">Explore Trust & Safety</a></div><div class="grh-safety-flow-v2">${[['users','User verification'],['shield','Secure payment processing'],['wallet','Refundable security deposit when required'],['agreement','Digital rental agreement'],['camera','Before-handover condition photos'],['check','Owner and renter confirmations'],['camera','Return-condition documentation'],['agreement','Dispute evidence'],['wallet','Payment and payout records']].map(([icon,text])=>`<div><span>${svg(icon)}</span><b>${text}</b></div>`).join('')}</div></div>
        </section>

        <section class="grh-handover-v2"><div class="wrap"><div><span class="grh-kicker-v2">HANDOVER POLICY</span><h2>You choose how the item changes hands.</h2><p>Handover or delivery is arranged directly between the owner and renter. GoRentHive records the agreed method but is not the carrier or delivery provider.</p></div><div class="grh-handover-options-v2"><span>Owner pickup location</span><span>Agreed meetup</span><span>Owner-arranged delivery</span><span>Renter-arranged third-party courier</span></div></div></section>

        <section class="wrap grh-home-section" id="pricing"><div class="grh-section-head-v2 centered"><div><span>OWNER PLANS</span><h2>Start free. Grow when the tools are ready.</h2><p>Paid plans remain unavailable until every advertised capability and subscription-billing path is production-ready.</p></div></div><div class="grh-pricing-v2">
          <article><span class="plan">FREE</span><h3>₱0<small>/month</small></h3><p>For casual owners getting started.</p><ul><li>Up to 5 active listings</li><li>Basic owner dashboard</li><li>Booking management</li><li>Messaging</li><li>Availability calendar</li><li>Payment tracking</li><li>Rental documentation</li><li>Standard support</li><li>8% commission on completed rental amounts</li></ul><a class="btn btn-outline btn-block" href="/register">Start for Free</a></article>
          <article class="featured"><span class="coming">COMING SOON</span><span class="plan">PRO</span><h3>₱299<small>/month</small></h3><p>Planned tools for active individual owners.</p><ul><li>Up to 30 active listings</li><li>Multi-listing calendar</li><li>Detailed earnings analytics</li><li>Listing views, saves & booking statistics</li><li>Bulk availability management</li><li>Promotional pricing tools</li><li>2 featured-listing credits/month</li><li>Basic owner storefront</li><li>Downloadable reports</li><li>Priority support</li></ul><button class="btn btn-primary btn-block" disabled>Join the Pro Waitlist — Soon</button></article>
          <article><span class="coming">COMING SOON</span><span class="plan">BUSINESS</span><h3>₱999<small>/month</small></h3><p>Planned controls for larger rental operations.</p><ul><li>Unlimited active listings</li><li>Branded business storefront</li><li>Inventory & asset management</li><li>Staff accounts</li><li>Branch management</li><li>Fleet/equipment tracking</li><li>Advanced reports</li><li>10 featured-listing credits/month</li><li>Business verification</li><li>Business-priority support</li></ul><a class="btn btn-outline btn-block" href="/contact">Contact GoRentHive</a></article>
        </div><p class="grh-pricing-note-v2">The 8% commission applies only to the rental amount—not to refundable security deposits or owner-arranged delivery charges.</p></section>

        <section class="grh-social-proof-v2"><div class="wrap"><div><span class="grh-kicker-v2">EARLY COMMUNITY</span><h2>Be one of the first GoRentHive owners.</h2><p>We will publish renter and owner testimonials only after they are genuine and verifiable. No fictional reviews, earnings or profile photos.</p><a class="btn btn-primary" href="/list">Become an Early Owner</a></div><aside><span>${svg('users')}</span><b>Real trust is earned, not invented.</b><p>Verified reviews will appear here as completed rentals build the community.</p></aside></div></section>

        <section class="wrap grh-home-section"><div class="grh-section-head-v2"><div><span>LEARN BEFORE YOU RENT</span><h2>Rental guides</h2><p>Practical information for safer, smarter transactions.</p></div></div><div class="grh-learning-v2">${[['wallet','How to earn from things you already own','/earn'],['shield','What to check before renting an item','/trust-safety'],['wallet','How security deposits work','/help'],['camera','How to photograph an item before handover','/how-it-works'],['search','Rent instead of buy: when renting saves money','/rent'],['calendar','Owner pricing and availability guide','/pricing']].map(([icon,title,href])=>`<a href="${href}"><span>${svg(icon)}</span><h3>${title}</h3><b>Learn more ${svg('arrow')}</b></a>`).join('')}</div></section>

        <section class="wrap grh-final-cta-v2"><article><span>NEED SOMETHING?</span><h2>Find useful rentals near you.</h2><p>Access what you need without buying something you only need temporarily.</p><a class="btn btn-primary btn-lg" href="/explore">Explore Rentals</a></article><article><span>OWN SOMETHING USEFUL?</span><h2>Turn idle items into income.</h2><p>Keep control of your pricing, availability and handover terms.</p><a class="btn btn-outline-light btn-lg" href="/list">List Your Item</a></article></section>
      </main>`;
    setTimeout(() => this.hydrateHomepageListings(), 0);
  };

  Root.viewPricing = function () {
    this.setMeta('Pricing & Fees | GoRentHive', 'Start free with up to 5 active listings. GoRentHive charges an 8% owner commission on completed rental amounts. Pro and Business plans are coming soon.', '/pricing');
    this.$app.innerHTML = `<div class="grh-pricing-page-v2"><div class="wrap"><span class="grh-kicker-v2">SIMPLE, TRANSPARENT PRICING</span><h1>Start free. <em>Upgrade only when the tools are ready.</em></h1><p class="lead">GoRentHive does not sell a subscription before the advertised capabilities are production-ready.</p><div class="grh-pricing-v2 page">${document.querySelector('#pricing .grh-pricing-v2')?.innerHTML || `<article><span class="plan">FREE</span><h3>₱0<small>/month</small></h3><p>For casual owners getting started.</p><ul><li>Up to 5 active listings</li><li>Booking management</li><li>Messaging</li><li>Availability calendar</li><li>Payment tracking</li><li>Rental documentation</li><li>8% commission on completed rental amounts</li></ul><a class="btn btn-outline btn-block" href="/register">Start for Free</a></article><article class="featured"><span class="coming">COMING SOON</span><span class="plan">PRO</span><h3>₱299<small>/month</small></h3><p>Planned tools for active owners.</p><ul><li>Up to 30 active listings</li><li>Detailed owner analytics</li><li>Multi-listing calendar</li><li>Promotional tools</li><li>Priority support</li></ul><button class="btn btn-primary btn-block" disabled>Coming Soon</button></article><article><span class="coming">COMING SOON</span><span class="plan">BUSINESS</span><h3>₱999<small>/month</small></h3><p>Planned tools for larger inventories.</p><ul><li>Unlimited active listings</li><li>Business storefront</li><li>Inventory and staff controls</li><li>Advanced reports</li><li>Business verification</li></ul><a class="btn btn-outline btn-block" href="/contact">Contact GoRentHive</a></article>`}</div><div class="grh-pricing-explain-v2"><b>Marketplace commission: 8%</b><p>The commission applies only to the rental amount after a completed rental. Refundable security deposits are separate and are not GoRentHive revenue. Owner-arranged delivery charges are also outside the commission base.</p></div></div></div>`;
  };
})();
