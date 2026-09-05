'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');
const { listingRow } = require('./publicShape');

const router = express.Router();
const now = () => Date.now();
const DAY_MS = 86400000;

function clean(v, max = 180) { return String(v == null ? '' : v).trim().slice(0, max); }
function money(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; }
function bool(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
function safeJson(v, fallback = []) { try { const x = JSON.parse(v || ''); return x == null ? fallback : x; } catch (_) { return fallback; } }
function coarseCoord(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }
function isVehicleName(v) { return /(^|\b)(vehicle|vehicles|car|cars|motorcycle|motorcycles|truck|trucks|van|vans)(\b|$)/i.test(String(v || '')); }

async function ownerListing(id, user) {
  const { data, error } = await svcClient().from('listings').select('id,owner_id,price_per_day,category_id,title').eq('id', Number(id)).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return { error: 'Listing not found.', status: 404 };
  if (data.owner_id !== user.id && user.role !== 'admin') return { error: 'Only the owner can change this listing.', status: 403 };
  return { listing: data };
}

async function pricingFor(listingId, fallbackDaily) {
  const { data, error } = await svcClient().from('listing_pricing').select('*').eq('listing_id', listingId).limit(1).maybeSingle();
  if (error) throw error;
  return data || {
    listing_id: Number(listingId), hourly_rate: null, daily_rate: Number(fallbackDaily || 0) || null,
    weekly_rate: null, monthly_rate: null, hourly_enabled: false, daily_enabled: true,
    weekly_enabled: false, monthly_enabled: false, minimum_hours: 1, minimum_days: 1,
  };
}
function publicPricing(p) {
  const options = [];
  if (p.hourly_enabled && p.hourly_rate) options.push({ unit: 'hourly', rate: p.hourly_rate, label: '/hour' });
  if (p.daily_enabled && p.daily_rate) options.push({ unit: 'daily', rate: p.daily_rate, label: '/day' });
  if (p.weekly_enabled && p.weekly_rate) options.push({ unit: 'weekly', rate: p.weekly_rate, label: '/week' });
  if (p.monthly_enabled && p.monthly_rate) options.push({ unit: 'monthly', rate: p.monthly_rate, label: '/month' });
  return { listing_id: p.listing_id, options, minimum_hours: p.minimum_hours || 1, minimum_days: p.minimum_days || 1 };
}

router.get('/listings/:id/pricing', async (req, res) => {
  try {
    const { data: listing } = await svcClient().from('listings').select('id,price_per_day,status').eq('id', Number(req.params.id)).limit(1).maybeSingle();
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(publicPricing(await pricingFor(listing.id, listing.price_per_day)));
  } catch (e) { console.error('pricing load failed', e); res.status(500).json({ error: 'Could not load pricing.' }); }
});

router.put('/listings/:id/pricing', requireAuth, async (req, res) => {
  try {
    const own = await ownerListing(req.params.id, req.user);
    if (own.error) return res.status(own.status).json({ error: own.error });
    const b = req.body || {};
    const dailyRate = money(b.daily_rate) || Number(own.listing.price_per_day || 0);
    const row = {
      listing_id: own.listing.id,
      hourly_rate: money(b.hourly_rate), daily_rate: dailyRate, weekly_rate: money(b.weekly_rate), monthly_rate: money(b.monthly_rate),
      hourly_enabled: bool(b.hourly_enabled) && !!money(b.hourly_rate), daily_enabled: b.daily_enabled !== false,
      weekly_enabled: bool(b.weekly_enabled) && !!money(b.weekly_rate), monthly_enabled: bool(b.monthly_enabled) && !!money(b.monthly_rate),
      minimum_hours: Math.min(168, Math.max(1, Number(b.minimum_hours) || 1)), minimum_days: Math.min(365, Math.max(1, Number(b.minimum_days) || 1)), updated_at: now(),
    };
    if (!row.hourly_enabled && !row.daily_enabled && !row.weekly_enabled && !row.monthly_enabled) return res.status(400).json({ error: 'Enable at least one pricing option.' });
    const { data, error } = await svcClient().from('listing_pricing').upsert(row, { onConflict: 'listing_id' }).select().single();
    if (error) throw error;
    if (row.daily_enabled && row.daily_rate && row.daily_rate !== own.listing.price_per_day) await svcClient().from('listings').update({ price_per_day: row.daily_rate, updated_at: now() }).eq('id', own.listing.id);
    res.json({ ok: true, pricing: publicPricing(data) });
  } catch (e) { console.error('pricing save failed', e); res.status(500).json({ error: 'Could not save pricing.' }); }
});

async function hydrateListingIds(ids) {
  if (!ids.length) return [];
  const { data: rows, error } = await svcClient().from('listings').select('*').in('id', ids).eq('status', 'active');
  if (error) throw error;
  const listingIds = (rows || []).map((x) => x.id);
  if (!listingIds.length) return [];
  const ownerIds = [...new Set((rows || []).map((x) => x.owner_id))];
  const catIds = [...new Set((rows || []).map((x) => x.category_id).filter(Boolean))];
  const [imgs, owners, cats, prices] = await Promise.all([
    svcClient().from('listing_images').select('listing_id,url,is_primary,sort_order').in('listing_id', listingIds),
    svcClient().from('users').select('*').in('id', ownerIds),
    catIds.length ? svcClient().from('categories').select('id,name,icon,color').in('id', catIds) : Promise.resolve({ data: [] }),
    svcClient().from('listing_pricing').select('*').in('listing_id', listingIds),
  ]);
  const ownerMap = new Map((owners.data || []).map((x) => [x.id, x]));
  const catMap = new Map((cats.data || []).map((x) => [x.id, x]));
  const priceMap = new Map((prices.data || []).map((x) => [String(x.listing_id), x]));
  const imgMap = new Map();
  for (const x of imgs.data || []) { const a = imgMap.get(String(x.listing_id)) || []; a.push(x); imgMap.set(String(x.listing_id), a); }
  const out = [];
  for (const row of rows || []) {
    const images = (imgMap.get(String(row.id)) || []).sort((a,b) => Number(b.is_primary)-Number(a.is_primary) || Number(a.sort_order)-Number(b.sort_order)).map((x) => x.url);
    const shaped = await listingRow({ row, images, category: catMap.get(row.category_id) || null, owner: ownerMap.get(row.owner_id) || null, reviews: [] });
    shaped.pricing = publicPricing(priceMap.get(String(row.id)) || await pricingFor(row.id, row.price_per_day));
    out.push(shaped);
  }
  return ids.map((id) => out.find((x) => String(x.id) === String(id))).filter(Boolean);
}

router.get('/favorites/mine', requireAuth, async (req, res) => {
  try {
    const { data, error } = await svcClient().from('favorites').select('listing_id,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(await hydrateListingIds((data || []).map((x) => x.listing_id)));
  } catch (e) { res.status(500).json({ error: 'Could not load favorites.' }); }
});
router.get('/favorites/status/:listingId', requireAuth, async (req, res) => {
  const { data } = await svcClient().from('favorites').select('id').eq('user_id', req.user.id).eq('listing_id', Number(req.params.listingId)).limit(1).maybeSingle();
  res.json({ favorited: !!data });
});

router.get('/listings/map', async (req, res) => {
  try {
    let q = svcClient().from('listings').select('id,title,price_per_day,location_city,location_province,latitude,longitude,category_id,owner_id,status').eq('status', 'active').not('latitude','is',null).not('longitude','is',null);
    const city = clean(req.query.city, 80), keyword = clean(req.query.q, 80), category = Number(req.query.category);
    if (city) q = q.ilike('location_city', `%${city.replace(/[%_]/g,'')}%`);
    if (category) q = q.eq('category_id', category);
    if (keyword) q = q.or(`title.ilike.%${keyword.replace(/[(),.%_'"\\]/g,' ')}%`);
    const { data, error } = await q.limit(100);
    if (error) throw error;
    const rows = data || [];
    const catIds = [...new Set(rows.map((x) => x.category_id).filter(Boolean))];
    const ids = rows.map((x) => x.id);
    const [cats, images, compliance, pricing] = await Promise.all([
      catIds.length ? svcClient().from('categories').select('id,name,icon').in('id', catIds) : Promise.resolve({ data: [] }),
      ids.length ? svcClient().from('listing_images').select('listing_id,url,is_primary,sort_order').in('listing_id', ids) : Promise.resolve({ data: [] }),
      ids.length ? svcClient().from('vehicle_compliance').select('listing_id,status,or_cr_verified,ltfrb_verified,insurance_verified,ctpl_verified,rental_use_covered,or_cr_expiry,ltfrb_expiry,insurance_expiry,ctpl_expiry').in('listing_id', ids) : Promise.resolve({ data: [] }),
      ids.length ? svcClient().from('listing_pricing').select('*').in('listing_id', ids) : Promise.resolve({ data: [] }),
    ]);
    const catMap = new Map((cats.data || []).map((x) => [x.id,x]));
    const imgMap = new Map(); for (const x of images.data || []) { const a=imgMap.get(String(x.listing_id))||[]; a.push(x); imgMap.set(String(x.listing_id),a); }
    const compMap = new Map((compliance.data || []).map((x) => [String(x.listing_id),x]));
    const priceMap = new Map((pricing.data || []).map((x) => [String(x.listing_id),x]));
    const isCurrentVehicle = (c) => c && c.status === 'verified' && c.or_cr_verified && c.ltfrb_verified && c.insurance_verified && c.ctpl_verified && c.rental_use_covered && [c.or_cr_expiry,c.ltfrb_expiry,c.insurance_expiry,c.ctpl_expiry].every((v) => Number(v) > now());
    const points = [];
    for (const row of rows) {
      const cat = catMap.get(row.category_id);
      if (isVehicleName(cat && cat.name) && !isCurrentVehicle(compMap.get(String(row.id)))) continue;
      const pics = (imgMap.get(String(row.id)) || []).sort((a,b)=>Number(b.is_primary)-Number(a.is_primary)||Number(a.sort_order)-Number(b.sort_order));
      const p = priceMap.get(String(row.id)) || await pricingFor(row.id,row.price_per_day);
      points.push({ id: row.id, title: row.title, city: row.location_city || '', province: row.location_province || '', approx_lat: coarseCoord(row.latitude), approx_lng: coarseCoord(row.longitude), image: pics[0] ? pics[0].url : '', category: cat ? cat.name : '', category_icon: cat ? cat.icon : '', pricing: publicPricing(p), location_precision: 'approximate' });
    }
    res.setHeader('Cache-Control','public, max-age=30, stale-while-revalidate=60');
    res.json({ points, privacy: 'Map pins are intentionally approximate. Exact meetup details are shared only after an approved booking.' });
  } catch (e) { console.error('map listings failed', e); res.status(500).json({ error: 'Could not load the map.' }); }
});

router.get('/saved-searches', requireAuth, async (req, res) => {
  const { data, error } = await svcClient().from('saved_searches').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load saved searches.' });
  res.json(data || []);
});
router.post('/saved-searches', requireAuth, async (req, res) => {
  const b = req.body || {};
  const row = { user_id: req.user.id, name: clean(b.name || b.query_text || 'Saved search',80), query_text: clean(b.query_text,100), category_id: Number(b.category_id)||null, city: clean(b.city,80), radius_km: Number(b.radius_km)||null, max_price: money(b.max_price), alerts_enabled: b.alerts_enabled !== false, last_checked_at: now(), created_at: now(), updated_at: now() };
  const { data, error } = await svcClient().from('saved_searches').insert(row).select().single();
  if (error) return res.status(500).json({ error: 'Could not save search.' });
  res.json({ ok:true, search:data });
});
router.delete('/saved-searches/:id', requireAuth, async (req,res) => {
  await svcClient().from('saved_searches').delete().eq('id',Number(req.params.id)).eq('user_id',req.user.id); res.json({ok:true});
});

async function refreshSavedSearchAlerts(userId) {
  const pref = await svcClient().from('notification_preferences').select('saved_search_alerts').eq('user_id', userId).limit(1).maybeSingle();
  if (pref.data && pref.data.saved_search_alerts === false) return;
  const { data: searches } = await svcClient().from('saved_searches').select('*').eq('user_id',userId).eq('alerts_enabled',true).limit(20);
  for (const s of searches || []) {
    let q = svcClient().from('listings').select('id,title,location_city,price_per_day,created_at').eq('status','active').gt('created_at', Number(s.last_checked_at || 0)).limit(10);
    if (s.category_id) q=q.eq('category_id',s.category_id);
    if (s.city) q=q.ilike('location_city',`%${String(s.city).replace(/[%_]/g,'')}%`);
    if (s.max_price != null) q=q.lte('price_per_day',s.max_price);
    if (s.query_text) { const k=String(s.query_text).replace(/[(),.%_'"\\]/g,' '); q=q.or(`title.ilike.%${k}%,description.ilike.%${k}%`); }
    const { data: matches }=await q;
    for (const l of matches || []) {
      await svcClient().from('notifications').upsert({ user_id:userId,type:'saved_search',title:'New rental matches your saved search',body:`${l.title} is now available in ${l.location_city || 'your area'}.`,link:`#/listing/${l.id}`,dedupe_key:`saved-search:${s.id}:listing:${l.id}`,is_read:false,created_at:now() },{onConflict:'user_id,dedupe_key'});
    }
    await svcClient().from('saved_searches').update({last_checked_at:now(),updated_at:now()}).eq('id',s.id).eq('user_id',userId);
  }
}

router.get('/notifications/pro', requireAuth, async (req,res) => {
  try {
    await refreshSavedSearchAlerts(req.user.id);
    const { data,error }=await svcClient().from('notifications').select('*').eq('user_id',req.user.id).order('created_at',{ascending:false}).limit(100);
    if(error) throw error;
    const unread=(data||[]).filter((x)=>!x.is_read).length;
    res.json({notifications:data||[],unread});
  } catch(e){console.error('notification center failed',e);res.status(500).json({error:'Could not load notifications.'});}
});
router.post('/notifications/pro/read', requireAuth, async (req,res)=>{
  let q=svcClient().from('notifications').update({is_read:true}).eq('user_id',req.user.id);
  if(req.body && req.body.id) q=q.eq('id',Number(req.body.id));
  await q; res.json({ok:true});
});
router.get('/notifications/preferences', requireAuth, async (req,res)=>{
  const {data}=await svcClient().from('notification_preferences').select('*').eq('user_id',req.user.id).limit(1).maybeSingle();
  res.json(data||{user_id:req.user.id,booking_updates:true,messages:true,saved_search_alerts:true,reminders:true,owner_opportunities:true});
});
router.put('/notifications/preferences', requireAuth, async (req,res)=>{
  const b=req.body||{}; const row={user_id:req.user.id,booking_updates:b.booking_updates!==false,messages:b.messages!==false,saved_search_alerts:b.saved_search_alerts!==false,reminders:b.reminders!==false,owner_opportunities:b.owner_opportunities!==false,updated_at:now()};
  const {data,error}=await svcClient().from('notification_preferences').upsert(row,{onConflict:'user_id'}).select().single(); if(error)return res.status(500).json({error:'Could not save notification preferences.'}); res.json({ok:true,preferences:data});
});

router.get('/owner/analytics/pro', requireAuth, async (req,res)=>{
  try {
    const owner=req.user.id; const since90=now()-90*DAY_MS; const monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);
    const [listRes,bookRes]=await Promise.all([svcClient().from('listings').select('id,title,view_count,favorite_count,rental_count,status,created_at').eq('owner_id',owner),svcClient().from('bookings').select('id,listing_id,status,rental_fee,amount_due_owner,rental_days,created_at,start_date,end_date').eq('owner_id',owner)]);
    if(listRes.error||bookRes.error)throw listRes.error||bookRes.error;
    const listings=listRes.data||[], bookings=bookRes.data||[], completed=bookings.filter((b)=>b.status==='completed');
    const allTimeEarnings=completed.reduce((s,b)=>s+Number(b.amount_due_owner||0),0); const monthEarnings=completed.filter((b)=>Number(b.created_at)>=monthStart.getTime()).reduce((s,b)=>s+Number(b.amount_due_owner||0),0);
    const requests=bookings.filter((b)=>!['cancelled','rejected','refunded'].includes(b.status)); const accepted=bookings.filter((b)=>['approved','active','returned','completed','disputed'].includes(b.status));
    const recentDays=completed.filter((b)=>Number(b.end_date)>=since90).reduce((s,b)=>s+Math.max(1,Number(b.rental_days||1)),0); const capacity=Math.max(1,listings.filter((l)=>l.status==='active').length*90);
    const top=listings.map((l)=>{const bs=completed.filter((b)=>b.listing_id===l.id);return{id:l.id,title:l.title,earnings:bs.reduce((s,b)=>s+Number(b.amount_due_owner||0),0),rentals:bs.length,views:l.view_count||0,favorites:l.favorite_count||0};}).sort((a,b)=>b.earnings-a.earnings).slice(0,5);
    res.json({month_earnings:monthEarnings,all_time_earnings:allTimeEarnings,completed_rentals:completed.length,active_listings:listings.filter((l)=>l.status==='active').length,average_booking:completed.length?Math.round(completed.reduce((s,b)=>s+Number(b.rental_fee||0),0)/completed.length):0,acceptance_rate:requests.length?Math.round(accepted.length/requests.length*100):100,utilization_90d:Math.min(100,Math.round(recentDays/capacity*100)),total_views:listings.reduce((s,l)=>s+Number(l.view_count||0),0),total_favorites:listings.reduce((s,l)=>s+Number(l.favorite_count||0),0),top_items:top});
  }catch(e){console.error('owner analytics failed',e);res.status(500).json({error:'Could not load owner analytics.'});}
});

router.get('/business/verification', requireAuth, async (req,res)=>{const {data}=await svcClient().from('business_verifications').select('*').eq('user_id',req.user.id).limit(1).maybeSingle();res.json({verification:data||null,is_business:!!req.user.is_business});});
router.put('/business/verification', requireAuth, async (req,res)=>{
  const b=req.body||{}; const row={user_id:req.user.id,legal_name:clean(b.legal_name,180),registration_type:clean(b.registration_type,12).toUpperCase(),registration_reference:clean(b.registration_reference,120),tin_last4:clean(b.tin_last4,4),business_address:clean(b.business_address,300),business_city:clean(b.business_city,100),contact_email:clean(b.contact_email,160),contact_phone:clean(b.contact_phone,40),status:'pending',reviewer_id:null,review_notes:'',reviewed_at:null,updated_at:now()};
  if(!row.legal_name||!['DTI','SEC','CDA','OTHER'].includes(row.registration_type)||!row.registration_reference||row.tin_last4.length!==4||!row.business_address||!row.business_city||!row.contact_email||!row.contact_phone)return res.status(400).json({error:'Complete the business verification form. Only the last four TIN digits are stored in this workflow.'});
  const {data,error}=await svcClient().from('business_verifications').upsert(row,{onConflict:'user_id'}).select().single();if(error)return res.status(500).json({error:'Could not submit business verification.'});res.json({ok:true,verification:data});
});
router.post('/admin/business/verification/:userId/verify', requireAuth, async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});const rejected=req.body&&req.body.decision==='rejected';const status=rejected?'rejected':'verified';const {data,error}=await svcClient().from('business_verifications').update({status,reviewer_id:req.user.id,review_notes:clean(req.body&&req.body.review_notes,1000),reviewed_at:now(),updated_at:now()}).eq('user_id',req.params.userId).select().single();if(error)return res.status(500).json({error:'Could not review business.'});await svcClient().from('users').update({is_business:status==='verified',updated_at:now()}).eq('id',req.params.userId);res.json({ok:true,verification:data});});

router.get('/vehicles/:listingId/terms', async(req,res)=>{const {data}=await svcClient().from('vehicle_rental_terms').select('*').eq('listing_id',Number(req.params.listingId)).limit(1).maybeSingle();if(!data)return res.json({listing_id:Number(req.params.listingId),mileage_allowance_km:0,excess_mileage_fee:0,fuel_policy:'same_level',geographic_restrictions:'',prohibited_tnvs:true,prohibited_courier:true,prohibited_racing:true,prohibited_sublease:true,prohibited_unauthorized_driver:true,prohibited_outside_zone:true});const safe={...data};delete safe.accident_procedure;delete safe.damage_procedure;delete safe.traffic_ticket_liability;delete safe.toll_liability;delete safe.impoundment_liability;res.json(safe);});
router.put('/vehicles/:listingId/terms', requireAuth, async(req,res)=>{const own=await ownerListing(req.params.listingId,req.user);if(own.error)return res.status(own.status).json({error:own.error});const b=req.body||{};const row={listing_id:own.listing.id,mileage_allowance_km:Math.max(0,Number(b.mileage_allowance_km)||0),excess_mileage_fee:Math.max(0,Number(b.excess_mileage_fee)||0),fuel_policy:clean(b.fuel_policy||'same_level',60),geographic_restrictions:clean(b.geographic_restrictions,500),accident_procedure:clean(b.accident_procedure,1200)||'Stop safely, contact emergency services when needed, document the scene, and notify the owner and GoRentHive promptly.',damage_procedure:clean(b.damage_procedure,1200)||'Document damage in-app and preserve all evidence for owner and platform review.',traffic_ticket_liability:clean(b.traffic_ticket_liability,800)||'The authorized driver is responsible for traffic violations incurred during the rental period, subject to applicable law.',toll_liability:clean(b.toll_liability,800)||'The renter is responsible for tolls incurred during the rental period.',impoundment_liability:clean(b.impoundment_liability,800)||'Costs caused by renter misuse or violations may be charged subject to evidence, agreement terms and applicable law.',prohibited_tnvs:true,prohibited_courier:true,prohibited_racing:true,prohibited_sublease:true,prohibited_unauthorized_driver:true,prohibited_outside_zone:true,updated_at:now()};const {data,error}=await svcClient().from('vehicle_rental_terms').upsert(row,{onConflict:'listing_id'}).select().single();if(error)return res.status(500).json({error:'Could not save vehicle rules.'});res.json({ok:true,terms:data});});

router.post('/vehicles/incidents', requireAuth, async(req,res)=>{const b=req.body||{},bookingId=Number(b.booking_id);const {data:booking}=await svcClient().from('bookings').select('id,renter_id,owner_id').eq('id',bookingId).limit(1).maybeSingle();if(!booking)return res.status(404).json({error:'Booking not found.'});if(![booking.renter_id,booking.owner_id].includes(req.user.id)&&req.user.role!=='admin')return res.status(403).json({error:'Not your booking.'});const evidence=Array.isArray(b.evidence)?b.evidence.filter((x)=>String(x).startsWith('private://rental-evidence/')).slice(0,12):[];const {data,error}=await svcClient().from('vehicle_incidents').insert({booking_id:bookingId,reporter_id:req.user.id,incident_type:clean(b.incident_type,80),description:clean(b.description,2000),location_city:clean(b.location_city,100),evidence:JSON.stringify(evidence),police_report_reference:clean(b.police_report_reference,120),insurance_reference:clean(b.insurance_reference,120),status:'open',created_at:now(),updated_at:now()}).select().single();if(error)return res.status(500).json({error:'Could not submit incident.'});res.json({ok:true,incident:data});});

module.exports=router;
module.exports._test={clean,money,coarseCoord,isVehicleName,publicPricing};
