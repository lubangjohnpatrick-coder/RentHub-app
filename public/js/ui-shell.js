/* GoRentHive public UI shell. Presentation only; business rules stay in domain modules. */
(() => {
  'use strict';
  if (!window.Root) return;

  const originalRenderNav = Root.renderNav ? Root.renderNav.bind(Root) : null;
  const originalViewAuth = Root.viewAuth ? Root.viewAuth.bind(Root) : null;
  const WORDMARK = '/brand/gorenthive-wordmark.png';
  const MARK = '/brand/gorenthive-mark.png';
  const escapeHtml = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#039;');
  const money = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

  const ICONS = {
    location:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/></svg>',
    radius:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>',
    camera:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l1.5-2h5L16 7h4v12H4Z"/><circle cx="12" cy="13" r="4"/></svg>',
    tools:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M13 6l2-2 5 5-2 2M4 20l8-8 3 3-8 8H4Z"/></svg>',
    outdoor:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 19 8-14 10 14Z"/><path d="m8 19 3-5 3 5"/></svg>',
    tech:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
    shield:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.7-3 8-7 10-4-2-7-5.3-7-10V6Z"/><path d="m9 12 2 2 4-5"/></svg>',
    payment:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/></svg>',
    agreement:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6Z"/><path d="M15 3v4h4M9 11h6M9 15h6"/></svg>'
  };

  const icon = (name) => `<span class="grh-line-icon">${ICONS[name] || ''}</span>`;
  const brandMarkup = () => `<img src="${WORDMARK}" class="brand-refresh-logo grh-wordmark" width="188" height="54" alt="GoRentHive — Rent What You Need. Earn From What You Own.">`;

  function enhanceNavigation(){
    const top=document.getElementById('topnav'); if(!top)return;
    const brand=top.querySelector('.brand');
    if(brand){brand.classList.add('brand-refresh','grh-brand');brand.innerHTML=brandMarkup();brand.setAttribute('aria-label','GoRentHive home');}
    const nav=top.querySelector('.nav-link-pad');
    if(nav&&!nav.querySelector('.brand-nav-how')){const owner=[...nav.querySelectorAll('a')].find(a=>/for owners/i.test(a.textContent||''));if(owner){const how=document.createElement('a');how.className='brand-nav-how';how.href='/how-it-works';how.textContent='How It Works';owner.insertAdjacentElement('afterend',how);}}
    const signup=[...top.querySelectorAll('a')].find(a=>/sign up|create account/i.test(a.textContent||''));if(signup){signup.textContent='Create Account';signup.classList.add('brand-cta');}
  }

  function enhanceAuthBranding(){
    const app=document.getElementById('app'); if(!app)return;
    const card=app.querySelector('.form-card'); if(!card)return;
    const brand=card.querySelector('.brand');
    if(brand){
      brand.classList.add('brand-refresh','grh-brand','grh-auth-brand');
      brand.innerHTML=brandMarkup();
      brand.setAttribute('aria-label','GoRentHive');
    }
  }

  function bindHomepageSearch(root){
    const input=root.querySelector('#launch-q');const button=root.querySelector('#launch-search-button');const submit=()=>typeof Root.launchSearch==='function'&&Root.launchSearch();
    input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submit();}});button?.addEventListener('click',submit);
  }

  function renderCategoryCards(categories){
    const fallback=[['📷','Cameras & Gear','camera'],['⛺','Outdoor & Camping','camping'],['🛠️','Tools & Equipment','tools'],['💻','Electronics','electronics'],['🚗','Vehicles','vehicle'],['🪑','Home & Living','home'],['🏀','Sports & Fitness','sports'],['👗','Fashion','fashion'],['🎮','Games & Hobbies','gaming']];
    if(categories.length)return categories.map(c=>`<a class="grh-category-card" href="/explore?category=${encodeURIComponent(String(c.id))}"><span class="grh-category-icon" aria-hidden="true">${escapeHtml(c.icon||'•')}</span><span>${escapeHtml(c.name)}</span></a>`).join('');
    return fallback.map(([i,n,q])=>`<a class="grh-category-card" href="/explore?q=${encodeURIComponent(q)}"><span class="grh-category-icon" aria-hidden="true">${i}</span><span>${n}</span></a>`).join('');
  }

  function realListingCard(listing){
    const img = Array.isArray(listing.images) && listing.images[0] ? listing.images[0] : '';
    const title = escapeHtml(listing.title || 'Rental listing');
    const city = escapeHtml(listing.location_city || listing.city || 'Nearby');
    return `<a href="/listing/${encodeURIComponent(String(listing.id))}" class="grh-rental-preview-card grh-real-listing-card">
      <div class="grh-preview-photo"><img src="${escapeHtml(img)}" alt="${title}" loading="lazy" decoding="async"></div>
      <div class="grh-preview-body"><strong>${title}</strong><span>${city}</span><div><b class="grh-preview-price">${money(listing.price_per_day)} <span>/ day</span></b><em>→</em></div></div>
    </a>`;
  }

  function marketplacePreview(listings = []){
    const real = listings.filter(l => l && l.id && Array.isArray(l.images) && l.images[0]).slice(0,2);
    const cards = real.length >= 2
      ? real.map(realListingCard).join('')
      : `<a href="/explore?q=camera" class="grh-rental-preview-card"><div class="grh-preview-visual grh-preview-camera">${ICONS.camera}<span>CAMERA</span></div><div class="grh-preview-body"><strong>Camera & video gear</strong><span>Browse nearby equipment</span><div><b>Explore rentals</b><em>→</em></div></div></a>
         <a href="/explore?q=tools" class="grh-rental-preview-card"><div class="grh-preview-visual grh-preview-tools">${ICONS.tools}<span>TOOLS</span></div><div class="grh-preview-body"><strong>Tools & equipment</strong><span>For projects big or small</span><div><b>Explore rentals</b><em>→</em></div></div></a>`;
    const heading = real.length >= 2 ? 'Fresh rentals from the marketplace' : 'Popular rentals around you';
    const intro = real.length >= 2
      ? 'Real GoRentHive listings are shown here automatically when owners publish photos—no fake inventory or sample pricing.'
      : 'Find what you need without buying it. Browse local items, compare options, and arrange pickup with the owner.';
    return `<div class="grh-market-preview" aria-label="Nearby rental discovery">
      <div class="grh-market-topline"><div class="grh-market-brand"><img src="${MARK}" alt="" width="44" height="44"><div><span>DISCOVER NEARBY</span><strong>${heading}</strong></div></div><span class="grh-live-pill"><i></i> GPS ready</span></div>
      <div class="grh-market-intro">${intro}</div>
      <div class="grh-rental-preview-grid">${cards}</div>
      <div class="grh-market-categories"><span>Quick browse</span><a href="/explore?q=camping">${ICONS.outdoor} Camping</a><a href="/explore?q=electronics">${ICONS.tech} Electronics</a><a href="/categories">All categories →</a></div>
      <div class="grh-market-location"><span class="grh-showcase-dot"></span><div><strong>Location-protected discovery</strong><small>Search uses your verified radius without exposing exact listing coordinates.</small></div></div>
    </div>`;
  }

  async function hydrateMarketplacePreview(root){
    const host = root.querySelector('.grh-market-preview-host');
    if (!host || !window.API) return;
    try {
      const listings = await API.get('/listings');
      if (!Array.isArray(listings)) return;
      const photoListings = listings.filter(l => l && l.status !== 'inactive' && Array.isArray(l.images) && l.images[0]);
      if (photoListings.length >= 2) host.innerHTML = marketplacePreview(photoListings);
    } catch (_) {
      // Homepage remains fully usable with category visual fallback.
    }
  }

  Root.renderNav=function(){if(originalRenderNav)originalRenderNav();enhanceNavigation();};
  Root.viewAuth=function(mode){if(originalViewAuth)originalViewAuth(mode);enhanceAuthBranding();};
  Root.viewHome=async function(){
    const categories=(this.state.categories||[]).slice(0,9);
    this.setMeta('GoRentHive | Rent What You Need. Earn From What You Own.','Find verified nearby rentals by radius in the Philippines, or earn from items you already own. Protected payments, agreements and condition documentation.','/');
    this.$app.innerHTML=`<section class="grh-home-hero" aria-labelledby="grh-home-title"><div class="wrap grh-home-grid"><div class="grh-hero-copy"><div class="grh-hero-label"><span></span> Philippine peer-to-peer rentals</div><h1 id="grh-home-title">Rent What You Need.<br><span>Earn From What You Own.</span></h1><p class="grh-hero-sub">Find useful items near you with verified-radius search—or turn equipment and everyday assets you already own into extra income.</p><div class="grh-trust-row" aria-label="GoRentHive trust features"><div>${icon('location')}<b>Nearby Rentals</b><small>Verified GPS radius</small></div><div>${icon('shield')}<b>Verified Accounts</b><small>Safer local transactions</small></div><div>${icon('payment')}<b>Protected Payments</b><small>Documented money flow</small></div><div>${icon('agreement')}<b>Digital Agreements</b><small>Clear rental terms</small></div></div></div><div class="grh-hero-showcase"><div class="grh-market-preview-host">${marketplacePreview()}</div></div></div><div class="wrap grh-search-wrap"><div class="grh-search-panel" role="search" aria-label="Search GoRentHive rentals"><div class="grh-search-field">${icon('location')}<div><span class="label">Location</span><strong>Verified device GPS</strong></div></div><div class="grh-search-field">${icon('search')}<div><label for="launch-q">What do you need?</label><input id="launch-q" autocomplete="off" placeholder="Camera, tent, drill, projector…"></div></div><div class="grh-search-field">${icon('radius')}<div><label for="launch-radius">Search radius</label><select id="launch-radius"><option value="5">Within 5 km</option><option value="10" selected>Within 10 km</option><option value="25">Within 25 km</option><option value="50">Within 50 km</option></select></div></div><button id="launch-search-button" type="button" class="grh-search-button">${ICONS.search}<span>Search Rentals</span></button></div></div></section><div class="grh-home-main"><div class="wrap"><section class="grh-owner-strip" aria-labelledby="grh-owner-title"><div class="grh-owner-symbol" aria-hidden="true">₱</div><div><h2 id="grh-owner-title">Have useful items sitting idle?</h2><p>List them, set your own price and availability, and earn when someone rents them.</p></div><a class="grh-btn grh-btn-primary" href="/list">List Your Item <span aria-hidden="true">→</span></a><div class="grh-owner-sep" aria-hidden="true"></div><div class="grh-community-proof"><p><b>One account for renting and earning</b><br>Switch between renter and owner whenever you need.</p></div></section><section class="grh-section" aria-labelledby="grh-categories-title"><div class="grh-section-head"><h2 id="grh-categories-title">Popular Categories</h2><a href="/categories">View All Categories →</a></div><div class="grh-category-grid">${renderCategoryCards(categories)}</div></section><section class="grh-closing-banner" aria-label="GoRentHive marketplace message"><div><span class="grh-closing-eyebrow">BUILT FOR LOCAL COMMUNITIES</span><h2>A smarter way to <span>rent.</span><br>A brighter way to <span>earn.</span></h2></div><img src="${WORDMARK}" alt="GoRentHive" width="188" height="54"></section></div></div>`;
    bindHomepageSearch(this.$app);
    hydrateMarketplacePreview(this.$app);
  };
})();
