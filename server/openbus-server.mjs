#!/usr/bin/env node
/** Portable OpenBus MCP adapter: corrected API filter names, safe ordering,
 * and fail-closed live location verification. Public data, no credentials. */
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BASE = 'https://open-bus-stride-api.hasadna.org.il';
const MAX_LIVE_AGE_MS = 7 * 60_000;
const SOURCE_MISMATCH_MS = 10 * 60_000;
const SERVER_NAME = 'openbus-israel-verified';
const simple = (name, description, props, required=[]) => ({
  name, description, inputSchema:{type:'object',properties:props,required,additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}
});
const text = description => ({type:'string',description});
const num = description => ({type:'number',description});
const integer = (description,minimum=0,maximum=200) => ({type:'integer',minimum,maximum,description});
const pagination={limit:integer('Maximum results, default 50',1,200),offset:integer('Pagination offset',0,100000)};
export const tools=[
  simple('find_stops','Find GTFS bus stops. A public stop code differs from the internal GTFS stop ID.',{code:integer('Public stop code',1,99999999),city:text('Hebrew or English city name'),date_from:text('YYYY-MM-DD'),date_to:text('YYYY-MM-DD'),...pagination}),
  simple('search_routes','Search planned GTFS bus routes; not live operation confirmation.',{route_short_name:text('Line number'),route_long_name_contains:text('Substring of route description'),agency_name:text('Operator'),route_direction:integer('0 or 1',0,1),date_from:text('YYYY-MM-DD'),date_to:text('YYYY-MM-DD'),...pagination}),
  simple('get_stop_arrivals','IMPORTANT: upstream stop_arrivals currently returns GTFS PLANNED times only, NOT live ETAs. Prefer Curlbus for live arrivals.',{gtfs_stop_id:integer('Internal GTFS stop ID',1,999999999),...pagination},['gtfs_stop_id']),
  simple('get_route_timetable','Planned timetable. Date inputs are Israel-local YYYY-MM-DD and converted to time zone-aware ISO date-times for the upstream API.',{planned_start_time_date_from:text('Israel-local start date YYYY-MM-DD'),planned_start_time_date_to:text('Israel-local end date YYYY-MM-DD'),line_refs:text('Comma-separated internal line refs'),...pagination}),
  simple('get_ride_performance','Historical planned vs executed rides; not live bus tracking.',{date_from:text('YYYY-MM-DD'),date_to:text('YYYY-MM-DD'),operator_ref:integer('Operator ref',1,999999999),line_ref:integer('Line ref',1,999999999),...pagination},['date_from','date_to','operator_ref','line_ref']),
  simple('list_agencies','List public transport operating agencies.',{date_from:text('YYYY-MM-DD'),date_to:text('YYYY-MM-DD'),...pagination}),
  simple('get_vehicle_locations','Recent SIRI positions ONLY if recorded time, snapshot date and scheduled ride date are mutually plausible. Returns UNAVAILABLE rather than stale points. Coordinates are historical observations, not guaranteed continuous GPS.',{lat_min:num('Southern latitude'),lat_max:num('Northern latitude'),lon_min:num('Western longitude'),lon_max:num('Eastern longitude'),siri_routes__line_ref:integer('SIRI line reference ID',1,999999999),siri_routes__operator_ref:integer('SIRI operator reference ID',1,999999999),...pagination})
];
const err = (message,metadata={})=>({isError:true,content:[{type:'text',text:JSON.stringify({error:message,...metadata})}]});
const ok = data=>({isError:false,content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
const isObj = x => x!==null && typeof x==='object' && !Array.isArray(x);
const isDate = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
function checkDate(s,key){if(s!==undefined&&!isDate(s)) throw new TypeError(`${key} must be a valid YYYY-MM-DD`);}
function checkNum(s,key,min,max){if(s!==undefined&&(!Number.isFinite(s)||s<min||s>max)) throw new TypeError(`${key} must be ${min}..${max}`);}
function israelMidnight(date){
  const utc=Date.parse(`${date}T00:00:00Z`);
  const tzone=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',timeZoneName:'shortOffset'});
  const offsetName=tzone.formatToParts(new Date(utc)).find(p=>p.type==='timeZoneName')?.value;
  const match=/GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offsetName??'');
  if(!match) throw new Error('Unable to resolve Israel timezone offset');
  const minutes=Number(match[2])*60+Number(match[3]??'0');
  return utc+(match[1]==='+'?-1:1)*minutes*60_000;
}
function nextDay(date){return new Date(Date.parse(`${date}T00:00:00Z`)+86400000).toISOString().slice(0,10);}
export function normalizeOpenBusArgs(name,input,now=new Date()){
  if(!isObj(input)) throw new TypeError('Arguments must be an object');
  const tool=tools.find(x=>x.name===name);
  if(!tool) throw new TypeError('Unknown OpenBus tool');
  for(const key of Object.keys(input)) if(!(key in tool.inputSchema.properties)) throw new TypeError(`Unknown argument: ${key}`);
  for(const key of tool.inputSchema.required) if(input[key]===undefined) throw new TypeError(`Missing required argument: ${key}`);
  const params={...input};
  for(const key of ['date_from','date_to','planned_start_time_date_from','planned_start_time_date_to']) checkDate(input[key],key);
  for(const key of ['limit','offset','code','route_direction','operator_ref','line_ref','gtfs_stop_id','siri_routes__line_ref','siri_routes__operator_ref']){
    if(input[key]!==undefined && !Number.isInteger(input[key])) throw new TypeError(`${key} must be integer`);
    const spec=tool.inputSchema.properties[key];
    if(spec) checkNum(input[key],key,spec.minimum??0,spec.maximum??Number.MAX_SAFE_INTEGER);
  }
  for(const key of ['lat_min','lat_max']) checkNum(input[key],key,-90,90);
  for(const key of ['lon_min','lon_max']) checkNum(input[key],key,-180,180);
  if(params.lat_min!==undefined&&params.lat_max!==undefined&&params.lat_min>params.lat_max) throw new TypeError('lat_min exceeds lat_max');
  if(params.lon_min!==undefined&&params.lon_max!==undefined&&params.lon_min>params.lon_max) throw new TypeError('lon_min exceeds lon_max');
  if(input.date_from&&input.date_to&&input.date_from>input.date_to) throw new TypeError('date_from exceeds date_to');
  params.limit??=50;
  params.offset??=0;
  if(name==='get_route_timetable'){
    const from=input.planned_start_time_date_from;
    const to=input.planned_start_time_date_to;
    if(from) params.planned_start_time_date_from=new Date(israelMidnight(from)).toISOString();
    if(to) params.planned_start_time_date_to=new Date(israelMidnight(nextDay(to))-1).toISOString();
  }
  if(name==='get_vehicle_locations'){
    params.lat__greater_or_equal=params.lat_min;
    params.lat__lower_or_equal=params.lat_max;
    params.lon__greater_or_equal=params.lon_min;
    params.lon__lower_or_equal=params.lon_max;
    delete params.lat_min;delete params.lat_max;delete params.lon_min;delete params.lon_max;
    params.recorded_at_time_from=new Date(now.getTime()-MAX_LIVE_AGE_MS).toISOString();
    params.recorded_at_time_to=new Date(now.getTime()+60_000).toISOString();
    params.order_by='recorded_at_time desc';
  }
  return params;
}
export function buildOpenBusUrl(name,input,now=new Date()) {
  const endpoints={find_stops:'/gtfs_stops/list',search_routes:'/gtfs_routes/list',get_stop_arrivals:'/stop_arrivals/list',get_route_timetable:'/route_timetable/list',get_ride_performance:'/rides_execution/list',list_agencies:'/gtfs_agencies/list',get_vehicle_locations:'/siri_vehicle_locations/list'};
  if(!endpoints[name]) throw new TypeError('Unknown tool');
  const url=new URL(endpoints[name],BASE);
  for(const [k,v] of Object.entries(normalizeOpenBusArgs(name,input,now))) if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v));
  return url;
}
function israelLocalMillis(date){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return Date.UTC(Number(obj.year),Number(obj.month)-1,Number(obj.day),Number(obj.hour),Number(obj.minute));
}
function snapshotTime(raw){
  if(typeof raw!=='string') return NaN;
  const m=/(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2})/.exec(raw);
  if(!m) return NaN;
  const ints=m.slice(1).map(Number);
  if(ints[1]<1||ints[1]>12||ints[2]<1||ints[2]>31||ints[3]>23||ints[4]>59) return NaN;
  return Date.UTC(ints[0],ints[1]-1,ints[2],ints[3],ints[4]);
}
export function verifyLiveLocations(rows,now=new Date()) {
  const accepted=[],reasons={};
  for(const row of rows){
    let reason=null;
    const rec=Date.parse(row?.recorded_at_time||'');
    const id=row?.siri_snapshot__snapshot_id??row?.siri_snapshot?.snapshot_id;
    const snap=snapshotTime(id);
    const scheduled=Date.parse(row?.siri_ride__scheduled_start_time??row?.siri_ride?.scheduled_start_time??'');
    if(!Number.isFinite(rec)||rec<now.getTime()-MAX_LIVE_AGE_MS||rec>now.getTime()+60_000) reason='recorded_time_not_recent';
    else if(!Number.isFinite(snap)||Math.abs(snap-israelLocalMillis(new Date(rec)))>SOURCE_MISMATCH_MS||Math.abs(snap-israelLocalMillis(now))>MAX_LIVE_AGE_MS+2*60_000) reason='snapshot_missing_or_mismatched';
    else if(!Number.isFinite(scheduled)||scheduled>now.getTime()+2*60*60_000||scheduled<now.getTime()-36*60*60_000) reason='scheduled_ride_missing_or_stale';
    else if(!Number.isFinite(row?.lat)||!Number.isFinite(row?.lon)||row.lat<-90||row.lat>90||row.lon<-180||row.lon>180) reason='coordinates_missing_or_invalid';
    if(reason) reasons[reason]=(reasons[reason]??0)+1;
    else accepted.push(row);
  }
  return {status:accepted.length?'RECENT_CONSISTENT_SOURCE_RECORDS':'LIVE_LOCATION_UNAVAILABLE',
    source:'OpenBus / MOT SIRI',is_gps_live_guaranteed:false,
    caveat:'Observed positions passed timestamp consistency checks; not guaranteed current vehicle GPS. Stale, incomplete or inconsistent records withheld.',
    fetched_at:now.toISOString(),retrieved:rows.length,verified:accepted.length,rejected:rows.length-accepted.length,rejection_reasons:reasons,
    vehicles:accepted};
}
async function apiRequest(url,fetchFn){
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),15_000);timer.unref?.();
  try{
    const response=await fetchFn(url.toString(),{headers:{Accept:'application/json'},signal:ctrl.signal,redirect:'error'});
    if(!response.ok) throw new Error(`OpenBus HTTP ${response.status}`);
    if(Number(response.headers?.get?.('content-length'))>1_800_000)throw new Error('Response too large');
    const body=await response.text();
    if(Buffer.byteLength(body,'utf8')>1_800_000)throw new Error('Response too large');
    const data=JSON.parse(body);
    if(!Array.isArray(data))throw new Error('OpenBus response was not an array');
    return data;
  }finally{clearTimeout(timer);}
}
export async function callOpenBus(name,input,fetchFn=globalThis.fetch,nowFn=()=>new Date()) {
  let url;const now=nowFn();
  try{url=buildOpenBusUrl(name,input,now);}catch(e){return err('Invalid OpenBus arguments',{detail:e.message});}
  try{
    const rows=await apiRequest(url,fetchFn);
    if(name==='get_vehicle_locations')return ok(verifyLiveLocations(rows,now));
    return ok({source:'OpenBus Stride',data_kind:name==='get_stop_arrivals'||name==='get_route_timetable'?'PLANNED_GTFS_NOT_LIVE':'PUBLIC_TRANSIT_DATA',retrieved_at:now.toISOString(),count:rows.length,
      caveat:name==='get_stop_arrivals'?'The API currently provides PLANNED times, not real-time arrival predictions; use Curlbus for live stop visits.':null,result:rows});
  }catch(e){return err('OpenBus source unavailable',{detail:String(e.message||e).slice(0,180),data_kind:'NO_LIVE_DATA_VERIFIED'});}
}
export async function processOpenBusRequest(req,deps={}){
  const hasId=isObj(req)&&Object.prototype.hasOwnProperty.call(req,'id');const id=hasId?req.id:null;
  if(!isObj(req)||req.jsonrpc!=='2.0'||typeof req.method!=='string')return {jsonrpc:'2.0',id,error:{code:-32600,message:'Invalid Request'}};
  if(!hasId)return null;
  const good=result=>({jsonrpc:'2.0',id,result});
  if(req.method==='initialize')return good({protocolVersion:req.params?.protocolVersion||'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:SERVER_NAME,version:'1.3.0'}});
  if(req.method==='ping')return good({});
  if(req.method==='tools/list')return good({tools});
  if(req.method==='tools/call'){
    const name=req.params?.name;
    if(!tools.some(t=>t.name===name))return {jsonrpc:'2.0',id,error:{code:-32602,message:'Unknown tool'}};
    return good(await callOpenBus(name,req.params?.arguments??{},deps.fetchFn??globalThis.fetch,deps.nowFn??(()=>new Date())));
  }
  return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
}
async function run(){
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of input){
    let response;
    try{response=await processOpenBusRequest(JSON.parse(line));}catch(e){console.error('[openbus] parse:',String(e.message||e).slice(0,150));response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}
    if(response!==null)process.stdout.write(JSON.stringify(response)+'\n');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(e=>{console.error('[openbus] fatal:',e);process.exitCode=1;});