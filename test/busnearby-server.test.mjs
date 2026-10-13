import test from 'node:test';
import assert from 'node:assert/strict';
import {callBusNearby,parseDirectionsArgs,parseGeocodeArgs,processBusNearbyRequest,validatePlace} from '../server/busnearby-server.mjs';
const NOW=()=>new Date('2026-10-13T00:42:00.000Z');
const mkResponse=(payload,status=200)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},text:async()=>JSON.stringify(payload)});
const origin='Jerusalem::31.778,35.235';
const destination='Tel Aviv::32.080,34.780';

test('BusNearby MCP initializes and exposes exactly upstream geocode and directions tools',async()=>{
 const x=await processBusNearbyRequest({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});
 assert.equal(x.result.serverInfo.name,'busnearby-israel');
 const t=await processBusNearbyRequest({jsonrpc:'2.0',id:2,method:'tools/list'});
 assert.deepEqual(t.result.tools.map(v=>v.name),['geocode','directions']);
 assert.ok(t.result.tools.every(v=>v.annotations.readOnlyHint));
 assert.equal(await processBusNearbyRequest({jsonrpc:'2.0',method:'notifications/initialized'}),null);
});
test('Geocode passes Hebrew location safely to exact upstream API',async()=>{
 let request;
 const fetchFn=async(url,opts)=>{request={url,opts};return mkResponse([{description:'Jerusalem',lat:31.78,lng:35.23}]);};
 const result=await callBusNearby('geocode',{locale:'he',query:'Jerusalem'},fetchFn,NOW);
 assert.equal(result.isError,false);
 assert.equal(new URL(request.url).origin,'https://api.busnearby.co.il');
 assert.equal(new URL(request.url).pathname,'/geocode');
 assert.equal(new URL(request.url).searchParams.get('locale'),'he');
 assert.equal(new URL(request.url).searchParams.get('query'),'Jerusalem');
 assert.equal(result.structuredContent.result[0].lat,31.78);
 assert.equal(result.structuredContent.retrieved_at,'2026-10-13T00:42:00.000Z');
});
test('Directions pass Shmuelmb parameters, defaults, date and realTime unchanged',async()=>{
 let request;
 const fetchFn=async(url,opts)=>{request=new URL(url);return mkResponse({plan:{itineraries:[{legs:[{realTime:false,route:'31'}]}]}});};
 const result=await callBusNearby('directions',{fromPlace:origin,toPlace:destination,date:'2026-10-14',time:'13:30',wheelchair:true},fetchFn,NOW);
 assert.equal(result.isError,false);
 assert.equal(request.pathname,'/directions');
 assert.equal(request.searchParams.get('fromPlace'),origin);
 assert.equal(request.searchParams.get('toPlace'),destination);
 assert.equal(request.searchParams.get('numItineraries'),'3');
 assert.equal(request.searchParams.get('maxWalkDistance'),'1207');
 assert.equal(request.searchParams.get('optimize'),'QUICK');
 assert.equal(request.searchParams.get('wheelchair'),'true');
 assert.equal(request.searchParams.get('date'),'2026-10-14');
 assert.equal(request.searchParams.get('time'),'13:30');
 assert.equal(result.structuredContent.result.plan.itineraries[0].legs[0].realTime,false);
});
test('Coordinates, invalid modes, dates, missing date/time, and excessive alternatives rejected offline',async()=>{
 assert.throws(()=>validatePlace('Tel Aviv'),/match/);
 assert.throws(()=>validatePlace('X::97.2,35'),/coordinates/);
 assert.throws(()=>parseDirectionsArgs({fromPlace:origin,toPlace:destination,date:'2026-10-15'}),/both/);
 assert.throws(()=>parseDirectionsArgs({fromPlace:origin,toPlace:destination,date:'2026-02-30',time:'10:00'}),/exist/);
 assert.throws(()=>parseDirectionsArgs({fromPlace:origin,toPlace:destination,mode:'FLY'}),/Unsupported/);
 assert.throws(()=>parseDirectionsArgs({fromPlace:origin,toPlace:destination,numItineraries:1000}),/1..5/);
 assert.throws(()=>parseGeocodeArgs({query:''}),/nonempty/);
 let called=false;
 const result=await callBusNearby('directions',{fromPlace:'not a place',toPlace:destination},()=>{called=true},NOW);
 assert.equal(called,false);assert.equal(result.isError,true);
});
test('No invented route on upstream provider failure',async()=>{
 const result=await callBusNearby('directions',{fromPlace:origin,toPlace:destination},async()=>mkResponse({error:'unavailable'},502),NOW);
 assert.equal(result.isError,true);
 assert.match(result.content[0].text,/provider call failed/i);
});
test('CLI reports unsupported tool without calling remote API',async()=>{
 const result=await processBusNearbyRequest({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'get_bus_location',arguments:{}}});
 assert.equal(result.error.code,-32602);
});
