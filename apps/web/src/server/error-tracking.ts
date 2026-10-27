import {describeError,redact} from './redact';
/**
 * Minimal Sentry protocol client for a self-hosted GlitchTip (or any Sentry compatible) DSN.
 * Pure and dependency free so it runs on the server, in the browser and in tests.
 * Never sends personal data: no headers, cookies, query strings, user or IP fields; messages are redacted.
 */
export type Dsn={publicKey:string;origin:string;projectId:string;endpoint:string;publicDsn:string};
export function parseDsn(value:string|null|undefined):Dsn|null{
 if(!value)return null;let url:URL;try{url=new URL(value.trim());}catch{return null;}
 const local=url.hostname==='localhost'||url.hostname==='127.0.0.1';
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))return null;
 const parts=url.pathname.split('/').filter(Boolean),projectId=parts.pop();
 if(!url.username||!projectId||!/^\d+$/.test(projectId))return null;
 const prefix=parts.length?'/'+parts.join('/'):'';
 return {publicKey:decodeURIComponent(url.username),origin:url.origin,projectId,endpoint:`${url.origin}${prefix}/api/${projectId}/envelope/`,publicDsn:`${url.protocol}//${url.username}@${url.host}${prefix}/${projectId}`};
}
/** CSP connect-src source for browser reporting; null when no valid DSN is configured. */
export const dsnOrigin=(value:string|null|undefined)=>parseDsn(value)?.origin??null;

export type ErrorContext={kind:'request'|'action'|'route'|'client';path?:string|null;method?:string|null;route?:string|null;routeType?:string|null;action?:string|null};
type Frame={filename:string;function:string;lineno:number;colno:number;in_app:boolean};
function frames(stack:string|null):Frame[]{if(!stack)return [];const out:Frame[]=[];for(const line of stack.split('\n')){const m=/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line)||/^\s*(.*?)@(.+?):(\d+):(\d+)$/.exec(line);if(m)out.push({function:m[1]||'?',filename:m[2],lineno:Number(m[3]),colno:Number(m[4]),in_app:!m[2].includes('node_modules')});}return out.reverse();}
/** Path only: no origin, no query string, no fragment. */
export function safePath(value:string|null|undefined){if(!value)return null;try{return new URL(value,'http://x').pathname.slice(0,300);}catch{return null;}}
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
export function eventId(){const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);return hex(bytes);}

export function buildEvent(error:unknown,context:ErrorContext,meta:{environment?:string;release?:string;platform?:'node'|'javascript';now?:number}={}){
 const d=describeError(error),path=safePath(context.path);
 const tags:Record<string,string>={kind:context.kind};
 for(const [key,value] of [['route',context.route],['route_type',context.routeType],['action',context.action],['code',d.code],['digest',d.digest]] as const)if(value)tags[key]=redact(String(value),200);
 return {event_id:eventId(),timestamp:(meta.now??Date.now())/1000,platform:meta.platform||'node',level:'error',logger:'yarenler',
  environment:meta.environment||'production',...(meta.release?{release:meta.release}:{}),transaction:context.route||path||undefined,tags,
  exception:{values:[{type:d.name,value:d.message,stacktrace:{frames:frames(d.stack)}}]},
  ...(path||context.method?{request:{...(path?{url:path}:{}),...(context.method?{method:context.method}:{})}}:{})};
}
export function envelope(event:ReturnType<typeof buildEvent>,dsn:Dsn){return [JSON.stringify({event_id:event.event_id,sent_at:new Date().toISOString(),dsn:dsn.publicDsn}),JSON.stringify({type:'event'}),JSON.stringify(event)].join('\n')+'\n';}

type Fetch=(url:string,init:{method:string;headers:Record<string,string>;body:string;signal?:AbortSignal;keepalive?:boolean;credentials?:'omit'})=>Promise<unknown>;
/**
 * Returns report(error, context). Without a valid DSN it does nothing. At most `perMinute`
 * events per minute and one per identical error within `dedupeMs`; network failures are ignored.
 */
export function createReporter({dsn,fetch,environment,release,platform='node',perMinute=20,dedupeMs=300000,now=()=>Date.now(),timeoutMs=3000}:{dsn:string|null|undefined;fetch?:Fetch;environment?:string;release?:string;platform?:'node'|'javascript';perMinute?:number;dedupeMs?:number;now?:()=>number;timeoutMs?:number}){
 const target=parseDsn(dsn);const sent:number[]=[];const recent=new Map<string,number>();
 return async function report(error:unknown,context:ErrorContext):Promise<boolean>{
  if(!target||!fetch)return false;
  const t=now(),d=describeError(error),key=`${context.kind}|${context.route||''}|${d.name}|${d.message}`;
  if((recent.get(key)??-Infinity)>t-dedupeMs)return false;
  while(sent.length&&sent[0]<=t-60000)sent.shift();if(sent.length>=perMinute)return false;
  sent.push(t);recent.set(key,t);if(recent.size>500)recent.delete(recent.keys().next().value!);
  const event=buildEvent(error,context,{environment,release,platform,now:t});
  // Browsers use query string auth and text/plain like the Sentry SDK, so no CORS preflight is needed.
  const browser=platform==='javascript',auth=`sentry_version=7&sentry_client=yarenler%2F0.4&sentry_key=${encodeURIComponent(target.publicKey)}`;
  try{await fetch(browser?`${target.endpoint}?${auth}`:target.endpoint,{method:'POST',headers:browser?{'Content-Type':'text/plain;charset=UTF-8'}:{'Content-Type':'application/x-sentry-envelope','X-Sentry-Auth':`Sentry sentry_version=7, sentry_client=yarenler/0.4, sentry_key=${target.publicKey}`},body:envelope(event,target),signal:typeof AbortSignal!=='undefined'&&'timeout' in AbortSignal?AbortSignal.timeout(timeoutMs):undefined,keepalive:platform==='javascript',credentials:'omit'});return true;}
  catch{return false;}
 };
}
