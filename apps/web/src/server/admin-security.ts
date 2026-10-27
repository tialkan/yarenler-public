/**
 * Pure rules of the panel (/yonetici), shared by the proxy, the server code and the tests.
 * Nothing here reads the request or the database.
 */
import {BlockList,isIP} from 'node:net';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {parseHash,verifyPassword} from '../../scripts/admin-hash-lib.mjs';
import {headingCase} from './text-case';

export const ADMIN_PATH='/yonetici';
/** __Host- prefix: Secure, Path=/ and no Domain are enforced by the browser; separate from the ORCID session cookie. */
export const ADMIN_COOKIE='__Host-yarenler-yonetici';
/** Session: 8 hours absolute, 30 minutes idle. */
export const SESSION_ABSOLUTE_MS=8*60*60*1000;
export const SESSION_IDLE_MS=30*60*1000;
/**
 * Brute force: 5 failures lock the IP and the user name for 15 minutes; each further lock within a day lasts twice
 * as long (15, 30, 60 minutes ... at most 24 hours). Failures older than 1 hour and locks older than a day are forgotten.
 */
export const LOCK_AFTER=5;
export const LOCK_MS=15*60*1000;
export const LOCK_MAX_MS=24*60*60*1000;
export const FORGET_MS=60*60*1000;
export const FORGET_LOCKS_MS=24*60*60*1000;
/** Plain YONETICI_SIFRE shorter than this keeps the panel closed. */
export const MIN_PLAIN_PASSWORD=16;

export function isAdminPath(pathname:string){return pathname===ADMIN_PATH||pathname.startsWith(ADMIN_PATH+'/');}

export type AdminSecret={kind:'hash';hash:string}|{kind:'plain';password:string};
/** secretId: the digest, or a SHA-256 of the plain password; keys the stored digests and the session fingerprint. */
export type AdminConfig={username:string;secret:AdminSecret;secretId:string;databaseUrl:string;allowedIps:string|null};
export type AdminConfigResult={config:AdminConfig|null;warning:string|null};
/**
 * Runtime variables (Coolify): YONETICI_KULLANICI, YONETICI_SIFRE (plain) or YONETICI_SIFRE_HASH (scrypt digest,
 * preferred when set), ADMIN_DATABASE_URL (restricted yarenler_admin role), optional ADMIN_ALLOWED_IPS.
 * Nothing set: the panel does not exist (404, no warning). Incomplete or weak settings: closed (404) with a warning
 * for the log; the warning never contains a secret.
 */
export function readAdminConfig(env:Record<string,string|undefined>):AdminConfigResult{
 const username=env.YONETICI_KULLANICI?.trim()||'',plain=env.YONETICI_SIFRE??'',hash=env.YONETICI_SIFRE_HASH?.trim()||'',databaseUrl=env.ADMIN_DATABASE_URL?.trim()||'';
 if(!username&&!plain&&!hash&&!databaseUrl)return {config:null,warning:null};
 const closed=(warning:string)=>({config:null,warning});
 if(!username)return closed('YONETICI_KULLANICI tanımlı değil; yönetici paneli kapalı.');
 if(username.length>64)return closed('YONETICI_KULLANICI 64 karakterden uzun; yönetici paneli kapalı.');
 if(!databaseUrl)return closed('ADMIN_DATABASE_URL tanımlı değil; yönetici paneli kapalı.');
 let secret:AdminSecret,secretId:string;
 if(hash){
  if(!parseHash(hash))return closed('YONETICI_SIFRE_HASH geçerli bir scrypt özeti değil (scripts/admin-hash.mjs); yönetici paneli kapalı.');
  secret={kind:'hash',hash};secretId=hash;
 }else{
  if(!plain)return closed('YONETICI_SIFRE ya da YONETICI_SIFRE_HASH tanımlı değil; yönetici paneli kapalı.');
  if([...plain.normalize('NFC')].length<MIN_PLAIN_PASSWORD)return closed(`YONETICI_SIFRE ${MIN_PLAIN_PASSWORD} karakterden kısa; yönetici paneli kapalı.`);
  secret={kind:'plain',password:plain.normalize('NFC')};secretId='plain:'+createHash('sha256').update('yarenler-yonetici-sifre:'+secret.password).digest('hex');
 }
 return {config:{username,secret,secretId,databaseUrl,allowedIps:env.ADMIN_ALLOWED_IPS?.trim()||null},warning:null};
}
export function adminConfig(env:Record<string,string|undefined>):AdminConfig|null{return readAdminConfig(env).config;}
const warned=new Set<string>();
/** Same as adminConfig; logs each distinct configuration warning once per process. */
export function adminConfigLogged(env:Record<string,string|undefined>):AdminConfig|null{
 const {config,warning}=readAdminConfig(env);
 if(warning&&!warned.has(warning)){warned.add(warning);console.warn(JSON.stringify({level:'warn',time:new Date().toISOString(),event:'admin_panel_disabled',message:warning}));}
 return config;
}
/** Constant time check of the password: scrypt for the digest, equal length SHA-256 comparison for the plain value. */
export async function verifyAdminPassword(input:string,config:Pick<AdminConfig,'secret'>){
 const text=typeof input==='string'?input.slice(0,1024):'';
 if(config.secret.kind==='hash')return verifyPassword(text,config.secret.hash);
 const a=createHash('sha256').update(text.normalize('NFC')).digest(),b=createHash('sha256').update(config.secret.password).digest();
 return timingSafeEqual(a,b);
}

export {clientIp} from './client-ip';

/**
 * ADMIN_ALLOWED_IPS: comma separated addresses or CIDR ranges (IPv4 and IPv6), e.g. "203.0.113.7, 2001:db8::/48".
 * Empty: every address may reach the login page. A list with no valid entry closes the panel.
 */
export function ipAllowed(list:string|null|undefined,ip:string|null){
 if(!list)return true;if(!ip)return false;
 const blocks=new BlockList();let valid=0;
 for(const raw of list.split(',')){const entry=raw.trim();if(!entry)continue;const [address,prefix]=entry.split('/');const type=isIP(address);if(!type)continue;
  try{if(prefix===undefined)blocks.addAddress(address,type===6?'ipv6':'ipv4');else{const bits=Number(prefix);if(!Number.isInteger(bits)||bits<0||bits>(type===6?128:32))continue;blocks.addSubnet(address,bits,type===6?'ipv6':'ipv4');}valid++;}catch{/* invalid entry */}}
 if(!valid)return false;
 const type=isIP(ip);return type?blocks.check(ip,type===6?'ipv6':'ipv4'):false;
}

/** Keyed digest (HMAC-SHA256) so stored IP and user name digests cannot be reversed by trying all addresses. */
function keyOf(config:Pick<AdminConfig,'secretId'>){return createHash('sha256').update('yarenler-yonetici:'+config.secretId).digest();}
export function keyedDigest(config:Pick<AdminConfig,'secretId'>,value:string){return createHmac('sha256',keyOf(config)).update(value).digest('hex');}
/** Session fingerprint: changes when the user name or the password digest changes, which ends every session. */
export function sessionFingerprint(config:Pick<AdminConfig,'username'|'secretId'>){return createHash('sha256').update(config.username+'\n'+config.secretId).digest('hex');}
/** Constant time user name comparison (digests of equal length). */
export function sameUsername(input:string,expected:string){return timingSafeEqual(createHash('sha256').update(input).digest(),createHash('sha256').update(expected).digest());}

export type AttemptRow={hata_sayisi:number;son_hata:Date|null;kilit_bitis:Date|null;kilit_sayisi?:number|null};
/** Seconds to wait after the n-th consecutive failure before the next attempt is evaluated (3rd: 1 s, 4th: 2 s). */
export function waitSeconds(failures:number){return failures<3?0:Math.min(2**(failures-3),30);}
/** Length of the n-th lock in a row (n >= 1): 15 minutes, doubled each time, at most 24 hours. */
export function lockDuration(n:number){return Math.min(LOCK_MS*2**Math.max(0,n-1),LOCK_MAX_MS);}
/** May a login attempt be evaluated now? Rows are the IP and user name counters. */
export function loginGate(rows:AttemptRow[],now:number):{kind:'ok'}|{kind:'locked';until:number}|{kind:'wait';seconds:number}{
 let wait=0,locked=0;
 for(const row of rows){
  const lock=row.kilit_bitis?.getTime()||0;if(lock>now){locked=Math.max(locked,lock);continue;}
  if(lock)continue; // an expired lock starts the failure count over
  const last=row.son_hata?.getTime()||0;if(!last||now-last>FORGET_MS)continue;
  const ready=last+waitSeconds(row.hata_sayisi)*1000;if(ready>now)wait=Math.max(wait,Math.ceil((ready-now)/1000));
 }
 if(locked)return {kind:'locked',until:locked};
 if(wait)return {kind:'wait',seconds:wait};
 return {kind:'ok'};
}
/** Counter after one more failure: the 5th failure locks; earlier locks within a day make the new lock longer. */
export function afterFailure(row:AttemptRow|null,now:number):{hata_sayisi:number;son_hata:Date;kilit_bitis:Date|null;kilit_sayisi:number}{
 const lock=row?.kilit_bitis?.getTime()||0,last=row?.son_hata?.getTime()||0;
 const fresh=!row||(lock&&lock<=now)||!last||now-last>FORGET_MS;
 const previousLocks=row&&last&&now-last<=FORGET_LOCKS_MS?Math.max(0,Number(row.kilit_sayisi)||0):0;
 const count=(fresh?0:row!.hata_sayisi)+1;
 if(count>=LOCK_AFTER){const locks=previousLocks+1;return {hata_sayisi:count,son_hata:new Date(now),kilit_bitis:new Date(now+lockDuration(locks)),kilit_sayisi:locks};}
 return {hata_sayisi:count,son_hata:new Date(now),kilit_bitis:null,kilit_sayisi:previousLocks};
}
/** Same rule as the SQL check: valid until the absolute end, idle for at most 30 minutes, same fingerprint. */
export function sessionValid(row:{bitis:Date;son_kullanim:Date;parmak_izi:string},now:number,fingerprint:string){
 return row.bitis.getTime()>now&&now-row.son_kullanim.getTime()<SESSION_IDLE_MS&&row.parmak_izi===fingerprint;
}

/**
 * Field name typed in the panel, before the database check (yarenler_yonetici_ad applies the same heading case):
 * NFC, single spaces, no control characters, first letter capital (Turkish rules for Turkish names, "i" > "İ"),
 * connectors in lower case (0010). Empty input gives ''.
 */
export function adminAreaName(value:string,lang:'tr'|'en'){
 const v=String(value||'').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();if(!v)return '';
 const [first,...rest]=[...v];
 return headingCase(first.toLocaleUpperCase(lang==='tr'?'tr':'en')+rest.join(''));
}
