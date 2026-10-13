/** GitHub CI optional, single-read source checks. No credentials or location history. */
import {getCurlbusArrivals,getOfficialGtfsMetadata,getRailServiceUpdates} from '../server/live-server.mjs';
import {callBusNearby} from '../server/busnearby-server.mjs';
import {callOpenBus} from '../server/openbus-server.mjs';
const probes=[
  ['Curlbus arrivals at public stop 5200',()=>getCurlbusArrivals({stop_code:'5200'})],
  ['Official GTFS metadata',()=>getOfficialGtfsMetadata()],
  ['BusNearby geocode',()=>callBusNearby('geocode',{query:'ירושלים'})],
  ['OpenBus stop lookup',()=>callOpenBus('find_stops',{city:'ירושלים',limit:1})],
  ['Official Railways notices HTML fallback',()=>getRailServiceUpdates()]
];
for(const [name,fn] of probes){
 try{
  const result=await fn();
  const data=result.structuredContent;
  const details=result.isError?JSON.parse(result.content?.[0]?.text||'{}'):{};
  console.log(JSON.stringify({probe:name,result:result.isError?'UNAVAILABLE':'OK',
    source_time:data?.retrieved_at??data?.checked_at??null,
    count:data?.visit_count??data?.notice_count??data?.count??data?.result?.length??null,
    payload_keys:name.startsWith('Curlbus')?Object.keys(data?.provider_data??{}).slice(0,12):undefined,
    http_status:details.http_status??null,provider_code:details.provider_code??null,
    error:details.error??null}));
 }catch(err){console.log(JSON.stringify({probe:name,result:'ERROR',error:String(err.message||err).slice(0,150)}));}
}
console.log('Provider diagnostics completed. Results are diagnostic, not acceptance criteria.');

// Optional publicly documented, independent sources. Not a bypass of provider access restrictions.
const independentSources=[
 ['Official rail updates canonical page','https://www.rail.co.il/updates'],
 ['Unofficial railway.co.il updates aggregator','https://railway.co.il/'+encodeURIComponent('רכבת-ישראל-עדכונים')],
 ['OSM Nominatim public geocode','https://nominatim.openstreetmap.org/search?format=json&countrycodes=il&limit=1&q='+encodeURIComponent('Jerusalem')]
];
for(const [name,url] of independentSources){
 try{
  const res=await fetch(url,{headers:{'User-Agent':'IsraelTransitIntelligence/1.3 (https://github.com/davidpovarsky/israel-transit-intelligence-mcp)'},signal:AbortSignal.timeout(12000),redirect:'error'});
  const raw=await res.text();
  console.log(JSON.stringify({probe:name,status:res.status,length:raw.length,html_main:/<main\b/i.test(raw),
   headings:(raw.match(/<h[1-3]\b/gi)||[]).length,
   data_array:raw.trim().startsWith('[')}));
 }catch(e){console.log(JSON.stringify({probe:name,result:'ERROR',error:String(e.message||e).slice(0,150)}));}
}