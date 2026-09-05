/* GoRentHive aesthetic polish — final visual normalization layer.
 * Replaces emoji-heavy utility UI with a coherent navy/gold icon system,
 * removes white-box wordmark treatments, and upgrades search/admin/owner/auth UI.
 */
(() => {
  'use strict';
  if (!window.Root) return;

  const MARK = '/brand/gorenthive-mark.png';
  const ink = '#0b1f3a';
  const gold = '#f3a712';

  const paths = {
    search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/>',
    location:'<path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
    overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6M16 7.5a2.5 2.5 0 1 1 0 5M16 14c2.6.2 4.2 1.8 4.5 5"/>',
    listing:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    dispute:'<path d="M4 8h16M8 4 4 8l4 4M16 4l4 4-4 4M12 8v12"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.6-1.4.9-1.9-2.1-2.1-1.9.9-1.4-.6L11.5 3h-3l-.7 2-1.4.6-1.9-.9-2.1 2.1.9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9 2.1 2.1 1.9-.9 1.4.6.7 2h3l.7-2 1.4-.6 1.9.9 2.1-2.1-.9-1.9.6-1.4z" transform="scale(.82) translate(2.7 2.7)"/>',
    refund:'<path d="M7 7H3v-4"/><path d="M3.5 7a9 9 0 1 1-.1 9"/>',
    payout:'<path d="M4 7h16v10H4z"/><path d="M12 4v12m-3-3 3 3 3-3"/>',
    bank:'<path d="m3 9 9-5 9 5M5 10v7M9 10v7M15 10v7M19 10v7M3 20h18"/>',
    audit:'<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/>',
    active:'<path d="M5 12h3l2-5 3 10 2-5h4"/>',
    calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/>',
    cancel:'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
    money:'<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5c-.8-.7-2-1-3.3-1-1.7 0-3 .8-3 2s1.1 1.8 3.1 2.2c2 .4 3.1 1.1 3.1 2.4 0 1.4-1.3 2.4-3.3 2.4-1.4 0-2.8-.4-3.7-1.2M12 5.8v12.4"/>',
    box:'<path d="m4 7 8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
    repeat:'<path d="M7 7h10l-2.5-2.5M17 17H7l2.5 2.5M18.5 8.5A7 7 0 0 1 19 12M5 12a7 7 0 0 1 .5-2.5"/>',
    pending:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    camera:'<path d="M4 7h4l1.5-2h5L16 7h4v12H4z"/><circle cx="12" cy="13" r="4"/>',
    outdoor:'<path d="m3 19 8-14 10 14z"/><path d="m8 19 3-5 3 5"/>',
    party:'<path d="m5 20 5-15 9 9z"/><path d="M15 4v3M19 7l2-1M17 11l3 1"/>',
    fashion:'<path d="M8 5c0 2 1.5 3 4 3s4-1 4-3l4 3-2.5 4-2-1v10h-7V11l-2 1L4 8z"/>',
    car:'<path d="m5 11 2-5h10l2 5 2 2v5h-2v2h-3v-2H8v2H5v-2H3v-5z"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/>',
    sports:'<circle cx="12" cy="12" r="9"/><path d="M7 5c3 3 4 7 3 14M17 5c-3 3-4 7-3 14M4 12h16"/>',
    tools:'<path d="m14 5 5 5M13 6l2-2 5 5-2 2M4 20l8-8 3 3-8 8H4z"/>',
    power:'<path d="M13 2 6 13h5l-1 9 8-13h-5z"/>',
    home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M10 21v-6h4v6"/>',
    baby:'<circle cx="12" cy="8" r="3"/><path d="M6 20c.7-5 2.7-8 6-8s5.3 3 6 8M8 15h8"/>',
    tech:'<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    gaming:'<path d="M7 9h10c3 0 5 2.4 5 5.5S20.5 20 18.5 20c-1.4 0-2.4-1-3.5-2H9c-1.1 1-2.1 2-3.5 2C3.5 20 2 17.6 2 14.5S4 9 7 9z"/><path d="M7 13v4M5 15h4M16 14h.1M19 16h.1"/>',
    construction:'<path d="M4 20h16M6 20V9h9v11M9 9V5h6v4M15 12h3v8"/>',
    production:'<rect x="4" y="6" width="16" height="13" rx="2"/><path d="m10 10 5 3-5 3z"/>',
    travel:'<path d="m3 11 18-7-7 18-3-8z"/><path d="m11 14 3 3"/>',
    gift:'<rect x="4" y="9" width="16" height="12" rx="1"/><path d="M12 9v12M3 9h18v4H3z"/><path d="M12 9c-4 0-6-1-6-3 0-1.2 1-2 2.2-2C10 4 12 6.5 12 9zm0 0c4 0 6-1 6-3 0-1.2-1-2-2.2-2C14 4 12 6.5 12 9z"/>',
    other:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
  };

  function svg(name, cls='') {
    return `<svg class="grh-ui-svg ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.other}</svg>`;
  }
  function iconBadge(name, tone='gold') { return `<span class="grh-ui-icon ${tone}">${svg(name)}</span>`; }
  function stripEmoji(text) {
    return String(text || '').replace(/^[\s\p{Extended_Pictographic}\uFE0F\u200D]+/u, '').trim();
  }
  function categoryIcon(label) {
    const s=String(label||'').toLowerCase();
    if (/photo|camera|video/.test(s)) return 'camera'; if (/camp|outdoor/.test(s)) return 'outdoor';
    if (/event|party|occasion/.test(s)) return /occasion/.test(s)?'gift':'party'; if (/fashion|formal|clothes|wear/.test(s)) return 'fashion';
    if (/car|vehicle|motor/.test(s)) return 'car'; if (/sport|fitness/.test(s)) return 'sports'; if (/tool|equipment/.test(s)) return 'tools';
    if (/power|emergency/.test(s)) return 'power'; if (/home/.test(s)) return 'home'; if (/baby|family/.test(s)) return 'baby';
    if (/tech|electronic/.test(s)) return 'tech'; if (/gaming|game/.test(s)) return 'gaming'; if (/construction/.test(s)) return 'construction';
    if (/production|film|studio/.test(s)) return 'production'; if (/travel/.test(s)) return 'travel'; return 'other';
  }
  function metricIcon(label) {
    const s=String(label||'').toLowerCase();
    if (/total users/.test(s)) return 'users'; if (/active \(30d\)/.test(s)) return 'active'; if (/active listings|items listed|total listings/.test(s)) return 'box';
    if (/total bookings/.test(s)) return 'calendar'; if (/active rentals/.test(s)) return 'repeat'; if (/completed/.test(s)) return 'check';
    if (/cancelled/.test(s)) return 'cancel'; if (/pending/.test(s)) return 'pending'; if (/disputes/.test(s)) return 'dispute';
    if (/gross|revenue|income|wallet|earning/.test(s)) return 'money'; return 'overview';
  }
  function navIcon(label) {
    const s=String(label||'').toLowerCase();
    if (/overview/.test(s)) return 'overview'; if (/users/.test(s)) return 'users'; if (/listings/.test(s)) return 'listing';
    if (/disputes/.test(s)) return 'dispute'; if (/fees/.test(s)) return 'settings'; if (/refund/.test(s)) return 'refund';
    if (/payout/.test(s)) return 'payout'; if (/founder/.test(s)) return 'bank'; if (/audit/.test(s)) return 'audit'; return 'overview';
  }

  function lockup(kind='default') {
    return `<span class="grh-brand-lockup ${kind}"><span class="grh-brand-mark-shell"><img src="${MARK}" alt="" aria-hidden="true"></span><span class="grh-brand-copy"><strong><span>GoRent</span><em>Hive</em></strong><small>${kind==='closing'?'Local rentals. Shared opportunity.':'Rent locally. Earn securely.'}</small></span></span>`;
  }

  function injectStyles() {
    if (document.getElementById('grh-aesthetic-polish')) return;
    const style=document.createElement('style'); style.id='grh-aesthetic-polish'; style.textContent=`
      .grh-ui-svg{width:21px;height:21px;display:block}.grh-ui-icon{width:42px;height:42px;display:inline-grid;place-items:center;border-radius:13px;flex:none;color:${ink};background:linear-gradient(145deg,#fff5d6,#ffe49a);border:1px solid rgba(243,167,18,.28);box-shadow:0 8px 18px rgba(11,31,58,.07)}.grh-ui-icon.navy{background:linear-gradient(145deg,#102d50,#0b1f3a);color:#ffd15a;border-color:rgba(255,209,90,.22)}
      .grh-brand-lockup{display:inline-flex;align-items:center;gap:11px;text-decoration:none;color:${ink};line-height:1}.grh-brand-mark-shell{width:46px;height:46px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#ffd35b,#f3a712);box-shadow:0 10px 25px rgba(243,167,18,.25);overflow:hidden}.grh-brand-mark-shell img{display:block;width:38px;height:38px;object-fit:contain;mix-blend-mode:multiply}.grh-brand-copy{display:grid;gap:4px}.grh-brand-copy strong{font-size:24px;letter-spacing:-.045em;font-style:normal}.grh-brand-copy strong span{color:${ink}}.grh-brand-copy strong em{color:#b97800;font-style:normal}.grh-brand-copy small{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#718096;font-weight:800}
      .grh-closing-banner{position:relative;overflow:hidden;isolation:isolate;background:radial-gradient(circle at 88% 18%,rgba(243,167,18,.25),transparent 27%),linear-gradient(130deg,#071a33,#0b294b 68%,#133a64)!important;border:1px solid rgba(255,255,255,.08)!important;box-shadow:0 26px 65px rgba(7,26,51,.18)!important}.grh-closing-banner:after{content:"";position:absolute;width:280px;height:280px;border:1px solid rgba(255,255,255,.08);border-radius:50%;right:-70px;bottom:-150px;box-shadow:0 0 0 48px rgba(255,255,255,.025),0 0 0 96px rgba(255,255,255,.018);z-index:-1}.grh-closing-banner h2{color:#fff!important}.grh-closing-banner h2>span{color:#ffd15a!important}.grh-closing-banner .grh-closing-eyebrow{color:#f5bd32!important}.grh-closing-brand-card{min-width:250px;padding:16px 18px;border-radius:19px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px);box-shadow:inset 0 1px rgba(255,255,255,.08)}.grh-closing-brand-card .grh-brand-copy strong span{color:#fff}.grh-closing-brand-card .grh-brand-copy strong em{color:#ffd15a}.grh-closing-brand-card .grh-brand-copy small{color:#aebed0}.grh-closing-brand-card .grh-brand-mark-shell{width:48px;height:48px}.grh-closing-brand-card .grh-brand-mark-shell img{width:39px;height:39px}
      .grh-auth-brand{min-height:0!important;margin:0 auto 22px!important;background:transparent!important}.grh-auth-brand .grh-wordmark,.grh-auth-brand>.logo,.grh-auth-brand>span:not(.grh-brand-lockup){display:none!important}.grh-auth-identity{display:flex!important;justify-content:center!important;width:100%}.grh-auth-identity .grh-brand-mark-shell{width:52px;height:52px;border-radius:17px}.grh-auth-identity .grh-brand-mark-shell img{width:42px;height:42px}.grh-auth-identity .grh-brand-copy strong{font-size:27px}.grh-auth-identity .grh-brand-copy small{font-size:9px}
      .grh-explore-polished{padding-top:26px!important}.grh-explore-polished>div:first-child:not(.grh-explore-toolbar){display:grid!important;grid-template-columns:minmax(260px,1.65fr) minmax(180px,.75fr)!important;gap:10px!important;margin-bottom:10px!important;padding:14px!important;background:#fff!important;border:1px solid #e5ebf2!important;border-radius:18px!important;box-shadow:0 12px 34px rgba(11,31,58,.07)!important}.grh-explore-polished>div:nth-child(2){display:grid!important;grid-template-columns:minmax(190px,1fr) minmax(170px,.8fr) minmax(160px,.75fr) auto auto!important;gap:9px!important;align-items:center!important;padding:0 14px 14px!important;margin-top:-10px!important;background:#fff!important;border:1px solid #e5ebf2!important;border-top:0!important;border-radius:0 0 18px 18px!important;box-shadow:0 13px 30px rgba(11,31,58,.055)!important}.grh-explore-polished input,.grh-explore-polished select{width:100%!important;min-height:46px!important;border:1px solid #dce4ee!important;border-radius:12px!important;background:#f9fbfd!important;padding:0 13px!important;color:${ink}!important;font:inherit!important;outline:0!important;transition:border-color .18s,box-shadow .18s,background .18s!important}.grh-explore-polished input:focus,.grh-explore-polished select:focus{border-color:#e5ad2b!important;background:#fff!important;box-shadow:0 0 0 4px rgba(243,167,18,.12)!important}.grh-explore-polished .btn-primary{min-height:46px!important;border-radius:12px!important;box-shadow:0 9px 22px rgba(243,167,18,.18)!important}.grh-bundle-pill{min-height:42px!important;padding:7px 11px!important;border-radius:999px!important;background:#fff8e7!important;border:1px solid #f1d99d!important;color:#72500c!important;font-size:12px!important;font-weight:750!important;white-space:nowrap}.grh-bundle-pill input{width:16px!important;min-height:16px!important;accent-color:${gold}}
      .empty .em.grh-empty-icon{font-size:0!important;background:linear-gradient(145deg,#fff4cf,#ffe29a)!important}.empty .em.grh-empty-icon .grh-ui-svg{width:29px;height:29px;color:${ink}}
      .admin-side a{display:flex!important;align-items:center!important;gap:10px!important;padding:10px 11px!important;border-radius:12px!important;margin:3px 0!important;font-weight:700!important;color:#536477!important;transition:background .18s,color .18s,transform .18s!important}.admin-side a .grh-admin-nav-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#f3f6fa;color:${ink};border:1px solid #e4eaf1}.admin-side a .grh-admin-nav-icon .grh-ui-svg{width:18px;height:18px}.admin-side a.active{background:linear-gradient(135deg,#fff4d7,#fffaf0)!important;color:${ink}!important;box-shadow:inset 0 0 0 1px #efcf80!important}.admin-side a.active .grh-admin-nav-icon{background:linear-gradient(145deg,#ffd25a,#f3a712);border-color:#efb424;box-shadow:0 8px 18px rgba(243,167,18,.2)}.admin-side a:hover{transform:translateX(2px)}
      .stat-card{position:relative!important;overflow:hidden!important;border:1px solid #e6ecf3!important;border-radius:18px!important;background:linear-gradient(155deg,#fff,#fbfcfe)!important;box-shadow:0 10px 28px rgba(11,31,58,.065)!important;padding:17px!important}.stat-card:after{content:"";position:absolute;width:80px;height:80px;border-radius:50%;right:-38px;top:-38px;background:rgba(243,167,18,.055);pointer-events:none}.stat-card>.ic{font-size:0!important;margin-bottom:12px!important}.stat-card>.ic .grh-ui-icon{width:40px;height:40px}.stat-card>.v{color:${ink}!important;font-size:24px!important;letter-spacing:-.03em!important}.stat-card>.l{color:#718096!important;font-size:11px!important;font-weight:650!important;margin-top:3px!important}.earn-hero{position:relative!important;overflow:hidden!important;background:radial-gradient(circle at 90% 10%,rgba(243,167,18,.25),transparent 30%),linear-gradient(135deg,#071a33,#123b65)!important;border-radius:24px!important;box-shadow:0 24px 55px rgba(11,31,58,.18)!important}.earn-hero:after{content:"";position:absolute;width:210px;height:210px;border-radius:50%;right:-95px;bottom:-130px;border:1px solid rgba(255,255,255,.08);box-shadow:0 0 0 42px rgba(255,255,255,.025)}
      .grh-category-card .grh-category-icon{font-size:0!important;width:48px!important;height:48px!important;display:grid!important;place-items:center!important;border-radius:15px!important;background:linear-gradient(145deg,#fff5d6,#ffe39a)!important;color:${ink}!important;border:1px solid rgba(243,167,18,.28)!important;box-shadow:0 7px 18px rgba(11,31,58,.055)!important}.grh-category-card .grh-category-icon .grh-ui-svg{width:23px;height:23px}
      .bottom-nav .bx{font-size:0!important;width:26px;height:24px;display:grid;place-items:center;color:#7b8795}.bottom-nav .bx .grh-ui-svg{width:21px;height:21px}.bottom-nav a.active .bx{color:#b67800}.bottom-nav a.active{color:${ink}!important}
      @media(max-width:800px){.grh-closing-banner{gap:22px!important}.grh-closing-brand-card{min-width:0;width:100%}.grh-explore-polished>div:first-child:not(.grh-explore-toolbar){grid-template-columns:1fr!important}.grh-explore-polished>div:nth-child(2){grid-template-columns:1fr 1fr!important;margin-top:0!important;border-top:1px solid #e5ebf2!important;border-radius:18px!important}.grh-explore-polished>div:nth-child(2) .btn-primary{grid-column:1/-1}.admin-side{overflow-x:auto!important;display:flex!important;gap:6px!important;padding-bottom:8px!important}.admin-side a{flex:0 0 auto!important}.admin-side a:hover{transform:none}.admin-side a span:last-child{white-space:nowrap}}
      @media(max-width:520px){.grh-explore-polished>div:nth-child(2){grid-template-columns:1fr!important}.grh-bundle-pill{justify-content:center!important}.grh-brand-copy strong{font-size:21px}.grh-brand-copy small{font-size:8px}.grh-closing-banner{padding:26px 22px!important}.grh-closing-banner h2{font-size:clamp(29px,9vw,38px)!important}.stat-card{padding:14px!important}.stat-card>.v{font-size:21px!important}}
      @media(prefers-reduced-motion:reduce){.admin-side a,.grh-explore-polished input,.grh-explore-polished select{transition:none!important}}
    `; document.head.appendChild(style);
  }

  function enhanceClosingBanner(root) {
    const banner=root.querySelector('.grh-closing-banner'); if(!banner)return;
    const old=banner.querySelector(':scope > img');
    if(old){const card=document.createElement('div');card.className='grh-closing-brand-card';card.innerHTML=lockup('closing');old.replaceWith(card);}
  }

  function enhanceAuth(root) {
    const card=root.querySelector('.form-card'); if(!card)return;
    const brand=card.querySelector('.brand'); if(!brand)return;
    if(brand.dataset.grhAesthetic==='1')return;
    brand.dataset.grhAesthetic='1'; brand.classList.add('grh-auth-brand','grh-auth-identity');
    brand.innerHTML=lockup('auth'); brand.setAttribute('aria-label','GoRentHive');
  }

  function enhanceExplore(root) {
    const q=root.querySelector('#ex-q'); if(!q)return;
    const section=q.closest('.section'); if(!section)return; section.classList.add('grh-explore-polished');
    q.placeholder='Search rentals…'; const city=root.querySelector('#ex-city'); if(city)city.placeholder='City or municipality';
    const cat=root.querySelector('#ex-cat'); if(cat){[...cat.options].forEach((o,i)=>{if(i>0)o.textContent=stripEmoji(o.textContent);});}
    const bundle=root.querySelector('label:has(#ex-bundle)'); if(bundle)bundle.classList.add('grh-bundle-pill');
    root.querySelectorAll('.empty .em').forEach((em)=>{if(!em.dataset.grhAesthetic){em.dataset.grhAesthetic='1';em.classList.add('grh-empty-icon');em.innerHTML=svg('search');}});
  }

  function enhanceCategories(root) {
    root.querySelectorAll('.grh-category-card').forEach(card=>{
      const holder=card.querySelector('.grh-category-icon'); if(!holder||holder.dataset.grhAesthetic)return;
      const label=card.querySelector(':scope > span:last-child')?.textContent||card.textContent; holder.dataset.grhAesthetic='1'; holder.innerHTML=svg(categoryIcon(label));
    });
  }

  function enhanceAdminIcons(root) {
    root.querySelectorAll('.admin-side a').forEach(a=>{
      if(a.dataset.grhAesthetic)return; const label=stripEmoji(a.textContent); a.dataset.grhAesthetic='1';
      a.innerHTML=`<span class="grh-admin-nav-icon">${svg(navIcon(label))}</span><span>${label}</span>`;
    });
  }

  function enhanceStats(root) {
    root.querySelectorAll('.stat-card').forEach(card=>{
      const label=card.querySelector('.l')?.textContent||''; const holder=card.querySelector('.ic'); if(!holder||holder.dataset.grhAesthetic)return;
      holder.dataset.grhAesthetic='1'; holder.innerHTML=iconBadge(metricIcon(label),/revenue|gross|income|wallet|earning/i.test(label)?'navy':'gold');
    });
  }

  function enhanceBottomNav(root=document) {
    const map={Home:'home',Explore:'search',List:'box',Chat:'users',Me:'users'};
    root.querySelectorAll('.bottom-nav a').forEach(a=>{const bx=a.querySelector('.bx');if(!bx||bx.dataset.grhAesthetic)return;bx.dataset.grhAesthetic='1';const label=stripEmoji(a.textContent).replace(/\d+$/,'').trim();bx.innerHTML=svg(map[label]||'other');});
  }
  paths.home=paths.home||'<path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M10 21v-6h4v6"/>';

  function decorate(root=document) {
    injectStyles(); enhanceClosingBanner(root); enhanceAuth(root); enhanceExplore(root); enhanceCategories(root); enhanceAdminIcons(root); enhanceStats(root); enhanceBottomNav(document);
  }

  const previousAuth=Root.viewAuth?.bind(Root); if(previousAuth)Root.viewAuth=function(mode){const out=previousAuth(mode);decorate(this.$app||document);return out;};
  const previousAdmin=Root.viewAdmin?.bind(Root); if(previousAdmin)Root.viewAdmin=async function(tab){const out=await previousAdmin(tab);decorate(this.$app||document);return out;};
  const previousOwner=Root.viewOwnerDashboard?.bind(Root); if(previousOwner)Root.viewOwnerDashboard=async function(){const out=await previousOwner();decorate(this.$app||document);return out;};
  const previousExplore=Root.viewExplore?.bind(Root); if(previousExplore)Root.viewExplore=async function(query){const out=await previousExplore(query);decorate(this.$app||document);return out;};
  const previousHome=Root.viewHome?.bind(Root); if(previousHome)Root.viewHome=async function(){const out=await previousHome();decorate(this.$app||document);return out;};

  const app=document.getElementById('app'); if(app&&'MutationObserver'in window){let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;decorate(app);});}).observe(app,{childList:true,subtree:true});}
  decorate(document);
})();
