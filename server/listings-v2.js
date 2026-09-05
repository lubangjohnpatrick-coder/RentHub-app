'use strict';

// Public listing discovery route with AND-composed filters. Exact coordinates,
// private documents and other sensitive owner data never leave this endpoint.

const express = require('express');
const { svcClient } = require('./supabase');
const { listingRow } = require('./publicShape');
const router = express.Router();

function safeSearch(value,max=100){return String(value||'').replace(/[(),.*%_"'\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function pricingShape(p,fallbackDaily){const options=[];if(p?.hourly_enabled&&p.hourly_rate)options.push({unit:'hourly',rate:p.hourly_rate,label:'/hour'});if((p?.daily_enabled!==false)&&(p?.daily_rate||fallbackDaily))options.push({unit:'daily',rate:p?.daily_rate||fallbackDaily,label:'/day'});if(p?.weekly_enabled&&p.weekly_rate)options.push({unit:'weekly',rate:p.weekly_rate,label:'/week'});if(p?.monthly_enabled&&p.monthly_rate)options.push({unit:'monthly',rate:p.monthly_rate,label:'/month'});return{options,minimum_hours:p?.minimum_hours||1,minimum_days:p?.minimum_days||1};}

async function hydrateListings(rows){
  rows=rows||[];if(!rows.length)return[];const listingIds=[...new Set(rows.map(r=>r.id).filter(Boolean))],ownerIds=[...new Set(rows.map(r=>r.owner_id).filter(Boolean))],categoryIds=[...new Set(rows.map(r=>r.category_id).filter(Boolean))];
  const [imageRes,ownerRes,categoryRes,reviewRes,pricingRes]=await Promise.all([
    svcClient().from('listing_images').select('listing_id,url,is_primary,sort_order').in('listing_id',listingIds),
    ownerIds.length?svcClient().from('users').select('*').in('id',ownerIds):Promise.resolve({data:[],error:null}),
    categoryIds.length?svcClient().from('categories').select('id,name,icon,color').in('id',categoryIds):Promise.resolve({data:[],error:null}),
    svcClient().from('listing_reviews').select('listing_id,rating,comment,created_at,author_id').in('listing_id',listingIds),
    svcClient().from('listing_pricing').select('*').in('listing_id',listingIds),
  ]);const firstError=imageRes.error||ownerRes.error||categoryRes.error||reviewRes.error||pricingRes.error;if(firstError)throw firstError;
  const images=new Map();for(const row of imageRes.data||[]){const list=images.get(row.listing_id)||[];list.push(row);images.set(row.listing_id,list);}const owners=new Map((ownerRes.data||[]).map(row=>[row.id,row])),categories=new Map((categoryRes.data||[]).map(row=>[row.id,row])),pricing=new Map((pricingRes.data||[]).map(row=>[String(row.listing_id),row])),reviews=new Map();for(const row of reviewRes.data||[]){const list=reviews.get(row.listing_id)||[];list.push(row);reviews.set(row.listing_id,list);}
  return Promise.all(rows.map(async(row)=>{const listingImages=(images.get(row.id)||[]).slice().sort((a,b)=>Number(b.is_primary)-Number(a.is_primary)||Number(a.sort_order||0)-Number(b.sort_order||0)).map(x=>x.url),latestReviews=(reviews.get(row.id)||[]).slice().sort((a,b)=>Number(b.created_at||0)-Number(a.created_at||0)).slice(0,5).map(x=>({rating:x.rating,comment:x.comment,created_at:x.created_at,author_id:x.author_id})),out=await listingRow({row,images:listingImages,category:categories.get(row.category_id)||null,owner:owners.get(row.owner_id)||null,reviews:latestReviews});out.pricing=pricingShape(pricing.get(String(row.id)),row.price_per_day);return out;}));
}

router.get('/listings',async(req,res)=>{try{
  let query=svcClient().from('listings').select('*').eq('status','active');const owner=safeSearch(req.query.owner,80),category=safeSearch(req.query.category,80),city=safeSearch(req.query.city,80),q=safeSearch(req.query.q,100),minPrice=Number(req.query.minPrice),maxPrice=Number(req.query.maxPrice);
  if(owner)query=query.eq('owner_id',owner);if(category)query=query.eq('category_id',category);if(city)query=query.ilike('location_city',`%${city}%`);if(q)query=query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);if(Number.isFinite(minPrice)&&minPrice>=0)query=query.gte('price_per_day',minPrice);if(Number.isFinite(maxPrice)&&maxPrice>=0)query=query.lte('price_per_day',maxPrice);if(req.query.featured==='1')query=query.eq('featured',true);if(req.query.bundle==='1')query=query.eq('is_bundle',true);
  const sort=String(req.query.sort||'');if(sort==='price_asc')query=query.order('price_per_day',{ascending:true});else if(sort==='price_desc')query=query.order('price_per_day',{ascending:false});else if(sort==='popular')query=query.order('rental_count',{ascending:false});else query=query.order('featured',{ascending:false}).order('created_at',{ascending:false});const requestedLimit=Number(req.query.limit||100),limit=Math.min(100,Math.max(1,Number.isFinite(requestedLimit)?Math.floor(requestedLimit):100));const {data,error}=await query.limit(limit);if(error)return res.status(500).json({error:'Could not load rentals.'});let rows=data||[];
  if(sort==='rating'&&rows.length){const ids=rows.map(r=>r.id),{data:ratingRows,error:ratingError}=await svcClient().from('listing_reviews').select('listing_id,rating').in('listing_id',ids);if(ratingError)return res.status(500).json({error:'Could not sort rentals.'});const ratings=new Map();for(const r of ratingRows||[]){const x=ratings.get(r.listing_id)||{sum:0,count:0};x.sum+=Number(r.rating||0);x.count+=1;ratings.set(r.listing_id,x);}rows=rows.slice().sort((a,b)=>{const ar=ratings.get(a.id),br=ratings.get(b.id),aa=ar&&ar.count?ar.sum/ar.count:0,bb=br&&br.count?br.sum/br.count:0;return bb-aa;});}
  res.setHeader('Cache-Control','public, max-age=30, stale-while-revalidate=60');res.json(await hydrateListings(rows));
}catch(e){console.error(`[${req.requestId||'no-request-id'}] public listing search failed`,e);res.status(500).json({error:'Could not load rentals.',request_id:req.requestId});}});

module.exports=router;
module.exports._test={safeSearch,pricingShape};
