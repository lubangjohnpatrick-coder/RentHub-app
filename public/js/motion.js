/* GoRentHive motion controller — progressive enhancement, no animation framework required. */
(() => {
  'use strict';

  const root = document.documentElement;
  const app = document.getElementById('app');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  const revealSelector = [
    '.section-head', '.upgrade-card', '.listing-card', '.cat-card', '.detail-card', '.booking-box',
    '.price-card', '.motors-grid article', '.grh-owner-analytics', '.grh-notification',
    '.grh-saved-searches article', '.marketplace-availability', '.vehicle-public-status',
    '.vehicle-compliance-form', '.form-card', '.grh-page-head'
  ].join(',');

  root.classList.add('grh-motion-ready');

  const revealObserver = !reduceMotion && 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      }, { threshold: 0.08, rootMargin: '0px 0px -7% 0px' })
    : null;

  function revealNow(el) {
    el.classList.add('is-visible');
  }

  function registerReveal(el, index) {
    if (!el || el.dataset.grhMotionBound) return;
    el.dataset.grhMotionBound = '1';
    el.dataset.grhReveal = el.dataset.grhReveal || 'up';
    el.style.setProperty('--grh-delay', `${Math.min((index % 6) * 55, 275)}ms`);
    if (revealObserver) revealObserver.observe(el);
    else revealNow(el);
  }

  function bindTilt(el) {
    if (!finePointer || reduceMotion || !el || el.dataset.grhTiltBound) return;
    el.dataset.grhTiltBound = '1';
    el.classList.add('grh-tilt');
    const max = 2.1;
    el.addEventListener('pointermove', (event) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (event.clientX - r.left) / r.width - 0.5;
      const y = (event.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--grh-ry', `${(x * max * 2).toFixed(2)}deg`);
      el.style.setProperty('--grh-rx', `${(-y * max * 2).toFixed(2)}deg`);
    }, { passive: true });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--grh-rx', '0deg');
      el.style.setProperty('--grh-ry', '0deg');
    }, { passive: true });
  }

  function bindHero(hero) {
    if (!hero || hero.dataset.grhHeroBound) return;
    hero.dataset.grhHeroBound = '1';
    hero.classList.add('grh-hero-motion');
    if (!finePointer || reduceMotion) return;
    hero.classList.add('grh-hero-parallax');
    hero.addEventListener('pointermove', (event) => {
      const r = hero.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = ((event.clientX - r.left) / r.width - 0.5) * 12;
      const py = ((event.clientY - r.top) / r.height - 0.5) * 10;
      hero.style.setProperty('--grh-px', px.toFixed(2));
      hero.style.setProperty('--grh-py', py.toFixed(2));
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      hero.style.setProperty('--grh-px', '0');
      hero.style.setProperty('--grh-py', '0');
    }, { passive: true });
  }

  function decorate(scope = document) {
    if (!scope || !scope.querySelectorAll) return;
    const hero = scope.matches?.('.hero') ? scope : scope.querySelector('.hero');
    bindHero(hero);

    [...scope.querySelectorAll(revealSelector)].forEach(registerReveal);
    [...scope.querySelectorAll('.upgrade-card,.motors-grid article,.price-card')].forEach(bindTilt);
  }

  function pageEntrance() {
    if (!app || reduceMotion) return;
    app.classList.remove('grh-page-enter');
    void app.offsetWidth;
    app.classList.add('grh-page-enter');
    window.setTimeout(() => app.classList.remove('grh-page-enter'), 520);
  }

  let decorateTimer = 0;
  function scheduleDecorate(pageChanged) {
    clearTimeout(decorateTimer);
    decorateTimer = window.setTimeout(() => {
      decorate(app || document);
      if (pageChanged) pageEntrance();
    }, 24);
  }

  if (app && 'MutationObserver' in window) {
    new MutationObserver((mutations) => {
      const pageChanged = mutations.some((m) => m.target === app && m.type === 'childList');
      scheduleDecorate(pageChanged);
    }).observe(app, { childList: true, subtree: true });
  }

  function syncNav() {
    const nav = document.getElementById('topnav');
    if (nav) nav.classList.toggle('grh-nav-scrolled', window.scrollY > 18);
  }
  window.addEventListener('scroll', syncNav, { passive: true });
  syncNav();

  document.addEventListener('click', (event) => {
    const favorite = event.target.closest?.('.grh-favorite-btn');
    if (favorite && !reduceMotion) {
      favorite.classList.remove('grh-pop');
      void favorite.offsetWidth;
      favorite.classList.add('grh-pop');
      window.setTimeout(() => favorite.classList.remove('grh-pop'), 430);
    }
  });

  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('grh-motion-paused', document.hidden);
  });

  decorate(document);
  pageEntrance();
})();
