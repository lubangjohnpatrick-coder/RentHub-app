'use strict';

// Two-party physical handover with QR token + PIN fallback.
// Renter displays a short-lived credential, owner scans/enters it in person,
// then renter gives final confirmation. Pickup activates the rental; return
// records the physical return before the existing condition/deduction workflow.

const express=require('express');
const crypto=require('crypto');
const {svcClient}=require('./supabase');
const {requireAuth}=require('./auth-service');

const router=express.Router();
const now=()=>Date.now();
const TTL_MS=30*60*1000;
function normalizePin(v){return String(v||'').replace(/\D/g,'').slice(0,6);}
function phase(v){return String(v||'').toLowerCase()==='return'?'return':'pickup';}
function digest(bookingId,p,value){const secret=String(process.env.APP_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||'gorenthive-handover');return crypto.createHmac('sha256',secret).update(`${bookingId}|${p}|${String(value||'')}`).digest('hex');}
function qrPayload(bookingId,p,token){return `GRH1|${bookingId}|${p}|${token}`;}
function parseQr(v){const m=String(v||'').trim().match(/^GRH1\|(\d+)\|(pickup|return)\|([A-Za-z0-9_-]{20,})$/);return m?{booking_id:Number(m[1]),phase:m[2],token:m[3]}:null;}
function ready(b,p){if(!b)return false;if(p==='pickup')return b.status==='approved'&&b.payment_confirmed===true&&b.agreement_signed_renter===true&&b.agreement_signed_owner===true&&b.checkin_confirmed===true;return b.status==='active'&&b.checkout_confirmed===true;}
async function booking(id){const {data,error}=await svcClient().from('bookings').select('*').eq('id',Number(id)).limit(1).maybeSingle();if(error)throw error;return data||null;}
async function record(id,p){const {data,error}=await svcClient().from('booking_handover_tokens').select('*').eq('booking_id',id).eq('phase',p).limit(1).maybeSingle();if(error)throw error;return data||null;}
function party(b,u){return b&&u&&([b.renter_id,b.owner_id].includes(u.id)||u.role==='admin');}

router.get('/bookings/:id/handover/:phase/status',requireAuth,async(req,res)=>{
  try{const b=await booking(req.params.id),p=phase(req.params.phase);if(!b)return res.status(404).json({error:'Booking not found'});if(!party(b,req.user))return res.status(403).json({error:'Not your booking'});const r=await record(b.id,p);res.json({phase:p,ready:ready(b,p),generated:!!r,scanned:!!(r&&r.scanned_at),owner_confirmed:!!(r&&r.owner_confirmed_at),renter_confirmed:!!(r&&r.renter_confirmed_at),completed:!!(r&&r.used_at),expires_at:r&&r.expires_at||null});}catch(e){res.status(500).json({error:'Could not load handover status.'});}
});

router.post('/bookings/:id/handover/:phase/token',requireAuth,async(req,res)=>{
  try{const b=await booking(req.params.id),p=phase(req.params.phase);if(!b)return res.status(404).json({error:'Booking not found'});if(req.user.id!==b.renter_id&&req.user.role!=='admin')return res.status(403).json({error:'The renter displays the handover QR.'});if(!ready(b,p))return res.status(409).json({error:p==='pickup'?'Complete payment, signatures and confirmed pre-rental condition evidence first.':'Complete and confirm the return condition evidence first.',code:'handover_not_ready'});
    const token=crypto.randomBytes(24).toString('base64url'),pin=String(crypto.randomInt(0,1000000)).padStart(6,'0'),expires=now()+TTL_MS,stamp=now();const {error}=await svcClient().from('booking_handover_tokens').upsert({booking_id:b.id,phase:p,token_hash:digest(b.id,p,token),pin_hash:digest(b.id,p,pin),generated_by:req.user.id,scanned_by:null,scanned_at:null,renter_confirmed_at:null,owner_confirmed_at:null,expires_at:expires,attempts:0,used_at:null,created_at:stamp,updated_at:stamp},{onConflict:'booking_id,phase'});if(error)throw error;res.setHeader('Cache-Control','no-store');res.json({ok:true,phase:p,qr_payload:qrPayload(b.id,p,token),pin,expires_at:expires,valid_for_minutes:30});
  }catch(e){console.error(`[${req.requestId||'no-request-id'}] handover token generation failed`,e);res.status(500).json({error:'Could not prepare the handover QR.'});}
});

router.post('/bookings/:id/handover/:phase/scan',requireAuth,async(req,res)=>{
  try{const b=await booking(req.params.id),p=phase(req.params.phase);if(!b)return res.status(404).json({error:'Booking not found'});if(req.user.id!==b.owner_id&&req.user.role!=='admin')return res.status(403).json({error:'Only the owner can scan/confirm this handover credential.'});if(!ready(b,p))return res.status(409).json({error:'This booking is not ready for this handover step.',code:'handover_not_ready'});const r=await record(b.id,p);if(!r||r.used_at)return res.status(400).json({error:'No active handover credential exists. Ask the renter to show a new QR.'});if(Number(r.expires_at)<=now())return res.status(410).json({error:'This handover credential expired. Ask the renter to generate a new one.'});if(Number(r.attempts||0)>=5)return res.status(429).json({error:'Too many incorrect attempts. Ask the renter to generate a new credential.'});
    let supplied='';const parsed=parseQr(req.body&&req.body.qr_payload);if(parsed&&parsed.booking_id===b.id&&parsed.phase===p)supplied=digest(b.id,p,parsed.token);else{const pin=normalizePin(req.body&&req.body.pin);if(pin.length===6)supplied=digest(b.id,p,pin);}
    const tokenMatch=supplied&&supplied===String(r.token_hash),pinMatch=supplied&&supplied===String(r.pin_hash);if(!tokenMatch&&!pinMatch){await svcClient().from('booking_handover_tokens').update({attempts:Number(r.attempts||0)+1,updated_at:now()}).eq('booking_id',b.id).eq('phase',p);return res.status(400).json({error:'The QR/PIN does not match this booking.'});}
    const stamp=now();await svcClient().from('booking_handover_tokens').update({scanned_by:req.user.id,scanned_at:stamp,owner_confirmed_at:stamp,updated_at:stamp}).eq('booking_id',b.id).eq('phase',p);res.json({ok:true,phase:p,owner_confirmed:true,awaiting_renter_confirmation:true,scanned_at:stamp});
  }catch(e){console.error(`[${req.requestId||'no-request-id'}] handover scan failed`,e);res.status(500).json({error:'Could not validate the handover QR/PIN.'});}
});

router.post('/bookings/:id/handover/:phase/confirm',requireAuth,async(req,res)=>{
  try{const b=await booking(req.params.id),p=phase(req.params.phase);if(!b)return res.status(404).json({error:'Booking not found'});if(req.user.id!==b.renter_id&&req.user.role!=='admin')return res.status(403).json({error:'Only the renter can give final handover confirmation.'});if(!ready(b,p))return res.status(409).json({error:'This booking is not ready for final handover confirmation.'});const r=await record(b.id,p);if(!r||!r.scanned_at||!r.owner_confirmed_at)return res.status(409).json({error:'The owner must scan your QR or enter your PIN first.'});if(r.used_at)return res.json({ok:true,phase:p,already_completed:true,status:b.status});const stamp=now();await svcClient().from('booking_handover_tokens').update({renter_confirmed_at:stamp,used_at:stamp,updated_at:stamp}).eq('booking_id',b.id).eq('phase',p);
    if(p==='pickup'){const {data,error}=await svcClient().from('bookings').update({status:'active',handover_confirmed:true,pickup_handover_confirmed_at:stamp,updated_at:stamp}).eq('id',b.id).eq('status','approved').select('id,status').single();if(error)throw error;return res.json({ok:true,phase:p,status:data.status,confirmed_at:stamp});}
    await svcClient().from('bookings').update({return_handover_confirmed_at:stamp,updated_at:stamp}).eq('id',b.id).eq('status','active');res.json({ok:true,phase:p,status:'active',return_handover_confirmed:true,confirmed_at:stamp,next_step:'Owner reviews any deductions and completes the return.'});
  }catch(e){console.error(`[${req.requestId||'no-request-id'}] final handover confirmation failed`,e);res.status(500).json({error:'Could not complete handover confirmation.'});}
});

// Retire previous owner-generated PIN / one-click activation endpoints.
router.post('/bookings/:id/handover-code',requireAuth,(req,res)=>res.status(409).json({error:'The renter now generates the pickup/return QR. Open the booking and use the two-party handover flow.',code:'qr_handover_required'}));
router.post('/bookings/:id/handover-code/confirm',requireAuth,(req,res)=>res.status(409).json({error:'Use the QR/PIN scan flow shown on the booking.',code:'qr_handover_required'}));
router.post('/bookings/:id/handover',requireAuth,(req,res)=>res.status(409).json({error:'Two-party QR/PIN confirmation is required for physical handover.',code:'qr_handover_required'}));

module.exports=router;
module.exports._test={normalizePin,phase,digest,qrPayload,parseQr,ready,TTL_MS};
