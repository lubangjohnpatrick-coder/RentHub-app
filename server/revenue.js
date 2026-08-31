'use strict';

// Platform revenue accounting.
// Every commission (8%/min20), premium purchase, featured boost and extra
// listing fee is accumulated here so the platform owner can see and (later)
// withdraw earnings. Totals are stored in admin_settings as JSON.

const { svcClient } = require('./supabase');

const TOTAL_KEY = 'platform_revenue_total';
const BREAKDOWN_KEY = 'platform_revenue_breakdown';

async function read() {
  let total = 0;
  let breakdown = {};
  const { data } = await svcClient().from('admin_settings')
    .select('key,value')
    .in('key', [TOTAL_KEY, BREAKDOWN_KEY]);
  if (data) {
    for (const row of data) {
      if (row.key === TOTAL_KEY) total = Number(row.value) || 0;
      if (row.key === BREAKDOWN_KEY) { try { breakdown = JSON.parse(row.value) || {}; } catch (e) { breakdown = {}; } }
    }
  }
  return { total, breakdown };
}

// type: 'commission' | 'premium' | 'featured' | 'extra_listing'
async function addIncome(type, amount) {
  if (!amount) return;
  const { total, breakdown } = await read();
  const nextTotal = total + amount;
  const nextBreakdown = { ...breakdown, [type]: (breakdown[type] || 0) + amount };
  await svcClient().from('admin_settings').upsert([
    { key: TOTAL_KEY, value: String(nextTotal), updated_at: Date.now() },
    { key: BREAKDOWN_KEY, value: JSON.stringify(nextBreakdown), updated_at: Date.now() },
  ], { onConflict: 'key' });
  return nextTotal;
}

async function getRevenue() {
  const { total, breakdown } = await read();
  return { total, breakdown };
}

module.exports = { addIncome, getRevenue };
