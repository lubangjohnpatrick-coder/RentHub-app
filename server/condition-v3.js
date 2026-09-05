'use strict';

const express=require('express');
const crypto=require('crypto');
const {svcClient}=require('./supabase');
const {requireAuth}=require('./auth-service');

const router=express.Router();
const now=()=>Date.now();
function text(v,max=2000){return String(v||'').trim().slice(0,max);}
function parseChecklist(v){if(!v||typeof v!=='object'||Array.isArray(v))return{};const out={};for(const [k,val] of Object.entries(v))out[text(k,40)]=val===true||typeof val==='string'?val:!!val;return out;}
function evidenceHash(payload){return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');}
async function load(id){const {data}=await svcClient().from('bookings').select('*').eq('id',Number(id)).limit(1).maybeSingle();return data||null;}
async function isVehicle(listingId){const {data}=await svcClient().from('vehicle_compliance').select('listing_id').eq('listing_id',listingId).limit(1).maybeSingle();return !!data;}

router.post('/bookings/:id/condition',requireAuth,async(req,res)=>{
  try{
    const b=await load(req.params.id);if(!b)return res.status(404).json({error:'Booking not found'});if(![b.renter_id,b.owner_id].includes(req.user.id)&&req.user.role!=='admin')return res.status(403).json({error:'Not your booking'});
    const phase=String(req.body.phase||'');if(!['checkin','checkout'].includes(phase))return res.status(400).json({error:'Invalid condition phase'});
    if(phase==='checkin'&&req.user.id!==b.owner_id&&req.user.role!=='admin')return res.status(403).json({error:'The owner records pre-rental condition.'});
    if(phase==='checkout'&&req.user.id!==b.renter_id&&req.user.role!=='admin')return res.status(403).json({error:'The renter records return condition.'});
    if(phase==='checkin'&&b.status!=='approved')return res.status(400).json({error:'Pre-rental evidence is available after booking approval.'});
    if(phase==='checkout'&&b.status!=='active')return res.status(400).json({error:'Return evidence is available only during an active rental.'});
    const photos=Array.isArray(req.body.photos)?req.body.photos.filter((x)=>String(x).startsWith('private://rental-evidence/')).slice(0,12):[];const vehicle=await isVehicle(b.listing_id);const minimum=vehicle?7:4;if(photos.length<minimum)return res.status(400).json({error:vehicle?'Vehicle condition records require at least 7 private photos: front, rear, left, right, interior, wheels and windshield.':'Upload at least 4 clear private condition photos.'});
    const checklist=parseChecklist(req.body.checklist);if(vehicle){const required=['front','rear','left','right','interior','wheels','windshield'];const missing=required.filter((k)=>!checklist[k]);if(missing.length)return res.status(400).json({error:'Complete every vehicle inspection area before submitting.',missing});}
    const odometer=req.body.odometer_km===''||req.body.odometer_km==null?null:Math.max(0,Math.round(Number(req.body.odometer_km)));const fuel=req.body.fuel_percent===''||req.body.fuel_percent==null?null:Math.round(Number(req.body.fuel_percent));if(vehicle&&(odometer===null||!Number.isFinite(odometer)||fuel===null||!Number.isFinite(fuel)||fuel<0||fuel>100))return res.status(400).json({error:'Vehicle evidence requires odometer and fuel level (0–100%).'});
    const serial=text(req.body.serial_number,180),accessories=text(req.body.accessories,1000),damage=text(req.body.damage_notes,2000);const payload={booking_id:b.id,phase,photos,checklist,serial_number:serial,accessories,damage_notes:damage,odometer_km:odometer,fuel_percent:fuel};
    const {data,error}=await svcClient().from('condition_records').insert({booking_id:b.id,phase,uploaded_by:req.user.id,photos:JSON.stringify(photos),serial_number:serial,accessories,damage_notes:damage,checklist:JSON.stringify(checklist),odometer_km:odometer,fuel_percent:fuel,evidence_hash:evidenceHash(payload),status:'submitted',created_at:now()}).select().single();if(error)throw error;res.json({ok:true,record:data,vehicle,requires_other_party_confirmation:true});
  }catch(e){console.error(`[${req.requestId||'no-request-id'}] structured condition record failed`,e);res.status(500).json({error:'Could not save condition evidence.'});}
});

module.exports=router;
module.exports._test={parseChecklist,evidenceHash};
