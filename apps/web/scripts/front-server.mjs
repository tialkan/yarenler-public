/**
 * Production entry: a small HTTP front in the same process as the Next.js standalone server.
 *
 *   client → :PORT (this file) → 127.0.0.1:INTERNAL_PORT (Next.js server.js, host name "localhost")
 *
 * For every HTML response it computes the hash based Content-Security-Policy from the inline scripts
 * actually present (see csp-lib.mjs), then gzips the document. Everything else is passed through
 * unchanged (JSON, RSC payloads, images, redirects, server actions), text assets are gzipped.
 * Request headers (Host, X-Forwarded-*, cookies) are forwarded as they are.
 */
import http from 'node:http';
import dns from 'node:dns';
import zlib from 'node:zlib';
import {promisify} from 'node:util';
import {cspForHtml,dsnOrigin} from './csp-lib.mjs';
const gzip=promisify(zlib.gzip),gunzip=promisify(zlib.gunzip),brotli=promisify(zlib.brotliDecompress),inflate=promisify(zlib.inflate);
const publicPort=Number(process.env.PORT||3000),publicHost=process.env.HOSTNAME||'0.0.0.0',internalPort=Number(process.env.INTERNAL_PORT||3001);
const reportOrigin=dsnOrigin(process.env.SENTRY_DSN);
const HOP=new Set(['connection','keep-alive','proxy-connection','transfer-encoding','upgrade','te','trailer','proxy-authenticate','proxy-authorization']);
const COMPRESSIBLE=/^(text\/(css|plain|javascript|xml)|application\/(javascript|json|xml|rss\+xml|manifest\+json)|image\/svg\+xml)/;
const MAX_HTML=8*1024*1024;
/**
 * Host name given to the internal Next.js server. It must be "localhost", not "127.0.0.1": Next.js builds the
 * proxy's request URL with the host normalised to "localhost" but compares rewrite targets with
 * http(s)://<HOSTNAME>:<port>. With "127.0.0.1" every proxy rewrite (search, ?page=) looked external and was
 * proxied over the network; behind HTTPS (X-Forwarded-Proto: https) that proxy failed with 500.
 * "localhost" is resolved IPv4 first (see start), so Next.js still binds 127.0.0.1 only, even without IPv6.
 */
const INTERNAL_HOST='localhost';
const agent=new http.Agent({keepAlive:true,maxSockets:128});
function log(level,event,extra={}){(level==='error'?console.error:console.log)(JSON.stringify({level,time:new Date().toISOString(),event,...extra}));}
function addVary(headers,value){const current=String(headers.vary||'');if(!current.split(',').map(s=>s.trim().toLowerCase()).includes(value.toLowerCase()))headers.vary=current?`${current}, ${value}`:value;}
async function decode(body,encoding){switch((encoding||'').toLowerCase()){case '':case 'identity':return body;case 'gzip':return gunzip(body);case 'br':return brotli(body);case 'deflate':return inflate(body);default:throw new Error('unknown encoding '+encoding);}}
/**
 * Cache-Control for the CDN. Next.js sends "s-maxage=N, stale-while-revalidate=M" for ISR pages; this
 * makes it explicit ("public", browsers revalidate with max-age=0) and bounds the stale window to a day.
 * Not-found and gone pages are kept for at most 5 minutes. /api/* is never stored unless it says so.
 */
export function cacheControl(value,status,pathname){
 // The panel (/yonetici) is never stored by the CDN or the browser, whatever the status (404 included).
 if(isPrivate(pathname)||status>=500)return 'no-store';
 if(pathname.startsWith('/api/'))return value||'private, no-store';
 const m=/^s-maxage=(\d+)(?:, stale-while-revalidate=(\d+))?$/.exec(String(value||''));if(!m)return value;
 const shared=status===404||status===410?Math.min(Number(m[1]),300):Number(m[1]),stale=Math.min(Number(m[2]||0),86400);
 return `public, max-age=0, s-maxage=${shared}${stale?`, stale-while-revalidate=${stale}`:''}`;
}
export const isPrivate=pathname=>isPanel(pathname)||/^\/(tr\/itiraz|en\/appeal|tr\/kurumsal-katilim|en\/institutional-participation|tr\/giris|en\/sign-in|tr\/profilim|en\/my-profile|tr\/arama|en\/search)\/?$/.test(pathname);
export const isPanel=pathname=>pathname==='/yonetici'||pathname.startsWith('/yonetici/');
export function responseHeaders(upstream,pathname){const out={};for(const [name,value] of Object.entries(upstream.headers)){if(value!==undefined&&!HOP.has(name))out[name]=value;}const confidential=Boolean(out['set-cookie'])||String(out['content-type']||'').startsWith('text/x-component');const cc=confidential?'private, no-store':cacheControl(out['cache-control'],upstream.statusCode||0,pathname);if(cc)out['cache-control']=cc;if(isPrivate(pathname)||confidential){out['x-robots-tag']='noindex, nofollow';delete out['cdn-cache-control'];delete out['cloudflare-cdn-cache-control'];}return out;}
export const isCompletedAction=req=>req.method==='POST'&&Boolean(req.headers['next-action'])&&req.complete===true;
export function handler(req,res){
 const headers={};for(const [name,value] of Object.entries(req.headers)){if(!HOP.has(name))headers[name]=value;}
 if(!headers['x-forwarded-for']&&req.socket.remoteAddress)headers['x-forwarded-for']=req.socket.remoteAddress;
 const acceptsGzip=/\bgzip\b/.test(String(req.headers['accept-encoding']||'')),pathname=String(req.url||'/').split('?')[0];
 const upstream=http.request({host:'127.0.0.1',port:internalPort,method:req.method,path:req.url,headers,agent},async up=>{
  if(res.destroyed){up.resume();return;}
  const out=responseHeaders(up,pathname),type=String(up.headers['content-type']||''),status=up.statusCode||502;
  const html=type.startsWith('text/html')&&req.method!=='HEAD'&&status!==204&&status!==304;
  if(html){
   const chunks=[];let size=0;
   up.on('data',c=>{size+=c.length;if(size<=MAX_HTML)chunks.push(c);});
   up.on('end',async()=>{try{
    if(size>MAX_HTML)throw new Error('html too large');
    let body=await decode(Buffer.concat(chunks),up.headers['content-encoding']);
    out['content-security-policy']=cspForHtml(body.toString('utf8'),{reportOrigin});
    delete out['content-encoding'];delete out['content-length'];addVary(out,'Accept-Encoding');
    if(acceptsGzip&&body.length>1024){body=await gzip(body,{level:6});out['content-encoding']='gzip';}
    out['content-length']=String(body.length);res.writeHead(status,out);res.end(body);
   }catch(error){log('error','front_html_failed',{message:String(error?.message||error)});if(!res.headersSent){res.writeHead(502,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});}res.end('Bad gateway');}});
   up.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end();});
   return;
  }
  const compress=acceptsGzip&&req.method!=='HEAD'&&!up.headers['content-encoding']&&COMPRESSIBLE.test(type)&&status===200&&Number(up.headers['content-length']||2048)>1024;
  if(compress){delete out['content-length'];out['content-encoding']='gzip';addVary(out,'Accept-Encoding');res.writeHead(status,out);up.pipe(zlib.createGzip({level:6})).pipe(res);return;}
  res.writeHead(status,out);up.pipe(res);
 });
 upstream.on('error',error=>{const starting=error?.code==='ECONNREFUSED';if(!res.headersSent)res.writeHead(starting?503:502,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',...(starting?{'retry-after':'5'}:{})});res.end(starting?'Starting':'Bad gateway');});
 // Completed server-action bodies keep running after a client disconnect: model results and quota accounting must finish.
 res.on('close',()=>{if(!res.writableFinished&&!isCompletedAction(req))upstream.destroy();});
 req.pipe(upstream);
}
export async function start(){
 // The standalone server reads PORT and HOSTNAME when it is loaded; it must listen only on loopback.
 dns.setDefaultResultOrder('ipv4first');
 process.env.PORT=String(internalPort);process.env.HOSTNAME=INTERNAL_HOST;
 await import(new URL('../server.js',import.meta.url).href);
 const server=http.createServer(handler);server.keepAliveTimeout=65000;server.headersTimeout=66000;
 server.listen(publicPort,publicHost,()=>log('info','front_listening',{port:publicPort,internal:internalPort}));
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close());
}
if(import.meta.url===`file://${process.argv[1]}`)await start();
