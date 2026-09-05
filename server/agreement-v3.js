'use strict';

const express=require('express');
const crypto=require('crypto');
const {svcClient}=require('./supabase');
const {requireAuth}=require('./auth-service');
const policy=require('./rental-policy');

const router=express.Router();
const VERSION='3.0';
const now=()=>Date.now();
function parse(v,fb={}){try{return JSON.parse(v||'{}')||fb;}catch(_){return fb;}}
function mask(v){const s=String(v||'');return s?s.slice(-4).padStart(Math.min(8,s.length),'•'):'';}
function sha(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
function keyed(v){return crypto.createHmac('sha256',String(process.env.APP_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||'gorenthive-agreement')).update(String(v)).digest('hex');}
function deviceHash(req){return keyed([req.user.id,req.get('user-agent')||'',req.get('accept-language')||''].join('|'));}
async function loadBooking(id){const {data}=await svcClient().from('bookings').select('*').eq('id',Number(id)).limit(1).maybeSingle();return data||null;}

async function snapshotFor(b){
  const [lr,rr,or,vc,vt,dv]=await Promise.all([
    svcClient().from('listings').select('*').eq('id',b.listing_id).single(),
    svcClient().from('users').select('id,full_name').eq('id',b.renter_id).single(),
    svcClient().from('users').select('id,full_name,is_business').eq('id',b.owner_id).single(),
    svcClient().from('vehicle_compliance').select('*').eq('listing_id',b.listing_id).limit(1).maybeSingle(),
    svcClient().from('vehicle_rental_terms').select('*').eq('listing_id',b.listing_id).limit(1).maybeSingle(),
    svcClient().from('driver_verifications').select('*').eq('user_id',b.renter_id).limit(1).maybeSingle(),
  ]);
  const listing=lr.data||{},rule=policy.lateFeeRule(listing,b);const base=policy.agreementSnapshot({booking:b,listing,renter:rr.data,owner:or.data,rule});base.version=VERSION;base.created_at=now();
  base.rental.pricing_unit=b.pricing_unit||'daily';base.rental.pricing_rate=b.pricing_rate_at_booking||b.daily_rate_at_booking||listing.price_per_day;base.rental.rental_hours=b.rental_hours||0;base.rental.pickup_location='Exact handover location is shared only between the approved booking parties.';base.rental.return_location='As agreed in the booking conversation or confirmed meetup record.';
  if(vc.data){const v=vc.data,t=vt.data||{},d=dv.data||{};base.vehicle={make:v.make||'',model:v.model||'',model_year:v.model_year||null,plate_reference:mask(v.plate_number),vin_last6:v.vin_last6||'',or_cr_reference:mask(v.or_cr_reference),ltfrb_authority_reference:mask(v.ltfrb_authority_reference),insurance_reference:mask(v.insurance_reference),ctpl_reference:mask(v.ctpl_reference),authorized_drivers:[{user_id:b.renter_id,name:rr.data&&rr.data.full_name,license_last4:d.license_last4||'',license_class:d.license_class||''}],mileage_allowance_km:t.mileage_allowance_km||0,excess_mileage_fee:t.excess_mileage_fee||0,fuel_policy:t.fuel_policy||'same_level',geographic_restrictions:t.geographic_restrictions||'',accident_procedure:t.accident_procedure||'',damage_procedure:t.damage_procedure||'',traffic_ticket_liability:t.traffic_ticket_liability||'',toll_liability:t.toll_liability||'',impoundment_liability:t.impoundment_liability||'',prohibited_uses:{tnvs_ride_hailing:t.prohibited_tnvs!==false,courier_delivery:t.prohibited_courier!==false,racing:t.prohibited_racing!==false,subleasing:t.prohibited_sublease!==false,unauthorized_driver:t.prohibited_unauthorized_driver!==false,outside_approved_zone:t.prohibited_outside_zone!==false}};}
  base.integrity={version:VERSION,snapshot_algorithm:'SHA-256',signature_method:'server-recorded acceptance with timestamp and pseudonymous device hash'};
  return base;
}
function agreementText(s){
  const p=s.parties,i=s.item,r=s.rental,lines=[`GoRentHive Booking-Specific Rental Agreement v${VERSION}`,`Booking: ${s.booking_ref}`,`Owner: ${p.owner.name||p.owner.id||''}`,`Renter: ${p.renter.name||p.renter.id||''}`,`Item: ${i.title||''}${i.serial_number?' | Asset reference: '+i.serial_number:''}`,`Rental period: ${new Date(r.start_date).toISOString()} to ${new Date(r.end_date).toISOString()}`,`Pricing: ₱${r.pricing_rate||r.daily_rate} per ${r.pricing_unit||'day'} | Rental fee: ₱${r.rental_fee} | Refundable security deposit: ₱${r.security_deposit}`,`Owner commission: ${r.owner_commission_rate}% (₱${r.owner_commission}); deducted from owner earnings.`,`Late return: ${s.policies.late_return.label}.`,`Condition evidence: ${s.policies.damage}`,`Payment: ${s.policies.payment}`];
  if(s.vehicle){const v=s.vehicle,pro=[];if(v.prohibited_uses.tnvs_ride_hailing)pro.push('Grab/TNVS or ride-hailing');if(v.prohibited_uses.courier_delivery)pro.push('courier/delivery work');if(v.prohibited_uses.racing)pro.push('racing');if(v.prohibited_uses.subleasing)pro.push('subleasing');if(v.prohibited_uses.unauthorized_driver)pro.push('unauthorized drivers');if(v.prohibited_uses.outside_approved_zone)pro.push('travel outside the approved geographic zone without consent');lines.push(`Vehicle: ${v.make} ${v.model}${v.model_year?' '+v.model_year:''} | Plate ref ${v.plate_reference} | VIN last 6 ${v.vin_last6}.`,`Regulatory records: OR/CR ${v.or_cr_reference}; LTFRB authority ${v.ltfrb_authority_reference}; insurance ${v.insurance_reference}; CTPL ${v.ctpl_reference}.`,`Mileage allowance: ${v.mileage_allowance_km||'As agreed'} km | Excess mileage: ₱${v.excess_mileage_fee||0}/km | Fuel: ${v.fuel_policy}.`,`Geographic restrictions: ${v.geographic_restrictions||'As agreed by the parties in-app.'}`,`Accident procedure: ${v.accident_procedure}`,`Damage procedure: ${v.damage_procedure}`,`Traffic tickets: ${v.traffic_ticket_liability}`,`Tolls: ${v.toll_liability}`,`Impoundment: ${v.impoundment_liability}`,`PROHIBITED VEHICLE USES: ${pro.join('; ')}.`);}
  lines.push('By signing, each party accepts this immutable booking snapshot, the condition-documentation workflow, and applicable GoRentHive policies.');return lines.join('\n');
}

async function sign(req,res){
  try{
    const b=await loadBooking(req.params.id);if(!b)return res.status(404).json({error:'Booking not found'});if(![b.renter_id,b.owner_id].includes(req.user.id))return res.status(403).json({error:'Not your booking'});if(b.status!=='approved')return res.status(400).json({error:'Booking must be approved before signing'});
    const hasVehicle=(await svcClient().from('vehicle_compliance').select('listing_id').eq('listing_id',b.listing_id).limit(1).maybeSingle()).data;
    if(hasVehicle&&req.body&&req.body.accepted_prohibited_uses!==true)return res.status(428).json({error:'Vehicle renters and owners must explicitly accept the prohibited-use rules before signing.',code:'vehicle_rules_acceptance_required'});
    let snapshot=parse(b.agreement_snapshot,{});if(!snapshot.version||snapshot.version!==VERSION)snapshot=await snapshotFor(b);const serialized=JSON.stringify(snapshot);const snapshotHash=sha(serialized);const signedAt=now();const signatureHash=keyed([snapshotHash,req.user.id,signedAt].join('|'));const isRenter=b.renter_id===req.user.id;
    const existing=await svcClient().from('rental_agreements').select('*').eq('booking_id',b.id).limit(1).maybeSingle();const old=existing.data||{};
    const row={booking_id:b.id,listing_id:b.listing_id,agreement_version:VERSION,body:agreementText(snapshot),snapshot_hash:snapshotHash,vehicle_terms:JSON.stringify(snapshot.vehicle||{}),renter_signed_at:old.renter_signed_at||null,owner_signed_at:old.owner_signed_at||null,renter_signature_hash:old.renter_signature_hash||'',owner_signature_hash:old.owner_signature_hash||'',renter_device_hash:old.renter_device_hash||'',owner_device_hash:old.owner_device_hash||'',created_at:old.created_at||signedAt};
    if(isRenter){row.renter_signed_at=signedAt;row.renter_signature_hash=signatureHash;row.renter_device_hash=deviceHash(req);}else{row.owner_signed_at=signedAt;row.owner_signature_hash=signatureHash;row.owner_device_hash=deviceHash(req);}
    const {data,error}=await svcClient().from('rental_agreements').upsert(row,{onConflict:'booking_id'}).select().single();if(error)throw error;
    await svcClient().from('bookings').update({agreement_version:VERSION,agreement_snapshot:serialized,late_fee_rule:JSON.stringify(snapshot.policies.late_return),[isRenter?'agreement_signed_renter':'agreement_signed_owner']:true,updated_at:now()}).eq('id',b.id);
    res.json({ok:true,agreement:data,snapshot_hash:snapshotHash,status:'approved'});
  }catch(e){console.error(`[${req.requestId||'no-request-id'}] agreement v3 failed`,e);res.status(500).json({error:'Could not sign the rental agreement.'});}
}
router.post('/bookings/:id/agreement-v3/sign',requireAuth,sign);
router.post('/bookings/:id/agreement-v2/sign',requireAuth,sign);
router.post('/bookings/:id/sign-agreement',requireAuth,sign);

module.exports=router;
module.exports._test={mask,sha,agreementText,VERSION};
