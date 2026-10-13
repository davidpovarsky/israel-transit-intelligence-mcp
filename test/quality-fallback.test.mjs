import test from 'node:test';
import assert from 'node:assert/strict';
import {callBusNearby} from '../server/busnearby-server.mjs';
import {getRailServiceUpdates,parseOfficialRailUpdates,RAIL_UPDATES_URL} from '../server/live-server.mjs';
const NOW=()=>new Date('2026-10-13T18:35:00Z');
const response=(html,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:{get:k=>headers[k.toLowerCase()]??null},text:async()=>html});
test('BusNearby 403 is explicit; independent Nominatim fallback obeys provider restrictions',async()=>{
 const calls=[];
 const result=await callBusNearby('geocode',{query:'ירושלים'},async(url,opts)=>{
  calls.push({url,opts});return response('',403,{'retry-after':'40'});
 },NOW);
 assert.equal(result.isError,true);
 const data=JSON.parse(result.content[0].text);
 assert.equal(data.provider_code,'PROVIDER_FORBIDDEN');assert.equal(data.http_status,403);assert.equal(data.retryable,false);
 assert.equal(data.retry_after,'40');assert.equal(calls.length,2);
 assert.equal(calls[0].opts.headers,undefined); // original BusNearby adapter request shape
 assert.match(calls[1].url,/nominatim.openstreetmap.org/);
 assert.match(calls[1].opts.headers['User-Agent'],/IsraelTransitIntelligence/);
 assert.equal(typeof data.geocoding_fallback_error,'string');
});
test('Nominatim independent fallback yields explicitly labelled Israeli coordinates on BusNearby 403',async()=>{
 let primary=0,backup=0;
 const result=await callBusNearby('geocode',{locale:'he',query:'Tel Aviv'},async(url,opts)=>{
  if(url.startsWith('https://api.busnearby.co.il')){primary++;return response('',403);}
  backup++;return response(JSON.stringify([{lat:'32.08',lon:'34.78',display_name:'Tel Aviv, Israel'}]),200);
 },NOW);
 assert.equal(primary,1);assert.equal(backup,1);assert.equal(result.isError,false);
 assert.equal(result.structuredContent.provider,'Nominatim');
 assert.equal(result.structuredContent.data_kind,'PLACE_GEOCODING_FALLBACK');
 assert.match(result.structuredContent.result[0].place,/::32\.08,34\.78/);
});
test('BusNearby directions 403 is not retried or fabricated and has official interactive planner link',async()=>{
 const r=await callBusNearby('directions',{
   fromPlace:'Jerusalem::31.778,35.235',toPlace:'Tel Aviv::32.080,34.780'
 },async()=>response('',403),NOW);
 assert.equal(r.isError,true);
 const data=JSON.parse(r.content[0].text);
 assert.equal(data.provider_code,'PROVIDER_FORBIDDEN');
 assert.equal(data.official_route_planner,'https://route.bus.gov.il/');
});
test('BusNearby 429 reports retryable; geocode may query independent fallback once',async()=>{
 let primary=0,secondary=0;
 const r=await callBusNearby('geocode',{query:'Haifa'},async(url)=>{
  if(url.startsWith('https://api.busnearby.co.il'))primary++;
  else secondary++;
  return response('',429);
 },NOW);
 assert.equal(primary,1);assert.equal(secondary,1);
 assert.equal(JSON.parse(r.content[0].text).retryable,true);
});
test('Official rail HTML parser extracts only real document content from main',()=>{
 const html='<html><nav><h2>רכבת הטבות</h2></nav><main><h2>שינויים בתנועת הרכבות באזור חיפה</h2><p>בין התאריכים 16 עד 18 באוקטובר יחולו שינויים בתנועת הרכבות בשל עבודות תשתית חיוניות.</p><h2>פרטי קשר</h2><p>קצר</p></main></html>';
 const items=parseOfficialRailUpdates(html);
 assert.equal(items.length,1);assert.match(items[0].title,/שינויים/);
});
test('JS-only official page returns unavailable, never zero updates',async()=>{
 const r=await getRailServiceUpdates(async()=>response('<html><body>Please enable JavaScript</body></html>'),NOW);
 assert.equal(r.isError,true);assert.match(r.content[0].text,/OFFICIAL_RAIL_NOTICES_UNAVAILABLE/);
 assert.match(r.content[0].text,/Do not interpret/);
});
test('Official rail page HTTP 404 returns unavailable and official source link',async()=>{
 const r=await getRailServiceUpdates(async(url)=>{assert.equal(url,RAIL_UPDATES_URL);return response('',404);},NOW);
 assert.equal(r.isError,true);assert.match(r.content[0].text,/404/);
});
test('Official rail HTML source data can be extracted without claiming currently active',async()=>{
 const r=await getRailServiceUpdates(async()=>response('<main><article><h2>שינויים בתנועת הרכבות בצפון</h2><p>יתכנו שינויים ברכבות בעקבות עבודות בתחנות בצפון במשך השבוע.</p></article></main>'),NOW);
 assert.equal(r.isError,false);assert.equal(r.structuredContent.notice_count,1);
 assert.match(r.structuredContent.caveat,/effective date/);
});