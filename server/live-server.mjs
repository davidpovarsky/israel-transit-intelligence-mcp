#!/usr/bin/env node
/**
 * Read-only MCP stdio fallback for public Israeli transit sources.
 * Node 18+. No third-party dependencies, credentials, polling or user storage.
 * Public JSON-RPC messages only on stdout; diagnostics only on stderr.
 */
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SERVER_NAME = 'israel-curlbus-fallback';
export const VERSION = '1.3.0';
const SOURCES = Object.freeze({
  ministryGtfs: 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip',
  ministryDeveloperInfo: 'https://www.gov.il/he/Departments/Topics/developer_information',
  openBusSwagger: 'https://open-bus-stride-api.hasadna.org.il/docs',
  curlbus: 'https://curlbus.app/',
  railway: 'https://www.rail.co.il/',
  fares: 'https://bus.gov.il/FaresDistance',
  discounts: 'https://bus.gov.il/discounts'
});

const toolList = [
  {
    name: 'get_curlbus_arrivals',
    title: 'Get real-time bus arrivals by Israeli public stop code',
    description: 'Fetch stop-code arrivals from public Curlbus JSON. Returns data, provider response timestamp if present, and retrieval time. Do not equate empty visits with cancellation, nor confuse a public stop code with a GTFS stop_id. Use only numeric public codes.',
    inputSchema: { type: 'object', properties: { stop_code: {type:'string', description:'Public numeric stop code posted on the bus stop, 1-8 digits.'} }, required: ['stop_code'], additionalProperties:false },
    annotations: {readOnlyHint:true, destructiveHint:false, openWorldHint:true}
  },
  {
    name: 'get_official_gtfs_metadata',
    title: 'Check national GTFS feed metadata',
    description: 'HEAD-only check of the official Israeli Ministry of Transport static GTFS ZIP (last-modified, length, status). This is NOT a trip or live arrival lookup; does not download the large ZIP.',
    inputSchema: {type:'object', properties:{}, additionalProperties:false},
    annotations: {readOnlyHint:true, destructiveHint:false, openWorldHint:true}
  },
  {
    name: 'get_rail_service_updates',
    title: 'Read notices from the official Israel Railways update webpage',
    description: 'Fetch public rail.co.il official updates. Report notices only if visible content can be extracted and attributed to the official site; when JavaScript-only or blocked, return SOURCE_UNAVAILABLE rather than claiming no disruptions.',
    inputSchema: {type:'object',properties:{},additionalProperties:false},
    annotations: {readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  {
    name: 'get_transit_source_links',
    title: 'Find verified Israel public transit source links',
    description: 'Return the fixed official and community URLs that this MCP uses. No network request.',
    inputSchema: {type:'object', properties:{}, additionalProperties:false},
    annotations: {readOnlyHint:true, destructiveHint:false, openWorldHint:false}
  }
];

function toolSuccess(data) {
  return { content: [{ type:'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, isError:false };
}
function toolError(message, meta={}) {
  return { content: [{ type:'text', text: JSON.stringify({error:message, ...meta}) }], isError:true };
}
function abortAfter(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  if (typeof timeout.unref === 'function') timeout.unref();
  return {controller, cleanup:() => clearTimeout(timeout)};
}
function normalizeCode(code) {
  if (typeof code !== 'string' && typeof code !== 'number') return null;
  const clean = String(code).trim();
  return /^\d{1,8}$/.test(clean) ? clean : null;
}
async function readLimitedText(response, maxBytes=160000) {
  const declaredSize = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error('Provider payload too large');
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('Provider payload too large');
  return body;
}

export async function getCurlbusArrivals(args, fetchFn=globalThis.fetch, nowFn=()=>new Date()) {
  const stopCode = normalizeCode(args?.stop_code);
  if (!stopCode) return toolError('Invalid public stop code; expected 1-8 numeric digits. Do not use line number, street name, or GTFS route ID.');
  const url = `https://curlbus.app/${stopCode}`;
  const {controller,cleanup} = abortAfter(9000);
  try {
    const response = await fetchFn(url, {method:'GET', headers: {'Accept':'application/json','User-Agent':'IsraelTransitIntelligence/1.0'}, signal:controller.signal, redirect:'error'});
    const readAt=nowFn().toISOString();
    if (!response.ok) return toolError('Curlbus HTTP error', {provider:'Curlbus', url, http_status:response.status, retrieved_at:readAt});
    const text = await readLimitedText(response);
    let data;
    try {data=JSON.parse(text);} catch {return toolError('Provider returned non-JSON response', {provider:'Curlbus', url, retrieved_at:readAt});}
    if (!data || typeof data !== 'object' || Array.isArray(data)) return toolError('Provider returned unexpected JSON structure', {provider:'Curlbus', url, retrieved_at:readAt});
    // Curlbus's documented JSON API serializes visits as a map keyed by the
    // requested public stop code. Earlier adapters mistakenly expected an array.
    const sourceVisits=data.visits;
    const visits=Array.isArray(sourceVisits) ? sourceVisits :
      sourceVisits && typeof sourceVisits==='object' && !Array.isArray(sourceVisits)
        ? (sourceVisits[stopCode] ?? sourceVisits[String(Number(stopCode))] ?? null)
        : null;
    const providerErrors=Array.isArray(data.errors)?data.errors:[];
    if(!Array.isArray(visits))return toolError('Curlbus response missing visits list for requested stop',{
      provider:'Curlbus',stop_code:stopCode,retrieved_at:readAt,
      reason:'SCHEMA_MISMATCH_OR_NO_MATCHING_STOP',provider_errors:providerErrors,
      important:'Do not interpret missing visits as no scheduled buses or as a cancellation.'
    });
    const payload={
      source:'Curlbus (community; not an official MOT publication)',
      stop_code:stopCode,
      retrieved_at:readAt,
      provider_http_date:response.headers?.get?.('date')||null,
      data_kind:'provider_arrival_data; live/scheduled distinction depends on upstream fields',
      visit_count:visits.length,
      empty_visits:visits.length===0,
      visits,
      provider_errors:providerErrors,
      caveat:'A missing/empty visit does not establish a cancellation; verify direction, stop code, operator and source freshness.',
      provider_data: data
    };
    // Bound output even when provider returns unexpectedly verbose payloads.
    const outJson=JSON.stringify(payload);
    if (Buffer.byteLength(outJson,'utf8')>100000) return toolError('Provider JSON too large to safely return', {stop_code:stopCode, retrieved_at:readAt});
    return toolSuccess(payload);
  } catch(err) {
    const category=err?.name==='AbortError'?'timeout':'fetch_failed';
    return toolError('Could not verify stop arrivals at this time', {provider:'Curlbus', url, category, detail:String(err?.message || err).slice(0,240)});
  } finally {cleanup();}
}

export async function getOfficialGtfsMetadata(fetchFn=globalThis.fetch, nowFn=()=>new Date()) {
  const {controller,cleanup}=abortAfter(9000);
  try {
    const response=await fetchFn(SOURCES.ministryGtfs, {method:'HEAD', headers:{'User-Agent':'IsraelTransitIntelligence/1.0'}, signal:controller.signal, redirect:'error'});
    const data={source:'Israel Ministry of Transport', data_kind:'STATIC GTFS file metadata — NOT live ETA', endpoint:SOURCES.ministryGtfs, http_status:response.status, available:response.ok, checked_at:nowFn().toISOString(), modified_at:response.headers?.get?.('last-modified')||null, content_length:response.headers?.get?.('content-length')||null, etag:response.headers?.get?.('etag')||null};
    return response.ok?toolSuccess(data):toolError('Official GTFS HEAD request returned error', data);
  } catch(err){return toolError('Could not check official GTFS endpoint', {source:SOURCES.ministryGtfs, detail:String(err?.message||err).slice(0,240)});}
  finally{cleanup();}
}


// The official page may be JS-rendered. Never mistake an empty fetch for
// evidence that rail traffic has no disruptions.
export const RAIL_UPDATES_URL = 'https://rail.co.il/?lan=he&page=updates';
function stripHtml(markup){
  return String(markup).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{
      const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);
      return code>0&&code<=0x10ffff?String.fromCodePoint(code):' ';
    })
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi,x=>({
      '&nbsp;':' ','&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'
    })[x.toLowerCase()]||' ')
    .replace(/\s+/g,' ').trim();
}
export function parseOfficialRailUpdates(html) {
  if(typeof html!=='string')return [];
  const main=/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1];
  if(!main)return []; // Fail closed: navigation / placeholder-only HTML is not a notice list.
  const sections=[...main.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const notices=[];
  for(let i=0;i<sections.length&&notices.length<15;i++){
    const title=stripHtml(sections[i][2]).slice(0,180);
    if(!/(רכבת|רכבות|תנועת|שינויים|עבודות|תחנות|היסעים|rail|train|service|station|shuttle)/i.test(title))continue;
    const begin=sections[i].index+sections[i][0].length;
    const end=sections[i+1]?.index??main.length;
    const snippet=stripHtml(main.slice(begin,Math.min(end,begin+4500))).slice(0,750);
    if(snippet.length<35)continue;
    notices.push({title,description:snippet});
  }
  return notices;
}
export async function getRailServiceUpdates(fetchFn=globalThis.fetch,nowFn=()=>new Date()) {
  const {controller,cleanup}=abortAfter(12000);
  const retrievedAt=nowFn().toISOString();
  try {
    const response=await fetchFn(RAIL_UPDATES_URL,{
      method:'GET',headers:{Accept:'text/html'},signal:controller.signal,redirect:'error'
    });
    if(!response.ok) return toolError('OFFICIAL_RAIL_NOTICES_UNAVAILABLE',{
      source:RAIL_UPDATES_URL,http_status:response.status,retrieved_at:retrievedAt,
      message:'Official updates webpage could not be read. No claim about current rail disruptions can be made.'});
    const body=await readLimitedText(response,1100000);
    const notices=parseOfficialRailUpdates(body);
    if(notices.length===0) return toolError('OFFICIAL_RAIL_NOTICES_UNAVAILABLE',{
      source:RAIL_UPDATES_URL,retrieved_at:retrievedAt,
      reason:'Official page may require JavaScript, or HTML contained no extractable verified notices.',
      important:'Do not interpret this as zero service disruptions.'});
    return toolSuccess({source:'Israel Railways official website',source_url:RAIL_UPDATES_URL,
      retrieved_at:retrievedAt,data_kind:'OFFICIAL_SITE_NOTICES_NOT_REALTIME_SERVICE_STATUS',
      caveat:'Verify each notice effective date before treating it as currently active. Not an API status guarantee.',
      notice_count:notices.length,notices});
  }catch(e){return toolError('OFFICIAL_RAIL_NOTICES_UNAVAILABLE',{
    source:RAIL_UPDATES_URL,retrieved_at:retrievedAt,detail:String(e?.message||e).slice(0,180),
    important:'Unable to verify rail service updates; do not invent an all-clear.'
  });}finally{cleanup();}
}

export async function processRequest(input, deps={}) {
  const req=input;
  const id=req?.id;
  const hasId=req && Object.prototype.hasOwnProperty.call(req,'id');
  if (!req || typeof req!=='object' || Array.isArray(req) || req.jsonrpc!=='2.0' || typeof req.method!=='string') {
    return {jsonrpc:'2.0',id:hasId?id:null,error:{code:-32600,message:'Invalid Request'}};
  }
  // MCP notifications have no request id and MUST receive no response.
  if (!hasId) return null;
  const success=(result)=>({jsonrpc:'2.0',id,result});
  const failure=(code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
  if (req.method==='initialize') {
    return success({protocolVersion:req.params?.protocolVersion || '2025-06-18', capabilities:{tools:{listChanged:false}}, serverInfo:{name:SERVER_NAME,version:VERSION}});
  }
  if (req.method==='ping') return success({});
  if (req.method==='tools/list') return success({tools:toolList});
  if (req.method==='tools/call') {
    const name=req.params?.name;
    const args=req.params?.arguments??{};
    const fetchFn=deps.fetchFn??globalThis.fetch;
    const nowFn=deps.nowFn??(()=>new Date());
    if (name==='get_curlbus_arrivals') return success(await getCurlbusArrivals(args,fetchFn,nowFn));
    if (name==='get_official_gtfs_metadata') return success(await getOfficialGtfsMetadata(fetchFn,nowFn));
    if (name==='get_rail_service_updates') return success(await getRailServiceUpdates(fetchFn,nowFn));
    if (name==='get_transit_source_links') return success(toolSuccess({sources:SOURCES,checked_at:nowFn().toISOString(),network_requested:false}));
    return failure(-32602, 'Unknown tool name');
  }
  return failure(-32601,'Method not found');
}

async function runStdio() {
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});
  input.on('line',async line=>{
    let response;
    try {
      response=await processRequest(JSON.parse(line));
    } catch(err) {
      response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};
      console.error('[israel-transit] parse/error:', String(err?.message||err).slice(0,160));
    }
    if (response!==null) process.stdout.write(JSON.stringify(response)+'\n');
  });
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) runStdio();