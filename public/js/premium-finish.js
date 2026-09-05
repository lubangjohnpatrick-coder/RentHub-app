/* GoRentHive premium finish — small, dependency-free UX/accessibility safeguards. */
(() => {
  if (!window.Root) return;
  const ANNOUNCEMENT_KEY = 'grh:owner-announcement-dismissed';
  const HOME_STAGE_SELECTOR = '.grh-stage-listings';

  function safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }
  function safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) { /* storage may be blocked */ }
  }

  // Persist announcement dismissal for the browser session instead of restoring
  // the banner on every SPA render or refresh.
  const previousDismiss = Root.dismissAnnouncement?.bind(Root);
  Root.dismissAnnouncement = function () {
    safeSessionSet(ANNOUNCEMENT_KEY, '1');
    if (previousDismiss) previousDismiss();
    document.querySelector('.grh-announcement')?.remove();
    document.body.classList.remove('has-grh-announcement');
  };

  const previousRenderNav = Root.renderNav?.bind(Root);
  if (previousRenderNav) {
    Root.renderNav = function () {
      previousRenderNav();
      const announcement = document.querySelector('.grh-announcement');
      if (announcement) {
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-label', 'GoRentHive owner announcement');
      }
      if (safeSessionGet(ANNOUNCEMENT_KEY) === '1') {
        announcement?.remove();
        document.body.classList.remove('has-grh-announcement');
      }
    };
  }

  // Home search validation: never route with an impossible date range.
  const previousHomeSearch = Root.homeSearch?.bind(Root);
  Root.homeSearch = function () {
    const start = document.getElementById('grh-home-start')?.value || '';
    const end = document.getElementById('grh-home-end')?.value || '';
    if (start && end && end < start) {
      this.toast?.('End date must be on or after the start date.', 'warn');
      document.getElementById('grh-home-end')?.focus();
      return;
    }
    if (previousHomeSearch) previousHomeSearch();
  };

  // When the start date changes, keep the end-date minimum coherent.
  document.addEventListener('change', (event) => {
    if (event.target?.id !== 'grh-home-start') return;
    const end = document.getElementById('grh-home-end');
    if (!end) return;
    end.min = event.target.value;
    if (end.value && end.value < event.target.value) end.value = event.target.value;
  });

  // Accessible arrow-key navigation for the renter/owner how-it-works tabs.
  document.addEventListener('keydown', (event) => {
    const tab = event.target.closest?.('.grh-how-tab');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('.grh-how-tab')];
    if (!tabs.length) return;
    event.preventDefault();
    const current = tabs.indexOf(tab);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    const target = tabs[next];
    target.focus();
    target.click();
  });

  // Prevent the legacy sample stage from ever being user-visible while real
  // inventory is being hydrated. This is an integrity safeguard, not a demo.
  function scrubSampleStage(root = document) {
    const stage = root.querySelector?.(HOME_STAGE_SELECTOR);
    if (!stage) return;
    const text = stage.textContent || '';
    if (!/Camera gear|Power tools|From ₱500|From ₱350/.test(text)) return;
    stage.innerHTML = '<div class="grh-stage-loading"><i></i><b></b><span></span></div><div class="grh-stage-loading"><i></i><b></b><span></span></div>';
  }

  scrubSampleStage();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(HOME_STAGE_SELECTOR) || node.querySelector?.(HOME_STAGE_SELECTOR)) {
          scrubSampleStage(node.matches?.(HOME_STAGE_SELECTOR) ? node.parentElement || document : node);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Broken public listing images degrade gracefully instead of showing a
  // browser broken-image glyph. Private evidence images remain handled by the
  // signed-media workflow and are intentionally excluded here.
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.grhFallback === '1' || /private:\/\//.test(img.src || '')) return;
    if (!img.closest('.listing-card,.grh-stage-real-card,.grh-market-preview')) return;
    img.dataset.grhFallback = '1';
    img.src = '/images/svg/placeholder.svg';
  }, true);

  // Set lightweight semantic hints after SPA renders without changing business
  // logic or forcing additional network requests.
  function enhanceSemantics() {
    document.querySelectorAll('.grh-category-v2,.listing-card').forEach((el) => el.setAttribute('data-grh-reveal', 'scale'));
    document.querySelectorAll('.grh-home-section').forEach((section) => section.setAttribute('data-grh-section', 'true'));
    document.querySelectorAll('button[disabled]').forEach((button) => button.setAttribute('aria-disabled', 'true'));
  }
  enhanceSemantics();
  const semanticObserver = new MutationObserver(() => enhanceSemantics());
  semanticObserver.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
})();
