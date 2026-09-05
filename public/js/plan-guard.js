/* GoRentHive paid-plan release guard. New Pro/Business plans are Coming Soon until all advertised features and subscription billing are production-ready. */
(() => {
  if (!window.Root) return;
  Root.viewPremium = function () {
    this.setMeta('Pro Plan — Coming Soon | GoRentHive', 'GoRentHive Pro is planned at ₱299/month. The plan is not sold until its advertised owner tools and subscription billing are production-ready.', '/premium');
    this.$app.innerHTML = `<div class="wrap grh-page-pad"><section class="detail-card" style="max-width:720px;margin:0 auto;text-align:center;padding:38px"><span class="grh-kicker-v2">PRO PLAN</span><h1 style="margin:10px 0 8px;color:var(--grh2-navy,#071b33)">₱299/month <span style="color:#a66f00">— Coming Soon</span></h1><p style="max-width:580px;margin:0 auto 22px;color:var(--ink-soft);line-height:1.65">We are not taking Pro subscription payments yet. GoRentHive will activate billing only after the full Pro feature set—multi-listing calendar, detailed analytics, promotional tools, credits, reports and priority support—is production-ready.</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn btn-primary" href="/pricing">View Plans</a><a class="btn btn-outline" href="/owner">Owner Dashboard</a></div></section></div>`;
  };
  Root.purchasePremium = function () {
    this.toast('GoRentHive Pro is still Coming Soon. No subscription charge was made.', 'info', 4500);
  };
})();
