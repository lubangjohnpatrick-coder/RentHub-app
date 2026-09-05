'use strict';

const fs=require('fs');const path=require('path');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const booking=require('./booking-v2')._test;
const handover=require('./handover-code')._test;
const pro=require('./marketplace-pro')._test;
const condition=require('./condition-v3')._test;
const agreement=require('./agreement-v3')._test;

let p=booking.validatePeriod(new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+4*3600000).toISOString());assert(p.ok&&p.hours>=3,'hourly period should calculate hours');
let q=booking.priceCalculation({hours:5,days:1},{hourly_enabled:true,hourly_rate:120,minimum_hours:2},'hourly');assert(q.fee===600&&q.quantity===5,'hourly quote must use hourly rate');
q=booking.priceCalculation({hours:240,days:10},{weekly_enabled:true,weekly_rate:2500,minimum_days:1},'weekly');assert(q.quantity===2&&q.fee===5000,'weekly quote should round up partial weeks');
q=booking.priceCalculation({hours:24*40,days:40},{monthly_enabled:true,monthly_rate:8000,minimum_days:1},'monthly');assert(q.quantity===2&&q.fee===16000,'monthly quote should round up partial months');
assert(booking.normalizeUnit('weekly')==='weekly'&&booking.normalizeUnit('bad')==='daily','pricing unit normalization failed');
assert(pro.coarseCoord(14.123456)===14.12,'map coordinates must be coarsened');assert(pro.isVehicleName('Vehicles')&&pro.isVehicleName('Car Rental'),'vehicle classifier failed');
assert(handover.parseQr(handover.qrPayload(44,'pickup','abcdefghijklmnopqrstuvwx')).booking_id===44,'QR payload roundtrip failed');assert(handover.normalizePin('12-34 56')==='123456','PIN normalization failed');
assert(condition.parseChecklist({front:true,rear:'ok'}).front===true,'condition checklist parse failed');assert(condition.evidenceHash({a:1}).length===64,'evidence hash should be SHA-256');
assert(agreement.mask('ABC1234567').endsWith('4567'),'agreement reference masking failed');assert(agreement.sha('snapshot').length===64,'agreement hash should be SHA-256');

const root=path.resolve(__dirname,'..');const migration=fs.readFileSync(path.join(root,'supabase/migrations/2026-09-05-marketplace-pro-experience.sql'),'utf8');const firstMigration=fs.readFileSync(path.join(root,'supabase/migrations/2026-09-05-marketplace-trust-vehicle-upgrades.sql'),'utf8');const frontend=fs.readFileSync(path.join(root,'public/js/marketplace-pro.js'),'utf8');const css=fs.readFileSync(path.join(root,'public/css/marketplace-upgrades.css'),'utf8');const index=fs.readFileSync(path.join(root,'server/index.js'),'utf8');
assert(firstMigration.includes('owner_id uuid')&&firstMigration.includes('user_id uuid primary key'),'vehicle compliance foreign keys must match UUID users');
for(const table of ['listing_pricing','listing_availability_blocks','saved_searches','notification_preferences','business_verifications','vehicle_rental_terms','vehicle_incidents','booking_handover_tokens'])assert(migration.includes(`public.${table}`),`missing marketplace table ${table}`);
assert(migration.includes("pricing_unit text not null default 'daily'")&&migration.includes('snapshot_hash'),'booking/agreement upgrade columns missing');
assert(index.includes("require('./marketplace-pro')")&&index.includes("require('./messaging-pro')")&&index.includes("require('./agreement-v3')")&&index.includes("require('./condition-v3')"),'Marketplace Pro routes are not mounted');
for(const needle of ['showExploreMode','saveCurrentSearch','viewNotifications','viewOwnerDashboard','showHandoverQr','scanHandoverQr','saveVehicleCondition','viewBusinessVerification'])assert(frontend.includes(needle),`frontend missing ${needle}`);
assert(frontend.includes('/api/upload?scope=evidence&booking_id='),'condition/message evidence must use private booking storage');
assert(css.includes('.grh-market-map')&&css.includes('.grh-owner-analytics')&&css.includes('.grh-listing-card'),'premium marketplace design rules missing');
console.log('Marketplace Pro regression tests passed.');
