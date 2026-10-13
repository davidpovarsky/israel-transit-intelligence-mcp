import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOpenBusUrl,normalizeOpenBusArgs,verifyLiveLocations,callOpenBus,processOpenBusRequest,tools} from '../server/openbus-server.mjs';
const NOW=new Date('2026-10-13T18:35:00Z'); // 21:35 in Jerusalem
const json = data => ({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(data)});

test('Seven original tool names kept; capabilities advertise planned vs observed',async()=>{
 assert.deepEqual(tools.map(t=>t.name),['find_stops','search_routes','get_stop_arrivals','get_route_timetable','get_ride_performance','list_agencies','get_vehicle_locations']);
 const msg=await processOpenBusRequest({jsonrpc:'2.0',id:1,method:'tools/list'});
 assert.equal(msg.result.tools.length,7);
 assert.match(msg.result.tools[2].description,/PLANNED/);
});
test('Position coordinates map to verified API parameter names with descending sort',()=>{
 const u=buildOpenBusUrl('get_vehicle_locations',{lat_min:31.7,lat_max:31.9,lon_min:35,lon_max:35.5,limit:20},NOW);
 assert.equal(u.searchParams.get('lat__greater_or_equal'),'31.7');
 assert.equal(u.searchParams.get('lat__lower_or_equal'),'31.9');
 assert.equal(u.searchParams.get('lon__greater_or_equal'),'35');
 assert.equal(u.searchParams.get('lon__lower_or_equal'),'35.5');
 assert.equal(u.searchParams.get('order_by'),'recorded_at_time desc');
 assert.equal(u.searchParams.get('recorded_at_time_from'),'2026-10-13T18:28:00.000Z');
 assert.equal(u.searchParams.get('lat_min'),null);
});
test('Date conversion uses Israel timezone and handles winter/summer DST',()=>{
 const a=normalizeOpenBusArgs('get_route_timetable',{planned_start_time_date_from:'2026-10-13',planned_start_time_date_to:'2026-10-13'});
 assert.equal(a.planned_start_time_date_from,'2026-10-12T21:00:00.000Z');
 assert.equal(a.planned_start_time_date_to,'2026-10-13T20:59:59.999Z');
 const b=normalizeOpenBusArgs('get_route_timetable',{planned_start_time_date_from:'2026-12-01',planned_start_time_date_to:'2026-12-01'});
 assert.equal(b.planned_start_time_date_from,'2026-11-30T22:00:00.000Z');
 assert.equal(b.planned_start_time_date_to,'2026-12-01T21:59:59.999Z');
});
test('Reject malformed parameters and unbounded queries',()=>{
 assert.throws(()=>normalizeOpenBusArgs('get_vehicle_locations',{lat_min:35,lat_max:31}),/exceeds/);
 assert.throws(()=>normalizeOpenBusArgs('get_vehicle_locations',{lat_min:100}),/lat_min/);
 assert.throws(()=>normalizeOpenBusArgs('find_stops',{date_from:'2026-02-30'}),/valid/);
 assert.throws(()=>normalizeOpenBusArgs('find_stops',{order_by:'DROP TABLE'}),/Unknown/);
 assert.throws(()=>normalizeOpenBusArgs('get_stop_arrivals',{}),/Missing/);
});
test('Observed time alone does not certify stale snapshot or old scheduled ride',()=>{
 const raw={lat:31.8,lon:35.2,recorded_at_time:'2026-10-13T18:34:00Z',siri_snapshot__snapshot_id:'2025/10/13/21/34',siri_ride__scheduled_start_time:'2026-10-13T18:00:00Z'};
 const a=verifyLiveLocations([raw],NOW);
 assert.equal(a.status,'LIVE_LOCATION_UNAVAILABLE');assert.equal(a.rejection_reasons.snapshot_missing_or_mismatched,1);
 const b=verifyLiveLocations([{...raw,siri_snapshot__snapshot_id:'2026/10/13/21/34',siri_ride__scheduled_start_time:'2025-10-13T18:00:00Z'}],NOW);
 assert.equal(b.status,'LIVE_LOCATION_UNAVAILABLE');assert.equal(b.rejection_reasons.scheduled_ride_missing_or_stale,1);
});
test('Recent consistent rows are explicitly qualified, not guaranteed GPS',()=>{
 const row={lat:31.8,lon:35.2,recorded_at_time:'2026-10-13T18:34:00Z',siri_snapshot__snapshot_id:'2026/10/13/21/34',siri_ride__scheduled_start_time:'2026-10-13T18:00:00Z'};
 const r=verifyLiveLocations([row],NOW);
 assert.equal(r.status,'RECENT_CONSISTENT_SOURCE_RECORDS');assert.equal(r.verified,1);assert.equal(r.is_gps_live_guaranteed,false);
});
test('No rows never claims GPS live; planned arrivals explicitly labelled',async()=>{
 const a=await callOpenBus('get_vehicle_locations',{},async()=>json([]),()=>NOW);
 assert.equal(a.structuredContent.status,'LIVE_LOCATION_UNAVAILABLE');
 const b=await callOpenBus('get_stop_arrivals',{gtfs_stop_id:123},async()=>json([{planned:'13:30'}]),()=>NOW);
 assert.equal(b.structuredContent.data_kind,'PLANNED_GTFS_NOT_LIVE');
});
test('Provider error is reported; never manufactures positions',async()=>{
 const r=await callOpenBus('get_vehicle_locations',{},async()=>({ok:false,status:503}),()=>NOW);
 assert.equal(r.isError,true);assert.match(r.content[0].text,/503/);
});