/* GoRentHive canonical brand lockup: transparent mark + live text, never the white-background wordmark. */
(() => {
  if (!window.Root) return;
  const lockup=(compact=false)=>`<img src="/brand/gorenthive-mark.png" alt="" width="38" height="38"><span class="grh-live-wordmark"><b>Go</b>RentHive${compact?'':'<small>Rent locally. Earn securely.</small>'}</span>`;
  const oldRender=Root.renderNav.bind(Root);
  Root.renderNav=function(){oldRender();const brand=document.querySelector('.grh-nav-brand');if(brand){brand.dataset.grhLive='1';brand.innerHTML=lockup(true);}};
  function hydrateStaticBrand(){
    const footer=document.querySelector('.footer-brand');
    if(footer&&!footer.dataset.grhLive){footer.dataset.grhLive='1';footer.classList.add('grh-live-brand');footer.innerHTML=lockup(false);}
    document.querySelectorAll('.auth-brand,.auth-logo,.login-brand').forEach(el=>{if(el.dataset.grhLive)return;if(el.querySelector('img[src*="gorenthive-wordmark"]')||/GoRentHive|🐝/.test(el.textContent||'')){el.dataset.grhLive='1';el.classList.add('grh-live-brand');el.innerHTML=lockup(false);}});
  }
  hydrateStaticBrand();
  const observer=new MutationObserver(hydrateStaticBrand);observer.observe(document.body,{subtree:true,childList:true});
})();
