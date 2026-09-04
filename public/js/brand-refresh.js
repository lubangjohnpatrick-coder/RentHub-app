/* GoRentHive visual brand refresh. Keeps marketplace behavior unchanged. */
(() => {
  if (!window.Root) return;
  const oldRenderNav = Root.renderNav ? Root.renderNav.bind(Root) : null;

  function logoHtml(compact = false) {
    return compact
      ? '<img src="/brand/gorenthive-mark.png" class="brand-refresh-mark" alt="GoRentHive">'
      : '<img src="/brand/gorenthive-wordmark.png" class="brand-refresh-logo" alt="GoRentHive — Rent What You Need. Earn From What You Own.">';
  }

  Root.renderNav = function () {
    if (oldRenderNav) oldRenderNav();
    if (!this.$topnav) return;
    const brand = this.$topnav.querySelector('.brand');
    if (brand) {
      brand.classList.add('brand-refresh');
      brand.innerHTML = logoHtml(false);
      brand.setAttribute('aria-label', 'GoRentHive home');
    }
    const nav = this.$topnav.querySelector('.nav-link-pad');
    if (nav && !nav.querySelector('.brand-nav-how')) {
      const owner = [...nav.querySelectorAll('a')].find(a => /for owners/i.test(a.textContent || ''));
      if (owner) {
        const how = document.createElement('a');
        how.className = 'brand-nav-how';
        how.href = '/how-it-works';
        how.textContent = 'How It Works';
        owner.insertAdjacentElement('afterend', how);
      }
    }
    const signup = [...this.$topnav.querySelectorAll('a')].find(a => /sign up|create account/i.test(a.textContent || ''));
    if (signup) {
      signup.textContent = 'Create Account';
      signup.classList.add('brand-cta');
    }
  };

  function refreshFooter() {
    const footer = document.querySelector('.footer');
    if (!footer) return;
    const old = footer.querySelector('.brand.logo, .brand');
    if (old) {
      old.classList.add('brand-refresh');
      old.innerHTML = logoHtml(false);
    }
  }

  const oldInit = Root.init ? Root.init.bind(Root) : null;
  if (oldInit) {
    Root.init = async function () {
      await oldInit();
      this.renderNav();
      refreshFooter();
    };
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(refreshFooter, 0));
})();
