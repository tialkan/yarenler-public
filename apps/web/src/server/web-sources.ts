/**
 * Web sources for announcement drafts (OpenRouter web search, Exa engine).
 *
 * Trust rules:
 *   1. Only URLs that OpenRouter returned as search results (message.annotations, type url_citation)
 *      can become sources. URLs the model wrote itself are dropped unless they are one of those results.
 *   2. Every source is checked by the server: https only, public addresses only (no private, loopback,
 *      link-local, metadata or reserved ranges, also after DNS), at most 2 redirects (each hop checked),
 *      final status 200-399, 3 seconds per source. Dead or unsafe links are dropped.
 *   3. The verified official program dictionary (program-links.ts) keeps priority and is listed first.
 * Pure helpers are exported for tests; network access is injected (lookup, request).
 */
import {BlockList,isIP} from 'node:net';

export type WebSource={url:string;title:string;domain:string};
export const MAX_SOURCES=5;

/** Search results returned by OpenRouter: choices[0].message.annotations[].url_citation. */
export function extractCitations(result:unknown):{url:string;title:string}[]{
 const message=(result as {choices?:{message?:{annotations?:unknown}}[]})?.choices?.[0]?.message;
 const list=Array.isArray(message?.annotations)?message!.annotations as unknown[]:[];
 const out:{url:string;title:string}[]=[];
 for(const item of list){
  const a=item as {type?:string;url_citation?:{url?:unknown;title?:unknown};url?:unknown;title?:unknown};
  if(a?.type!=='url_citation')continue;
  const c=a.url_citation||a;const url=typeof c.url==='string'?c.url:'';if(!url)continue;
  out.push({url,title:typeof c.title==='string'?c.title:''});
 }
 return out;
}

const TRACKING=/^(utm_[a-z]+|gclid|fbclid|mc_[a-z]+|ref|srsltid)$/i;
/** Canonical https URL without fragment, credentials or tracking parameters; null when not acceptable. */
export function normalizeUrl(raw:string):string|null{
 let u:URL;try{u=new URL(raw.trim());}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||!u.hostname||raw.length>2000)return null;
 if(u.port&&u.port!=='443')return null;
 u.hash='';for(const key of [...u.searchParams.keys()])if(TRACKING.test(key))u.searchParams.delete(key);
 u.hostname=u.hostname.toLowerCase().replace(/\.$/,'');
 return u.toString();
}
export const domainOf=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};

/**
 * Sources from the search results. When the model names the results it relied on (JSON "kaynaklar"),
 * those come first, but only if they are real results; the remaining results fill up to MAX_SOURCES.
 * A model URL that is not a search result is never accepted.
 */
export function pickSources(citations:{url:string;title:string}[],modelUrls:unknown,exclude:Iterable<string>=[]):{url:string;title:string}[]{
 const results=new Map<string,{url:string;title:string}>();
 for(const c of citations){const url=normalizeUrl(c.url);if(url&&isAnnouncementSource(url)&&!results.has(url))results.set(url,{url,title:clean(c.title)});}
 const skip=new Set([...exclude].map(u=>normalizeUrl(u)).filter((u):u is string=>Boolean(u)));
 const preferred=(Array.isArray(modelUrls)?modelUrls:[]).map(m=>normalizeUrl(typeof m==='string'?m:typeof (m as {url?:unknown})?.url==='string'?(m as {url:string}).url:'')).filter((u):u is string=>Boolean(u&&results.has(u)));
 const ordered=[...new Set([...preferred,...results.keys()])].filter(u=>!skip.has(u));
 return ordered.slice(0,MAX_SOURCES).map(u=>results.get(u)!);
}
const clean=(s:string)=>s.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,200);

const URL_IN_TEXT=/https?:\/\/[^\s<>()"'\]\[]+/gi;
/**
 * Announcement text without links the model wrote: markdown links keep only their label, bare URLs stay
 * only when they are an accepted source. Sources are shown in their own list.
 */
export function stripUnlistedLinks(text:string,allowed:Iterable<string>){
 const ok=new Set([...allowed].map(u=>normalizeUrl(u)).filter(Boolean));
 return text
  .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+)\)/gi,'$1')
  .replace(URL_IN_TEXT,match=>{const trimmed=match.replace(/[.,;:!?]+$/,'');const tail=match.slice(trimmed.length);const n=normalizeUrl(trimmed);return n&&ok.has(n)?trimmed+tail:tail;})
  .replace(/[ \t]{2,}/g,' ').replace(/ +([.,;:!?])/g,'$1').trim();
}

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------
const BLOCKED=new BlockList();
for(const [net,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as [string,number][])BLOCKED.addSubnet(net,bits,'ipv4');
for(const [net,bits] of [['::',128],['::1',128],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',23],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['fec0::',10],['ff00::',8]] as [string,number][])BLOCKED.addSubnet(net,bits,'ipv6');
/**
 * Private, loopback, link-local (cloud metadata 169.254.169.254), CGNAT, documentation, multicast and reserved
 * addresses. IPv4-mapped IPv6 (::ffff:a.b.c.d, also in hex form) is checked as the embedded IPv4 address.
 */
export function isBlockedAddress(ip:string){
 const type=isIP(ip);if(!type)return true;
 if(type===6){
  const dotted=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);if(dotted)return isBlockedAddress(dotted[1]);
  const hex=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if(hex){const hi=parseInt(hex[1],16),lo=parseInt(hex[2],16);return isBlockedAddress(`${hi>>8}.${hi&255}.${lo>>8}.${lo&255}`);}
 }
 return BLOCKED.check(ip,type===6?'ipv6':'ipv4');
}
const BLOCKED_HOST=/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|arpa)$/i;
/** Host names that must never be fetched, before any DNS lookup. */
export function isBlockedHost(host:string){
 const h=host.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
 if(!h)return true;
 if(isIP(h))return isBlockedAddress(h);
 return !h.includes('.')||BLOCKED_HOST.test(h)||h==='metadata.google.internal';
}

export type Lookup=(host:string)=>Promise<{address:string;family:number}[]>;
/** One HTTP exchange to a pinned address; resolves with status and Location, never follows redirects. */
export type HttpProbe=(url:URL,address:{address:string;family:number},method:'HEAD'|'GET',signal:AbortSignal)=>Promise<{status:number;location:string|null}>;
export type VerifyDeps={lookup:Lookup;probe:HttpProbe;timeoutMs?:number;maxRedirects?:number};

/** Reasons are for logs and tests; nothing is shown to users except the verified list. */
export async function verifyUrl(raw:string,deps:VerifyDeps):Promise<{ok:true;url:string}|{ok:false;reason:string}>{
 const timeout=deps.timeoutMs??3000,maxRedirects=deps.maxRedirects??2;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  let current=normalizeUrl(raw);if(!current)return {ok:false,reason:'https_degil'};
  for(let hop=0;;hop++){
   const url=new URL(current);
   if(isBlockedHost(url.hostname))return {ok:false,reason:'ozel_adres'};
   const addresses=await Promise.race([deps.lookup(url.hostname),aborted(controller.signal)]);
   if(!addresses.length||addresses.some(a=>isBlockedAddress(a.address)))return {ok:false,reason:'ozel_adres'};
   let answer=await deps.probe(url,addresses[0],'HEAD',controller.signal);
   // Some servers refuse HEAD; a GET whose body is not read is the same check.
   if([403,405,501].includes(answer.status))answer=await deps.probe(url,addresses[0],'GET',controller.signal);
   if(answer.status>=300&&answer.status<400&&answer.location){
    if(hop>=maxRedirects)return {ok:false,reason:'cok_yonlendirme'};
    const next=normalizeUrl(new URL(answer.location,url).toString());if(!next)return {ok:false,reason:'https_degil'};
    current=next;continue;
   }
   if(answer.status>=200&&answer.status<400)return {ok:true,url:current};
   return {ok:false,reason:'durum_'+answer.status};
  }
 }catch{return {ok:false,reason:controller.signal.aborted?'zaman_asimi':'baglanti'};}
 finally{clearTimeout(timer);}
}
function aborted(signal:AbortSignal):Promise<never>{return new Promise((_,reject)=>{if(signal.aborted)reject(new Error('aborted'));signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});}

/** Verifies in parallel, keeps the input order, at most MAX_SOURCES. The final (redirected) address is kept. */
export async function verifySources(items:{url:string;title:string}[],deps:VerifyDeps):Promise<WebSource[]>{
 const checked=await Promise.all(items.slice(0,MAX_SOURCES).map(async item=>({item,result:await verifyUrl(item.url,deps)})));
 const seen=new Set<string>(),out:WebSource[]=[];
 for(const {item,result} of checked){if(!result.ok||seen.has(result.url))continue;seen.add(result.url);out.push({url:result.url,title:item.title||domainOf(result.url),domain:domainOf(result.url)});}
 return out;
}

/**
 * Stored announcement sources (announcement.kaynaklar): only well formed https entries survive,
 * whatever the stored JSON contains.
 */
export function storedSources(value:unknown):WebSource[]{
 if(!Array.isArray(value))return [];
 const out:WebSource[]=[];
 for(const v of value.slice(0,10)){const s=v as {url?:unknown;baslik?:unknown;alan_adi?:unknown};const url=typeof s?.url==='string'?normalizeUrl(s.url):null;if(!url||!isAnnouncementSource(url))continue;out.push({url,title:typeof s.baslik==='string'&&s.baslik.trim()?clean(s.baslik):domainOf(url),domain:domainOf(url)});}
 return out;
}

/** Sources explain funding programmes; people and staff directories belong only in collaborator suggestions. */
export function isAnnouncementSource(raw:string){
 try{const u=new URL(raw),h=u.hostname.replace(/^www\./,'');return u.protocol==='https:'&&['tubitak.gov.tr','ufuk2020.org.tr','ufukavrupa.org.tr','ec.europa.eu','research-and-innovation.ec.europa.eu','erasmus-plus.ec.europa.eu','tcmb.gov.tr','ukri.org','nsf.gov','grants.nih.gov','daad.de'].includes(h)&&!/(?:^|\/)(?:people|person|staff|profile|profiles|researchers?|projects-by-person)(?:\/|$)/i.test(u.pathname);}catch{return false;}
}
