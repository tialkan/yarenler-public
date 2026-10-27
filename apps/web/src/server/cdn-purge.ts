import 'server-only';
/**
 * Optional Cloudflare purge by URL, so an announcement change shows at once instead of after the CDN's
 * s-maxage (5 minutes). No-op unless CF_ZONE_ID and CF_API_TOKEN (scope: Zone > Cache Purge, this zone
 * only) are set as runtime variables. The token is never logged.
 */
export async function purgeCdn(paths:string[]){
 const zone=process.env.CF_ZONE_ID,token=process.env.CF_API_TOKEN,base=process.env.PUBLIC_BASE_URL;
 if(!zone||!/^[a-f0-9]{32}$/.test(zone)||!token||!base?.startsWith('https://'))return false;
 const files=[...new Set(paths.filter(p=>p.startsWith('/')&&!p.startsWith('//')).map(p=>base+p))].slice(0,30);
 if(!files.length)return true;
 try{const response=await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({files}),signal:AbortSignal.timeout(10000)});if(!response.ok)console.error(JSON.stringify({level:'error',event:'cdn_purge_failed',status:response.status}));return response.ok;}catch{console.error(JSON.stringify({level:'error',event:'cdn_purge_failed',status:0}));return false;}
}
