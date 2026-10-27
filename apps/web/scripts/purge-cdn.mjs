/**
 * Post-deployment step (Coolify "Post-deployment command": node apps/web/scripts/purge-cdn.mjs).
 * A new release has new /_next/static chunk names; HTML cached at Cloudflare still points to the old
 * ones, so the whole zone cache is purged once after each deployment. Needs CF_ZONE_ID and CF_API_TOKEN
 * (Zone > Cache Purge for this zone only). Without them it only logs a notice. Never prints the token.
 */
const zone=process.env.CF_ZONE_ID,token=process.env.CF_API_TOKEN;
const log=entry=>console.log(JSON.stringify({time:new Date().toISOString(),...entry}));
if(!zone||!/^[a-f0-9]{32}$/.test(zone)||!token){log({level:'warn',event:'cdn_purge_skipped',message:'CF_ZONE_ID ve CF_API_TOKEN tanımlı değil; Cloudflare önbelleğini panelden temizleyin.'});process.exit(0);}
try{
 const response=await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({purge_everything:true}),signal:AbortSignal.timeout(15000)});
 const body=await response.json().catch(()=>({}));
 log({level:response.ok&&body.success?'info':'error',event:'cdn_purge',status:response.status,success:Boolean(body.success)});
 process.exit(response.ok&&body.success?0:1);
}catch(error){log({level:'error',event:'cdn_purge',message:String(error?.name||'error')});process.exit(1);}
