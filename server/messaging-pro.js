'use strict';

const express = require('express');
const { svcClient } = require('./supabase');
const { requireAuth } = require('./auth-service');
const { publicUser } = require('./publicShape');

const router = express.Router();
const now = () => Date.now();
const OFF_PLATFORM_RE = /(\+?[2-9]\d{9,11}\b)|(gcash|paymaya|maya|paypal|venmo)|(\b[a-z0-9._%+-]+@(gmail|yahoo|outlook|hotmail|icloud)\b)|(facebook|messenger|telegram|whatsapp|viber|lazada|shopee)/i;

function clean(v,max=3000){return String(v||'').trim().slice(0,max);}
function attachments(v){return Array.isArray(v)?v.filter((x)=>/^private:\/\/rental-evidence\/bookings\/\d+\//.test(String(x))).slice(0,6):[];}
async function bookingBetween(bookingId,a,b){
  if(!bookingId)return null;
  const {data}=await svcClient().from('bookings').select('id,renter_id,owner_id,status').eq('id',Number(bookingId)).limit(1).maybeSingle();
  if(!data)return null;
  const parties=new Set([String(data.renter_id),String(data.owner_id)]);
  return parties.has(String(a))&&parties.has(String(b))?data:null;
}
async function hasConfirmedBooking(a,b){
  const {data}=await svcClient().from('bookings').select('id').in('status',['approved','active','returned','completed','disputed']).or(`and(renter_id.eq.${a},owner_id.eq.${b}),and(renter_id.eq.${b},owner_id.eq.${a})`).limit(1).maybeSingle();
  return !!data;
}
async function notify(userId,title,body,link){try{await svcClient().from('notifications').insert({user_id:userId,type:'message',title,body,link,is_read:false,created_at:now()});}catch(_){}}

router.post('/messages',requireAuth,async(req,res)=>{
  try{
    const receiverId=String(req.body.receiver_id||''); const body=clean(req.body.body); const bookingId=req.body.booking_id?Number(req.body.booking_id):null; const files=attachments(req.body.attachments);
    if(!receiverId||(!body&&!files.length))return res.status(400).json({error:'Write a message or attach booking evidence.'});
    if(String(receiverId)===String(req.user.id))return res.status(400).json({error:'You cannot message yourself.'});
    let warning='';
    if(body&&OFF_PLATFORM_RE.test(body)){
      if(!(await hasConfirmedBooking(req.user.id,receiverId)))return res.status(400).json({error:'Sharing contact or payment details is not allowed before a booking is confirmed. Keep the transaction inside GoRentHive.',code:'circumvention_blocked'});
      warning='Off-platform contact detected. GoRentHive protections apply most reliably when booking and payment records remain on-platform.';
    }
    if(files.length){
      const booking=await bookingBetween(bookingId,req.user.id,receiverId);
      if(!booking)return res.status(403).json({error:'Attachments are allowed only inside a conversation tied to a booking between these two users.'});
      const prefix=`private://rental-evidence/bookings/${booking.id}/`;
      if(files.some((x)=>!String(x).startsWith(prefix)))return res.status(403).json({error:'An attachment does not belong to this booking.'});
    }
    const {data,error}=await svcClient().from('messages').insert({sender_id:req.user.id,receiver_id:receiverId,body:body||'Attachment',booking_id:bookingId,attachments:JSON.stringify(files),warning:warning||'',is_read:false,read_at:null,created_at:now()}).select().single();
    if(error)throw error;
    await notify(receiverId,'New message',body?body.slice(0,80):'Sent you a booking attachment',`#/messages?to=${req.user.id}${bookingId?'&booking='+bookingId:''}`);
    res.json({ok:true,warning,message:{...data,attachments:files}});
  }catch(e){console.error(`[${req.requestId||'no-request-id'}] message send failed`,e);res.status(500).json({error:'Could not send the message.'});}
});

router.get('/messages',requireAuth,async(req,res)=>{
  try{
    const myId=req.user.id; const {data,error}=await svcClient().from('messages').select('*').or(`sender_id.eq.${myId},receiver_id.eq.${myId}`).order('created_at',{ascending:true}).limit(750); if(error)throw error;
    const convs=new Map();
    for(const m of data||[]){const other=String(m.sender_id)===String(myId)?m.receiver_id:m.sender_id;if(!convs.has(String(other)))convs.set(String(other),{other_id:other,messages:[]});convs.get(String(other)).messages.push(m);}
    const ids=[...convs.values()].map((x)=>x.other_id);const {data:users}=ids.length?await svcClient().from('users').select('*').in('id',ids):{data:[]};const usersMap=new Map((users||[]).map((u)=>[String(u.id),u]));
    const result=[];for(const cv of convs.values()){const msgs=cv.messages,last=msgs[msgs.length-1],unread=msgs.filter((m)=>String(m.receiver_id)===String(myId)&&!m.is_read).length;const lastBooking=[...msgs].reverse().map((m)=>m.booking_id).find(Boolean)||null;result.push({other_id:cv.other_id,last:{...last,attachments:attachments(JSON.parse(last.attachments||'[]'))},unread,booking_id:lastBooking,other:publicUser(usersMap.get(String(cv.other_id))),last_time:last.created_at,prev:last.body});}
    result.sort((a,b)=>Number(b.last_time)-Number(a.last_time));res.json(result);
  }catch(e){console.error('message list failed',e);res.status(500).json({error:'Could not load messages.'});}
});

router.get('/messages/:userId',requireAuth,async(req,res)=>{
  try{
    const myId=req.user.id,otherId=req.params.userId;const bookingId=req.query.booking_id?Number(req.query.booking_id):null;
    let q=svcClient().from('messages').select('*').or(`and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`).order('created_at',{ascending:true}).limit(750);if(bookingId)q=q.eq('booking_id',bookingId);
    const {data,error}=await q;if(error)throw error;const stamp=now();const unread=(data||[]).filter((m)=>String(m.receiver_id)===String(myId)&&!m.is_read);if(unread.length)await svcClient().from('messages').update({is_read:true,read_at:stamp}).in('id',unread.map((m)=>m.id));
    const {data:ou}=await svcClient().from('users').select('*').eq('id',otherId).limit(1).maybeSingle();
    res.json({messages:(data||[]).map((m)=>({...m,is_read:String(m.receiver_id)===String(myId)?true:m.is_read,read_at:String(m.receiver_id)===String(myId)&&!m.read_at?stamp:m.read_at,attachments:safeAttachments(m.attachments)})),other:publicUser(ou)});
  }catch(e){console.error('message thread failed',e);res.status(500).json({error:'Could not load this conversation.'});}
});
function safeAttachments(v){try{return attachments(JSON.parse(v||'[]'));}catch(_){return [];}}

module.exports=router;
module.exports._test={clean,attachments,OFF_PLATFORM_RE};
