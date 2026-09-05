'use strict';

// Launch-safe booking endpoints with category-configurable hourly/daily/weekly/monthly pricing.
// GoRentHive does not operate delivery. Renter pays rental + refundable deposit;
// the platform commission is deducted from owner earnings. Funds reservation is atomic.

const express=require('express');
const crypto=require('crypto');
const {svcClient}=require('./supabase');
const {requireAuth}=require('./auth-service');
const settings=require('./settings');
const ledger=require('./ledger');
const payment=require('./payment');
const {PaymongoProvider,returnUrl}=require('./providers/paymongo');

const router=express.Router();
const HOUR_MS=60*60*1000,DAY_MS=24*HOUR_MS;
const now=()=>Date.now();
function parseJson(s,fallback={}){try{return JSON.parse(s||'{}');}catch(_){return fallback;}}
function normalizeUnit(v){return ['hourly','daily','weekly','monthly'].includes(String(v||'').toLowerCase())?String(v).toLowerCase():'daily';}
function validatePeriod(startInput,endInput){
  const start=new Date(startInput).getTime(),end=new Date(endInput).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end))return{ok:false,status:400,error:'Please enter valid rental dates/times.',code:'invalid_date'};
  if(end<start)return{ok:false,status:400,error:'The end must be on or after the start.',code:'date_order'};
  if(start<now()-60*60*1000)return{ok:false,status:400,error:'The rental start cannot be in the past.',code:'past_date'};
  const rawHours=Math.max(0,(end-start)/HOUR_MS),hours=Math.max(1,Math.ceil(rawHours)),days=Math.max(1,Math.ceil(rawHours/24));
  return{ok:true,start,end,hours,days};
}
function handoverOption(v){const x=String(v||'').toLowerCase();return ['meetup','public_place'].includes(x)?'meetup':'pickup';}
function payMethod(v){const m=String(v||'').toLowerCase();return['gcash','maya'].includes(m)?m:'gcash';}
function canonicalDraft(draft){const d=draft&&typeof draft==='object'?draft:{},meeting=d.meeting_point&&typeof d.meeting_point==='object'?d.meeting_point:{};return{listing_id:Number(d.listing_id),start_date:d.start_date,end_date:d.end_date,pricing_unit:normalizeUnit(d.pricing_unit),pickup_option:handoverOption(d.pickup_option),meeting_point:{name:String(meeting.name||d.meeting_point_name||'').trim().slice(0,200),address:String(meeting.address||d.meeting_point_address||'').trim().slice(0,500)}};}
async function getListing(id){return svcClient().from('listings').select('*').eq('id',id).limit(1).single();}
async function getPricing(l){const {data,error}=await svcClient().from('listing_pricing').select('*').eq('listing_id',l.id).limit(1).maybeSingle();if(error)throw error;return data||{listing_id:l.id,daily_rate:Number(l.price_per_day)||0,daily_enabled:true,hourly_rate:null,hourly_enabled:false,weekly_rate:null,weekly_enabled:false,monthly_rate:null,monthly_enabled:false,minimum_hours:1,minimum_days:1};}
function priceCalculation(period,pricing,unit){
  const enabled=pricing[unit+'_enabled']===true,rate=Number(pricing[unit+'_rate']||0);if(!enabled||rate<=0)return{error:`${unit[0].toUpperCase()+unit.slice(1)} pricing is not enabled for this listing.`};
  if(unit==='hourly'){const qty=Math.max(Number(pricing.minimum_hours)||1,period.hours);return{unit,rate,quantity:qty,fee:qty*rate,label:`${qty} hour${qty===1?'':'s'}`};}
  const rentalDays=Math.max(Number(pricing.minimum_days)||1,period.days);
  if(unit==='daily')return{unit,rate,quantity:rentalDays,fee:rentalDays*rate,label:`${rentalDays} day${rentalDays===1?'':'s'}`};
  if(unit==='weekly'){const qty=Math.max(1,Math.ceil(rentalDays/7));return{unit,rate,quantity:qty,fee:qty*rate,label:`${qty} week${qty===1?'':'s'}`};}
  const qty=Math.max(1,Math.ceil(rentalDays/30));return{unit,rate,quantity:qty,fee:qty*rate,label:`${qty} month${qty===1?'':'s'}`};
}
async function hasAvailabilityConflict(listingId,start,end){
  const [book,block]=await Promise.all([
    svcClient().from('bookings').select('id').eq('listing_id',listingId).in('status',['pending','approved','active','returned','disputed']).lt('start_date',end+1).gt('end_date',start-1).limit(1).maybeSingle(),
    svcClient().from('listing_availability_blocks').select('id').eq('listing_id',listingId).lte('start_at',end).gte('end_at',start).limit(1).maybeSingle(),
  ]);if(book.error)throw book.error;if(block.error)throw block.error;return!!(book.data||block.data);
}
async function quoteFor(user,draft,{checkAvailability=false}={}){
  const listing=await getListing(draft.listing_id);if(listing.error||!listing.data)return{error:'Listing not found',status:404};const l=listing.data;if(l.status!=='active')return{error:'Listing is not available',status:400};if(user&&l.owner_id===user.id)return{error:'You cannot rent your own listing',status:400};
  const period=validatePeriod(draft.start_date,draft.end_date);if(!period.ok)return{error:period.error,status:period.status,code:period.code};const pricing=await getPricing(l),calc=priceCalculation(period,pricing,draft.pricing_unit);if(calc.error)return{error:calc.error,status:400,code:'pricing_unit_unavailable'};
  if(checkAvailability&&await hasAvailabilityConflict(l.id,period.start,period.end))return{error:'This item is unavailable for the selected period.',status:409,code:'date_conflict'};
  const rentalFee=Math.round(calc.fee),deposit=Math.max(0,Number(l.security_deposit)||0),platformFee=await settings.computePlatformFee(rentalFee),rate=await settings.getPlatformRate(),ownerEarning=Math.max(0,rentalFee-platformFee),renterTotal=rentalFee+deposit;
  return{listing:l,pricing,calc,start:period.start,end:period.end,hours:period.hours,days:period.days,rental_fee:rentalFee,security_deposit:deposit,platform_fee:platformFee,commission_rate:rate.percent,owner_earning:ownerEarning,total:renterTotal,delivery_fee:0,delivery_method:'pickup'};
}

router.post('/bookings/quote',requireAuth,async(req,res)=>{try{const draft=canonicalDraft(req.body||{}),q=await quoteFor(req.user,draft,{checkAvailability:true});if(q.error)return res.status(q.status||400).json({error:q.error,code:q.code});res.setHeader('Cache-Control','no-store');res.json({pricing_unit:q.calc.unit,pricing_rate:q.calc.rate,pricing_quantity:q.calc.quantity,pricing_label:q.calc.label,rental_hours:q.hours,rental_days:q.days,rental_fee:q.rental_fee,security_deposit:q.security_deposit,platform_fee:q.platform_fee,commission_rate:q.commission_rate,owner_earning:q.owner_earning,total:q.total,delivery_fee:0,delivery_method:'pickup',pricing_note:'GoRentHive commission is deducted from owner earnings. The refundable security deposit is separate from platform revenue.'});}catch(e){console.error(`[${req.requestId||'no-request-id'}] booking quote failed`,e);res.status(500).json({error:'Could not calculate the booking quote.',request_id:req.requestId});}});

router.post('/bookings/paymongo',requireAuth,async(req,res)=>{try{
  if(String(process.env.GATEWAY||'').toLowerCase()!=='paymongo'||!PaymongoProvider.configured())return res.status(503).json({error:'Online payments are not configured. Booking payment is unavailable.',code:'payment_provider_required'});
  const draft=canonicalDraft(req.body&&req.body.booking_draft?req.body.booking_draft:req.body),q=await quoteFor(req.user,draft,{checkAvailability:true});if(q.error)return res.status(q.status||400).json({error:q.error,code:q.code});if(q.total<=0)return res.status(400).json({error:'Invalid booking total'});
  const method=payMethod(req.body.method),pay=await payment.createPayment({userId:req.user.id,bookingId:null,type:'booking_pay',grossAmount:Math.round(q.total),platformFee:0,method:'paymongo',meta:{booking_draft:draft,requested_method:method}}),intent=await PaymongoProvider.createIntent({amountPesos:Math.round(q.total),method,description:'GoRentHive booking payment '+pay.payment_ref,metadata:{payment_ref:pay.payment_ref,user_id:String(req.user.id),purpose:'booking'}});if(intent.sandbox&&String(process.env.NODE_ENV||'').toLowerCase()==='production')throw new Error('Sandbox payment intent refused in production');
  const meta={...parseJson(pay.meta),paymongo_intent_id:intent.id,paymongo_kind:'booking',requested_method:method,return_url:returnUrl('booking')};await svcClient().from('payments').update({meta:JSON.stringify(meta),updated_at:now()}).eq('id',pay.id);res.json({ok:true,sandbox:!!intent.sandbox,payment_id:pay.id,client_key:intent.client_key,intent_id:intent.id,amount:Math.round(q.total),method,return_url:meta.return_url});
}catch(e){console.error(`[${req.requestId||'no-request-id'}] booking payment intent failed`,e);res.status(502).json({error:'Could not start the booking payment. Please try again.',request_id:req.requestId});}});

router.post('/bookings',requireAuth,async(req,res)=>{let insertedId=null;try{
  const draft=canonicalDraft(req.body||{}),q=await quoteFor(req.user,draft,{checkAvailability:true});if(q.error)return res.status(q.status||400).json({error:q.error,code:q.code});const l=q.listing;
  const missing=[];if(!req.user.email_verified)missing.push('email');if(!req.user.mobile_verified)missing.push('mobile');if(missing.length)return res.status(428).json({error:'Complete email and mobile verification before booking.',code:'verify_required',missing});const needLevel=Number(l.min_verification_level||2),userLevel=Number(req.user.identity_level||1);if(userLevel<needLevel)return res.status(428).json({error:'This listing requires a higher verification level. Complete account verification first.',code:'verify_required',required:needLevel,current:userLevel});
  const rawKey=String(req.headers['idempotency-key']||req.body.idempotency_key||'automatic').slice(0,180),clientRequestId=crypto.createHash('sha256').update([req.user.id,l.id,q.start,q.end,q.calc.unit,rawKey].join('|')).digest('hex');const {data:existing}=await svcClient().from('bookings').select('*').eq('renter_id',req.user.id).eq('client_request_id',clientRequestId).limit(1).maybeSingle();if(existing)return res.json({ok:true,booking:existing,idempotent:true});
  const visibleBalance=await ledger.getUserBalance(req.user.id);if(visibleBalance<q.total)return res.status(402).json({error:'Insufficient wallet balance. Please fund the booking first.',code:'insufficient_funds',required:q.total,balance:visibleBalance});if(await hasAvailabilityConflict(l.id,q.start,q.end))return res.status(409).json({error:'This item was just booked or blocked for those dates. Please choose a different period.',code:'date_conflict'});
  const bookingRef='BK-'+now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase(),row={booking_ref:bookingRef,renter_id:req.user.id,owner_id:l.owner_id,listing_id:l.id,client_request_id:clientRequestId,start_date:q.start,end_date:q.end,rental_days:q.days,rental_hours:q.hours,pricing_unit:q.calc.unit,pricing_rate_at_booking:q.calc.rate,rental_fee:q.rental_fee,daily_rate_at_booking:Math.max(0,Number(l.price_per_day)||0),commission_rate_at_booking:q.commission_rate,security_deposit:q.security_deposit,delivery_fee:0,delivery_requested:false,pickup_option:handoverOption(draft.pickup_option),delivery_method:'pickup',delivery_distance_km:0,delivery_vehicle_type:'',lalamove_fee:0,platform_fee:q.platform_fee,total_charged:q.total,amount_due_owner:q.owner_earning,status:'pending',escrow_payment:true,payment_confirmed:true,created_at:now(),updated_at:now()};
  const ins=await svcClient().from('bookings').insert(row).select().single();if(ins.error){const raw=String(ins.error.message||'').toLowerCase();if(/exclusion|overlap|unique|already exists|23p01|23505/.test(raw))return res.status(409).json({error:'This item was just booked by someone else. Please choose a different period.'});throw new Error(ins.error.message);}insertedId=ins.data.id;
  const reserve=await svcClient().rpc('reserve_booking_funds',{p_booking_id:insertedId,p_renter_id:req.user.id,p_owner_id:l.owner_id,p_rental_amount:q.rental_fee,p_deposit_amount:q.security_deposit,p_booking_ref:bookingRef});if(reserve.error){await svcClient().from('bookings').delete().eq('id',insertedId);insertedId=null;throw new Error('Could not reserve booking funds. Apply the latest financial-integrity migration and try again.');}const reservation=Array.isArray(reserve.data)?reserve.data[0]:reserve.data;if(!reservation||reservation.reservation_status!=='reserved'){await svcClient().from('bookings').delete().eq('id',insertedId);insertedId=null;if(reservation&&reservation.reservation_status==='insufficient_funds')return res.status(402).json({error:'Your wallet balance changed before the booking could be reserved. Please fund the difference and try again.',code:'insufficient_funds',required:q.total,balance:reservation.new_balance||0});throw new Error('Booking funds could not be reserved.');}
  const pointName=draft.meeting_point&&draft.meeting_point.name,pointAddress=draft.meeting_point&&draft.meeting_point.address;if(pointName){try{await svcClient().from('meeting_points').insert({booking_id:insertedId,point_name:pointName,point_address:pointAddress||'',latitude:null,longitude:null,proposed_by:req.user.id,created_at:now(),updated_at:now()});}catch(_){}}
  res.json({ok:true,booking:ins.data});
}catch(e){console.error(`[${req.requestId||'no-request-id'}] booking creation failed`,e);if(insertedId){try{await svcClient().from('bookings').delete().eq('id',insertedId);}catch(_){}}res.status(500).json({error:'Could not create booking. Please try again.',request_id:req.requestId});}});

module.exports=router;
module.exports._test={canonicalDraft,handoverOption,payMethod,validatePeriod,normalizeUnit,priceCalculation};
