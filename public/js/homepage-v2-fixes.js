/* Final homepage v2 integrity pass: no fake inventory, persistent dismiss, partner placeholders. */
(() => {
  if (!window.Root || !window.API) return;
  const e=(s)=>typeof esc==='function'?esc(s):String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=(v)=>typeof fmtMoney==='function'?fmtMoney(v):`₱${Number(v||0).toLocaleString('en-PH')}`;
  const oldHome=Root.viewHome.bind(Root);
  Root.viewHome=async function(){
    await oldHome();
    const stage=document.querySelector('.grh-stage-listings');
    if(stage)stage.innerHTML='<div class="grh-stage-loading"><i></i><b></b><span></span></div><div class="grh-stage-loading"><i></i><b></b><span></span></div>';
    const learning=document.querySelector('.grh-learning-v2')?.closest('.grh-home-section');
    if(learning&&!document.querySelector('.grh-partners-v2')){
      const s=document.createElement('section');s.className='grh-partners-v2';s.innerHTML=`<div class="wrap"><div><span class="grh-kicker-v2">PARTNERS & CREDIBILITY</span><h2>Verified relationships only.</h2><p>GoRentHive will show partner logos only after an active relationship and branding permission are confirmed. We do not imply that a payment processor provides insurance, escrow or protection beyond its actual service.</p></div><div class="grh-partner-placeholders"><span>Payment processing</span><span>Identity verification</span><span>Insurance</span><span>Customer support</span><span>Business associations</span></div></div>`;learning.parentNode.insertBefore(s,learning);
    }
  };
  Root.dismissAnnouncement=function(){this._announcementDismissed=true;document.querySelector('.grh-announcement')?.remove();document.body.classList.remove('has-grh-announcement');};
  const previousRenderNav=Root.renderNav.bind(Root);Root.renderNav=function(){previousRenderNav();if(this._announcementDismissed){document.querySelector('.grh-announcement')?.remove();document.body.classList.remove('has-grh-announcement');}};
  Root.hydrateHomepageListings=async function(){
    const target=document.getElementById('grh-home-listings'),stage=document.querySelector('.grh-stage-listings');if(!target&&!stage)return;
    try{
      const items=await API.get('/listings?sort=popular&limit=8');
      if(target)target.innerHTML=items.length?items.slice(0,8).map(l=>this.listingCard(l)).join(''):`<div class="grh-home-empty"><h3>No public rentals yet</h3><p>Be one of the first local owners to add useful inventory. We never create fake listings or reviews.</p><div><a class="btn btn-primary" href="/list">List Your First Item</a><a class="btn btn-outline" href="/requests">Post a Rental Request</a></div></div>`;
      if(stage){stage.innerHTML=items.length?items.slice(0,2).map(l=>{const img=l.images?.[0]||'/images/svg/placeholder.svg';const p=l.pricing?.options?.[0]||{rate:l.price_per_day,label:'/day'};return `<a class="grh-stage-real-card" href="/listing/${l.id}"><img src="${e(img)}" alt="${e(l.title)}" loading="lazy"><div><small>${e(l.location_city||'Philippines')}</small><b>${e(l.title)}</b><strong>${money(p.rate)}${e(p.label||'/day')}</strong></div></a>`;}).join(''):`<div class="grh-stage-real-empty"><b>Marketplace inventory will appear here.</b><span>Real owner listings only—no sample products or fabricated prices.</span></div>`;}
    }catch(err){if(target)target.innerHTML='<div class="grh-home-empty"><h3>Rentals could not load</h3><p>Please try again in a moment.</p><button class="btn btn-outline" onclick="Root.hydrateHomepageListings()">Try Again</button></div>';if(stage)stage.innerHTML='<div class="grh-stage-real-empty"><b>Marketplace preview unavailable.</b><span>Live inventory will return when the listing service is available.</span></div>';}
  };
})();
