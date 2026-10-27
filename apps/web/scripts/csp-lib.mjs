/**
 * Hash based Content Security Policy for cacheable HTML.
 *
 * Why not nonces: a nonce must be unique per response. Once the HTML is cached by the CDN every
 * visitor would receive the same nonce, and anyone reading the page would know it. So the cached
 * pages carry no nonce; instead the front server hashes the inline scripts of each HTML response and
 * lists exactly those hashes in script-src. External scripts are allowed from 'self' only.
 *
 * Only the framework's own inline script shapes are hashed:
 *   (self.__next_f=self.__next_f||[]).push([0])                 bootstrap
 *   self.__next_f.push(<JSON literal>)                          React Server Components payload
 *   (globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({otherChunks,runtimeModuleIds});
 *                                                               Turbopack chunk list (same-origin chunks only)
 *   plus a short list of constant Next.js helper scripts.
 * The payload test is JSON.parse: a pure JSON literal inside push(...) cannot run code. Any other inline
 * script (for example markup injected through a future bug) gets no hash and the browser blocks it,
 * which is the same guarantee a nonce gives. JSON-LD blocks are data, not executed, and need no hash.
 */
import {createHash} from 'node:crypto';
const BOOT='(self.__next_f=self.__next_f||[]).push([0])';
const PUSH='self.__next_f.push(';
const TURBOPACK='(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(';
const CHUNK=/^static\/chunks\/[A-Za-z0-9_.-]+\.js$/;
/** Constant inline helpers emitted by Next.js (none are user controlled). */
export const KNOWN_SCRIPTS=new Set([
 'document.querySelectorAll(\'body link[rel="icon"], body link[rel="apple-touch-icon"]\').forEach(el => document.head.appendChild(el))',
]);
/** Turbopack runtime bootstrap: a JSON object listing same-origin chunk files and numeric module ids. */
function isTurbopackPayload(inner){try{const value=JSON.parse(inner);if(!value||typeof value!=='object'||Array.isArray(value))return false;const keys=Object.keys(value);return keys.every(k=>k==='otherChunks'||k==='runtimeModuleIds')&&(value.otherChunks??[]).every(c=>typeof c==='string'&&CHUNK.test(c))&&(value.runtimeModuleIds??[]).every(n=>Number.isInteger(n));}catch{return false;}}
function isPushPayload(inner){try{const value=JSON.parse(inner);return Array.isArray(value)&&value.length>=1&&value.length<=2&&typeof value[0]==='number';}catch{return false;}}
export function isFrameworkScript(code){
 if(code===BOOT)return true;
 if(code.startsWith(BOOT+';'+PUSH)&&code.endsWith(')'))return isPushPayload(code.slice(BOOT.length+1+PUSH.length,-1));
 if(code.startsWith(PUSH)&&code.endsWith(')'))return isPushPayload(code.slice(PUSH.length,-1));
 if(code.startsWith(TURBOPACK)&&code.endsWith(');'))return isTurbopackPayload(code.slice(TURBOPACK.length,-2));
 return KNOWN_SCRIPTS.has(code);
}
const JS_TYPES=new Set(['','text/javascript','application/javascript','module','text/ecmascript','application/ecmascript']);
/** Inline, executable script bodies of an HTML document (external and data block scripts are skipped). */
export function inlineScripts(html){
 const out=[];const re=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;let m;
 while((m=re.exec(html))){const attrs=m[1]||'';if(/\ssrc\s*=/i.test(' '+attrs))continue;const type=/\stype\s*=\s*["']?([^"'\s>]+)/i.exec(' '+attrs);if(type&&!JS_TYPES.has(type[1].toLowerCase()))continue;out.push(m[2]);}
 return out;
}
export function sha256(code){return 'sha256-'+createHash('sha256').update(code,'utf8').digest('base64');}
/** Hashes of the allowed inline scripts and the number of rejected ones. */
export function scriptHashes(html){const hashes=new Set();let rejected=0;for(const code of inlineScripts(html)){if(isFrameworkScript(code))hashes.add(sha256(code));else rejected++;}return {hashes:[...hashes],rejected};}
/** Origin of a GlitchTip/Sentry DSN for connect-src, or null; same rules as src/server/error-tracking.ts parseDsn. */
export function dsnOrigin(dsn){if(!dsn)return null;let url;try{url=new URL(String(dsn).trim());}catch{return null;}const local=url.hostname==='localhost'||url.hostname==='127.0.0.1';if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))return null;const projectId=url.pathname.split('/').filter(Boolean).pop();return url.username&&projectId&&/^\d+$/.test(projectId)?url.origin:null;}
/** The policy. Without hashes it is the strict fallback (no inline script runs). */
export function buildCsp({hashes=[],reportOrigin=null,dev=false}={}){
 const script=["'self'",...hashes.map(h=>`'${h}'`),...(dev?["'unsafe-inline'","'unsafe-eval'"]:[])].join(' ');
 return `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${reportOrigin?' '+reportOrigin:''}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
}
export function cspForHtml(html,{reportOrigin=null}={}){return buildCsp({hashes:scriptHashes(html).hashes,reportOrigin});}
