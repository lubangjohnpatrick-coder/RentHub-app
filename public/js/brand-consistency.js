/* GoRentHive canonical brand system.
 * Keeps navigation, auth, page-title marks, favicon metadata and social defaults
 * on the same official PNG assets. Do not introduce emoji or generated logos
 * as GoRentHive identity elements.
 */
(() => {
  'use strict';

  const BRAND = Object.freeze({
    name: 'GoRentHive',
    tagline: 'Rent What You Need. Earn From What You Own.',
    mark: '/brand/gorenthive-mark.png',
    wordmark: '/brand/gorenthive-wordmark.png',
    canonical: 'https://gorenthive.online',
  });
  window.GRH_BRAND = BRAND;

  const wordmark = () => `<img src="${BRAND.wordmark}" class="brand-refresh-logo grh-wordmark" width="188" height="54" alt="${BRAND.name} — ${BRAND.tagline}">`;
  const mark = (className = 'grh-inline-brand-mark') => `<img src="${BRAND.mark}" class="${className}" width="22" height="24" alt="" aria-hidden="true">`;

  function ensureMeta(selector, attrName, attrValue, content) {
    let node = document.querySelector(selector);
    if (!node) {
      node = document.createElement('meta');
      node.setAttribute(attrName, attrValue);
      document.head.appendChild(node);
    }
    node.setAttribute('content', content);
  }

  function ensureCanonicalHead() {
    document.querySelectorAll('link[rel="icon"]').forEach((el) => {
      el.setAttribute('href', BRAND.mark);
      el.setAttribute('type', 'image/png');
    });
    let icon = document.querySelector('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      icon.type = 'image/png';
      icon.href = BRAND.mark;
      document.head.appendChild(icon);
    }
    let apple = document.querySelector('link[rel="apple-touch-icon"]');
    if (!apple) {
      apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      document.head.appendChild(apple);
    }
    apple.href = BRAND.mark;
    ensureMeta('meta[property="og:site_name"]', 'property', 'og:site_name', BRAND.name);
  }

  function normalizeBrandLink(el) {
    if (!el) return;
    el.classList.add('brand-refresh', 'grh-brand');
    el.setAttribute('aria-label', 'GoRentHive home');
    // The final aesthetic layer intentionally uses the official mark plus live
    // typography on auth screens so a white-backed wordmark PNG is never shown.
    if (el.classList.contains('grh-auth-identity') && el.querySelector('.grh-brand-lockup')) return;
    const current = el.querySelector('img.grh-wordmark');
    if (!current || current.getAttribute('src') !== BRAND.wordmark || el.querySelector('.logo')) {
      el.innerHTML = wordmark();
    }
  }

  function normalizePageTitleMarks(root = document) {
    root.querySelectorAll('.hero-eyebrow').forEach((el) => {
      if (el.querySelector('.grh-inline-brand-mark')) return;
      const raw = (el.textContent || '').trim();
      if (!raw.startsWith('🐝')) return;
      const label = raw.replace(/^🐝\s*/, '');
      el.textContent = '';
      el.insertAdjacentHTML('afterbegin', mark());
      el.append(document.createTextNode(label));
      el.classList.add('grh-canonical-eyebrow');
    });
  }

  function normalizeVisibleBranding(root = document) {
    normalizeBrandLink(root.querySelector('#topnav a.brand'));
    normalizeBrandLink(root.querySelector('.form-card a.brand, .form-card .brand'));
    root.querySelectorAll('.footer a.brand').forEach(normalizeBrandLink);
    normalizePageTitleMarks(root);

    root.querySelectorAll('img[data-brand], .grh-market-brand img').forEach((img) => {
      if (img.classList.contains('grh-wordmark')) img.src = BRAND.wordmark;
      else img.src = BRAND.mark;
    });
  }

  if (window.Root) {
    const previousRenderNav = Root.renderNav ? Root.renderNav.bind(Root) : null;
    Root.renderNav = function canonicalRenderNav() {
      if (previousRenderNav) previousRenderNav();
      normalizeVisibleBranding(document);
    };

    const previousViewAuth = Root.viewAuth ? Root.viewAuth.bind(Root) : null;
    Root.viewAuth = function canonicalViewAuth(mode) {
      if (previousViewAuth) previousViewAuth(mode);
      normalizeVisibleBranding(document);
    };

    const previousSetMeta = Root.setMeta ? Root.setMeta.bind(Root) : null;
    Root.setMeta = function canonicalSetMeta(title, description, canonicalPath) {
      if (previousSetMeta) previousSetMeta(title, description, canonicalPath);
      ensureCanonicalHead();
      const route = String(canonicalPath || '/');
      if (!route.startsWith('/listing/')) {
        ensureMeta('meta[property="og:image"]', 'property', 'og:image', BRAND.canonical + BRAND.mark);
        ensureMeta('meta[name="twitter:image"]', 'name', 'twitter:image', BRAND.canonical + BRAND.mark);
      }
    };
  }

  ensureCanonicalHead();
  normalizeVisibleBranding(document);

  const app = document.getElementById('app');
  if (app && 'MutationObserver' in window) {
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        normalizeVisibleBranding(document);
      });
    });
    observer.observe(app, { childList: true, subtree: true });
  }
})();
