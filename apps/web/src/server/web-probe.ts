import 'server-only';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import type {LookupFunction} from 'node:net';
import type {HttpProbe,Lookup,VerifyDeps} from './web-sources';

/**
 * Network side of source verification. The connection goes to the address that was checked
 * (pinned lookup), so a second DNS answer cannot point the request at an internal address.
 * Only the status line and Location header are read; the body is discarded.
 */
const resolveAll:Lookup=async host=>(await lookup(host,{all:true,verbatim:true})).map(a=>({address:a.address,family:a.family}));
const probe:HttpProbe=(url,address,method,signal)=>new Promise((resolve,reject)=>{
 const pinned=((_host:string,options:{all?:boolean},callback:(...args:unknown[])=>void)=>{if(options?.all)callback(null,[{address:address.address,family:address.family}]);else callback(null,address.address,address.family);}) as unknown as LookupFunction;
 const request=https.request({protocol:'https:',hostname:url.hostname,servername:url.hostname,port:443,path:url.pathname+url.search,method,agent:false,lookup:pinned,signal,
  headers:{'User-Agent':'YarenlerBot/1.0 (+https://yarenler.org/tr/hakkinda)','Accept':'text/html,application/xhtml+xml,*/*;q=0.8'}},response=>{
  resolve({status:response.statusCode||0,location:typeof response.headers.location==='string'?response.headers.location:null});
  response.destroy();
 });
 request.on('error',reject);request.end();
});
export const sourceVerifier:VerifyDeps={lookup:resolveAll,probe,timeoutMs:3000,maxRedirects:2};
