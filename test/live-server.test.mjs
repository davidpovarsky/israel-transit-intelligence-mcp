import test from 'node:test';
import assert from 'node:assert/strict';
import {getCurlbusArrivals,getOfficialGtfsMetadata,processRequest} from '../server/live-server.mjs';
const FIXED=()=>new Date('2026-10-13T00:00:00.000Z');
const mkHeaders=(data)=>({get:(name)=>data[name.toLowerCase()]??null});

test('MCP initializes and advertises three read-only tools', async()=>{
  const a=await processRequest({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});
  assert.equal(a.result.serverInfo.name,'israel-curlbus-fallback');
  const b=await processRequest({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.deepEqual(b.result.tools.map(t=>t.name), ['get_curlbus_arrivals','get_official_gtfs_metadata','get_rail_service_updates','get_transit_source_links']);
  assert.ok(b.result.tools.every(t=>t.annotations.readOnlyHint));
  assert.equal(await processRequest({jsonrpc:'2.0',method:'notifications/initialized'}),null);
});
test('Reject invalid stop codes without calling network',async()=>{
  let called=false;
  const r=await getCurlbusArrivals({stop_code:'71/gilo'},()=>{called=true},FIXED);
  assert.equal(r.isError,true);
  assert.equal(called,false);
});
test('Positive Curlbus JSON is returned without inventing an ETA',async()=>{
  const urls=[];
  const fetchFn=async(u,opts)=>{urls.push(u);assert.equal(opts.headers.Accept,'application/json');return {ok:true,status:200,headers:mkHeaders({'date':'Tue, 13 Oct 2026 00:00:00 GMT'}),text:async()=>JSON.stringify({visits:[{line:'31',eta:5}],metadata:'example'})}};
  const r=await getCurlbusArrivals({stop_code:'01234'},fetchFn,FIXED);
  assert.equal(r.isError,false); assert.deepEqual(urls,['https://curlbus.app/01234']);
  assert.equal(r.structuredContent.stop_code,'01234');
  assert.equal(r.structuredContent.visit_count,1);
  assert.equal(r.structuredContent.retrieved_at,'2026-10-13T00:00:00.000Z');
  assert.equal(r.structuredContent.provider_data.visits[0].eta,5);
});
test('Empty visits are distinct from cancellation',async()=>{
  const r=await getCurlbusArrivals({stop_code:'44'},async()=>({ok:true,status:200,headers:mkHeaders({}),text:async()=>'{"visits":[]}'}),FIXED);
  assert.equal(r.structuredContent.empty_visits,true);
  assert.match(r.structuredContent.caveat,/does not establish a cancellation/);
});
test('HEAD official feed only, not a giant ZIP download',async()=>{
  let method;
  const r=await getOfficialGtfsMetadata(async(u,opts)=>{method=opts.method;return {ok:true,status:200,headers:mkHeaders({'last-modified':'Mon, 12 Oct 2026 01:00:00 GMT','content-length':'5000'})}},FIXED);
  assert.equal(method,'HEAD');assert.equal(r.structuredContent.data_kind,'STATIC GTFS file metadata — NOT live ETA');
});
test('JSON-RPC tools/call routes to backend and returns errors cleanly',async()=>{
  const r=await processRequest({jsonrpc:'2.0',id:13,method:'tools/call',params:{name:'get_transit_source_links'}},{nowFn:FIXED});
  assert.equal(r.result.structuredContent.network_requested,false);
  assert.ok(r.result.structuredContent.sources.railway);
  const bad=await processRequest({jsonrpc:'2.0',id:14,method:'tools/call',params:{name:'unknown'}});
  assert.equal(bad.error.code,-32602);
});