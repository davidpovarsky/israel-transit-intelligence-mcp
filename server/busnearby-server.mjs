#!/usr/bin/env node
/**
 * BusNearby MCP portable adapter, based on the documented capabilities and
 * request semantics of Shmuelmb/busnearby-mcp (ISC licensed).
 * Upstream: https://github.com/Shmuelmb/busnearby-mcp
 *
 * Unlike the upstream TypeScript package, this portable Node 18+ entrypoint
 * implements the two MCP tools directly without npm dependencies, Docker or
 * an additional remotely hosted MCP service. It calls the public BusNearby API
 * over HTTPS and does not store data, location history or credentials.
 */
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BASE_URL = 'https://api.busnearby.co.il';
export const SERVER_NAME = 'busnearby-israel';
export const SERVER_VERSION = '1.3.0';
const VALID_OPTIMIZE = new Set(['QUICK','SAFE','FLAT','GREENWAYS','TRIANGLE']);
const VALID_MODES = new Set(['WALK','TRANSIT','TRAM','RAIL','BUS','CABLE_CAR','SHARE_TAXI']);

export const tools = [
  {
    name: 'geocode',
    title: 'BusNearby - geocode an address or place in Israel',
    description: 'Convert a Hebrew/English Israeli place name or address into coordinates. Feed the returned formatted address and coordinates to the directions tool; verify duplicate place names.',
    inputSchema: {
      type:'object',
      properties: {locale:{type:'string',enum:['he','en'],default:'he'}, query:{type:'string',minLength:1,maxLength:250}},
      required:['query'], additionalProperties:false
    },
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  {
    name: 'directions',
    title: 'BusNearby - transit directions across Israel',
    description: 'Find transit itineraries, walking legs, transfers, accessibility options and fares if reported by BusNearby. fromPlace/toPlace require "address::lat,lng" from verified geocoding. Check realTime on each leg: planned times are not proof the vehicle is operating.',
    inputSchema: {
      type:'object',
      properties: {
        fromPlace:{type:'string',description:'Origin: formatted_address::latitude,longitude'},
        toPlace:{type:'string',description:'Destination: formatted_address::latitude,longitude'},
        locale:{type:'string',enum:['he','en'],default:'he'},
        arriveBy:{type:'boolean',default:false},
        wheelchair:{type:'boolean',default:false},
        mode:{type:'string',default:'WALK,TRANSIT'},
        showIntermediateStops:{type:'boolean',default:true},
        numItineraries:{type:'integer',minimum:1,maximum:5,default:3},
        maxWalkDistance:{type:'string',default:'1207',description:'Max walking distance in meters'},
        optimize:{type:'string',enum:[...VALID_OPTIMIZE],default:'QUICK'},
        ignoreRealtimeUpdates:{type:'boolean',default:false},
        date:{type:'string',description:'YYYY-MM-DD (requires time too)'},
        time:{type:'string',description:'HH:MM Israel local time (requires date too)'}
      },
      required:['fromPlace','toPlace'],additionalProperties:false
    },
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  }
];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bool = (v, d, key) => {
  if(v === undefined) return d;
  if(typeof v !== 'boolean') throw new TypeError(`${key} must be a boolean`);
  return v;
};
const choice = (v, d, allowed, key) => {
  if(v === undefined) return d;
  if(typeof v !== 'string' || !allowed.has(v)) throw new TypeError(`${key} must be ${[...allowed].join('/')}`);
  return v;
};
const bounded = (v,max,key) => {
  if(typeof v !== 'string' || !v.trim() || v.length > max) throw new TypeError(`${key} must be nonempty string (max ${max})`);
  return v.trim();
};
export function validatePlace(raw, name='place') {
  const value=bounded(raw,300,name);
  const match=/^(.+)::(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
  if(!match) throw new TypeError(`${name} must match formatted_address::latitude,longitude`);
  const lat=Number(match[2]);const lng=Number(match[3]);
  if(!(lat>=-90&&lat<=90&&lng>=-180&&lng<=180)) throw new TypeError(`${name} coordinates outside geographic bounds`);
  return value;
}
export function parseGeocodeArgs(args) {
  if(!isObject(args)) throw new TypeError('Tool arguments must be an object');
  return { locale:choice(args.locale,'he',new Set(['he','en']),'locale'), query:bounded(args.query,250,'query') };
}
export function parseDirectionsArgs(args) {
  if(!isObject(args)) throw new TypeError('Tool arguments must be an object');
  const p={
    fromPlace:validatePlace(args.fromPlace,'fromPlace'),
    toPlace:validatePlace(args.toPlace,'toPlace'),
    arriveBy:bool(args.arriveBy,false,'arriveBy'),
    locale:choice(args.locale,'he',new Set(['he','en']),'locale'),
    wheelchair:bool(args.wheelchair,false,'wheelchair'),
    mode:args.mode===undefined?'WALK,TRANSIT':bounded(args.mode,100,'mode').toUpperCase(),
    showIntermediateStops:bool(args.showIntermediateStops,true,'showIntermediateStops'),
    numItineraries:args.numItineraries===undefined?3:args.numItineraries,
    maxWalkDistance:args.maxWalkDistance===undefined?'1207':String(args.maxWalkDistance),
    optimize:choice(args.optimize,'QUICK',VALID_OPTIMIZE,'optimize'),
    ignoreRealtimeUpdates:bool(args.ignoreRealtimeUpdates,false,'ignoreRealtimeUpdates')
  };
  if(p.mode.split(',').some(mode=>!VALID_MODES.has(mode.trim()))) throw new TypeError('Unsupported transit mode');
  if(!Number.isInteger(p.numItineraries)||p.numItineraries<1||p.numItineraries>5) throw new TypeError('numItineraries must be integer 1..5');
  if(!/^\d{1,6}$/.test(p.maxWalkDistance)||Number(p.maxWalkDistance)>20000) throw new TypeError('maxWalkDistance must be 0..20000 meters');
  const hasDate=args.date!==undefined;const hasTime=args.time!==undefined;
  if(hasDate!==hasTime) throw new TypeError('date and time must both be supplied or both omitted');
  if(hasDate) {
    if(typeof args.date!=='string'|| !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new TypeError('date must be YYYY-MM-DD');
    const date=new Date(`${args.date}T00:00:00Z`);
    if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==args.date) throw new TypeError('date must exist');
    if(typeof args.time!=='string'|| !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.time)) throw new TypeError('time must be HH:MM');
    p.date=args.date;p.time=args.time;
  }
  return p;
}
function ok(obj) {
  return {content:[{type:'text',text:JSON.stringify(obj,null,2)}],structuredContent:obj,isError:false};
}
function toolError(msg, meta={}) {return {content:[{type:'text',text:JSON.stringify({error:msg,...meta})}],isError:true};}

async function getJSON(endpoint, params, fetchFn, nowFn) {
  const url = new URL(endpoint, BASE_URL);
  for(const [k,v] of Object.entries(params)) if(v!==undefined) url.searchParams.set(k,String(v));
  const controller = new AbortController();
  const timeout=setTimeout(()=>controller.abort(),13000);
  timeout.unref?.();
  try {
    const res=await fetchFn(url.toString(),{method:'GET',signal:controller.signal,redirect:'error'});
    const retrievedAt=nowFn().toISOString();
    if(!res.ok) {
      const error = new Error(`HTTP ${res.status} from BusNearby API`);
      error.http_status=res.status;
      error.provider_code=res.status===403?'PROVIDER_FORBIDDEN':res.status===429?'PROVIDER_RATE_LIMITED':'PROVIDER_HTTP_ERROR';
      const retryAfter=res.headers?.get?.('retry-after');
      if(retryAfter && retryAfter.length<100) error.retry_after=retryAfter;
      // No automatic retries on 403: provider access restrictions must be respected.
      throw error;
    }
    const length=Number(res.headers?.get?.('content-length'));
    if(Number.isFinite(length)&&length>950000) throw new Error('Response too large');
    const raw=await res.text();
    if(Buffer.byteLength(raw,'utf8')>950000) throw new Error('Response too large');
    let parsed;
    try {parsed=JSON.parse(raw);} catch {throw new Error('BusNearby returned invalid JSON');}
    if(parsed===null || typeof parsed!=='object') throw new Error('BusNearby returned unexpected response type');
    return {parsed, retrievedAt};
  } finally {clearTimeout(timeout);}
}

export async function callBusNearby(name,args,fetchFn=globalThis.fetch,nowFn=()=>new Date()) {
  let parsedArgs;
  try {parsedArgs=name==='geocode'?parseGeocodeArgs(args):parseDirectionsArgs(args);} catch(err){return toolError(String(err.message||err));}
  try {
    const {parsed,retrievedAt}=await getJSON(name==='geocode'?'/geocode':'/directions',parsedArgs,fetchFn,nowFn);
    if(name==='geocode' && !Array.isArray(parsed)) return toolError('Expected geocoding results array, got a different provider response', {provider:'BusNearby',retrieved_at:retrievedAt});
    if(name==='directions' && (!isObject(parsed)||!isObject(parsed.plan))) return toolError('BusNearby route plan missing/invalid', {provider:'BusNearby',retrieved_at:retrievedAt});
    return ok({source:'BusNearby API via Shmuelmb MCP portable integration',provider:'BusNearby',retrieved_at:retrievedAt,timezone:'Asia/Jerusalem',data_kind:name==='geocode'?'PLACE_GEOCODING':'TRANSIT_ROUTE_PLAN', caveat:name==='directions'?'Real-time may be present on individual transit legs, but not every trip or leg is verified live. Check leg.realTime and delays; confirm service updates separately.':'Disambiguate duplicate addresses/place names before routing.', result:parsed});
  } catch(err) {
    return toolError('BusNearby provider call failed',{
      provider:'BusNearby',tool:name,provider_code:err?.provider_code||'NETWORK_OR_FORMAT_ERROR',
      http_status:err?.http_status??null,retry_after:err?.retry_after??null,
      retryable:[429,502,503,504].includes(err?.http_status),
      detail:String(err?.message||err).slice(0,200),
      caveat:err?.http_status===403?'Provider denied access. Do not bypass access controls or invent geocoding/directions.':'Do not invent missing routes or locations.'
    });
  }
}

export async function processBusNearbyRequest(request,deps={}) {
  const hasId=isObject(request)&&Object.prototype.hasOwnProperty.call(request,'id');
  const id=hasId?request.id:null;
  if(!isObject(request) || request.jsonrpc!=='2.0'|| typeof request.method!=='string') return {jsonrpc:'2.0',id,error:{code:-32600,message:'Invalid Request'}};
  if(!hasId) return null; // Notifications never generate a JSON-RPC response.
  const good=result=>({jsonrpc:'2.0',id,result});
  const bad=(code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
  if(request.method==='initialize')return good({protocolVersion:request.params?.protocolVersion||'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:SERVER_NAME,version:SERVER_VERSION}});
  if(request.method==='ping')return good({});
  if(request.method==='tools/list')return good({tools});
  if(request.method==='tools/call') {
    const name=request.params?.name;
    if(name!=='geocode'&&name!=='directions') return bad(-32602,'Unknown tool name');
    return good(await callBusNearby(name,request.params?.arguments||{},deps.fetchFn||globalThis.fetch,deps.nowFn||(()=>new Date())));
  }
  return bad(-32601,'Method not found');
}

async function run() {
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of lines){
    let response;
    try {response=await processBusNearbyRequest(JSON.parse(line));}
    catch(error){response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}; console.error('[busnearby] input error:',String(error?.message||error).slice(0,160));}
    if(response!==null)process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(err=>{console.error('[busnearby] fatal:',err);process.exitCode=1;});