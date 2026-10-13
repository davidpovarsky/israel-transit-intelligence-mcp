import test from 'node:test';
import assert from 'node:assert/strict';
import {callBusNearby} from '../server/busnearby-server.mjs';
import {getRailServiceUpdates,parseOfficialRailUpdates,RAIL_UPDATES_URL} from '../server/live-server.mjs';
const NOW=()=>new Date('2026-10-13T18:35:00Z');
const response=(html,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:{get:k=>headers[k.toLowerCase()]??null},text:async()=>html});
test('BusNearby 403 is explicit nonretryable provider restriction and sends no custom user-agent',async()=>{
 let request;
 const result=await callBusNearby('geocode',{query:'ירושלים'},async(url,opts)=>{request=opts;return response('',403,{'retry-after':'40'});},NOW);
 assert.equal(result.isError,true);
 const data=JSON.parse(result.content[0].text);
 assert.equal(data.provider_code,'PROVIDER_FORBIDDEN');assert.equal(data.http_status,403);assert.equal(data.retryable,false);
 assert.equal(data.retry_after,'40');assert.equal(request.headers,undefined);
});
test('BusNearby 429 reports retryable without retrying automatically',async()=>{
 let n=0;
 const r=await callBusNearby('geocode',{query:'Jerusalem'},async()=>{n++;return response('',429);},NOW);
 assert.equal(n,1);assert.equal(JSON.parse(r.content[0].text).retryable,true);
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