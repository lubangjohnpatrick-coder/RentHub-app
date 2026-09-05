/* GoRentHive canonical brand lockup: transparent mark + live text, never the white-background wordmark. */
(() => {
  if (!window.Root) return;
  const lockup=(compact=false)=>`<img src="/brand/gorenthive-mark.png" alt="" width="38" height="38"><span class="grh-live-wordmark"><b>Go</b>RentHive${compact?'':'<small>Rent locally. Earn securely.</small>'}</span>`;
  const oldRender=Root.renderNav.bind(Root);
  Root.renderNav=function(){oldRender();const brand=document.querySelector('.grh-nav-brand');if(brand)brand.innerHTML=lockup(true);};
  function hydrateStaticBrand(){const footer=document.querySelector('.footer-brand');if(footer){footer.classList.add('grh-live-brand');footer.innerHTML=lockup(false);}document.querySelectorAll('.auth-brand,.auth-logo,.login-brand').forEach(el=>{if(el.querySelector('img[src*="gorenthive-wordmark"]')||/GoRentHive|🐝/.test(el.textContent||'')){el.classList.add('grh-live-brand');el.innerHTML=lockup(false);}});}
  hydrateStaticBrand();
  const observer=new MutationObserver(hydrateStaticBrand);observer.observe(document.body,{subtree:true,childList:true});
})();
