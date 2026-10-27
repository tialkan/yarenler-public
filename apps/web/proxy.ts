import {NextRequest,NextResponse} from 'next/server';
import {dsnOrigin} from '@/server/error-tracking';
import {announcementLive,goneHtml} from '@/server/announcement-status';
import {routeRequest} from '@/server/routing';
import {buildCsp} from './scripts/csp-lib.mjs';
import {adminConfigLogged,clientIp,ipAllowed,isAdminPath} from '@/server/admin-security';
/**
 * Proxy: host canonicalisation, internal rewrites that keep public pages static (src/server/routing.ts),
 * 410 for expired announcements, and the fallback security headers.
 *
 * CSP: no nonces (cached HTML would share one). The strict fallback below lets no inline script run;
 * the front server (scripts/front-server.mjs) replaces it on HTML responses with the hashes of the
 * framework's own inline scripts. Without the front server pages fail closed, never open.
 */
function secure(response:NextResponse){
 response.headers.set('Content-Security-Policy',buildCsp({reportOrigin:dsnOrigin(process.env.SENTRY_DSN),dev:process.env.NODE_ENV==='development'}));
 response.headers.set('X-App-Version',process.env.SOURCE_COMMIT||'0.4.0');
 if(process.env.INDEXABLE!=='true')response.headers.set('X-Robots-Tag','noindex, nofollow');
 return response;
}
/** Panel responses: never cached, never indexed (outside the public ISR and CDN cache, ADR 0007). */
function panel(response:NextResponse){response.headers.set('Cache-Control','no-store');response.headers.set('X-Robots-Tag','noindex, nofollow');return response;}
export async function proxy(request:NextRequest){
 const url=request.nextUrl,host=request.headers.get('host')?.split(':')[0];
 if(host==='www.yarenler.org'){const target=url.clone();target.host='yarenler.org';if(target.pathname==='/')target.pathname='/tr';target.protocol='https:';target.port='';return NextResponse.redirect(target,308);}
 if(isAdminPath(url.pathname)){
  // Panel off (YONETICI_* or ADMIN_DATABASE_URL missing, password too short) or address not in ADMIN_ALLOWED_IPS: the site's ordinary 404.
  const config=adminConfigLogged(process.env);
  if(!config||!ipAllowed(config.allowedIps,clientIp(name=>request.headers.get(name)))){const target=url.clone();target.pathname='/tr/yonetici';target.search='';return panel(secure(NextResponse.rewrite(target)));}
  return panel(secure(NextResponse.next()));
 }
 if(/^\/(tr\/itiraz|en\/appeal|tr\/kurumsal-katilim|en\/institutional-participation)\/?$/.test(url.pathname))return panel(secure(NextResponse.next()));
 const routed=routeRequest(url.pathname,url.searchParams);
 if(routed.kind==='announcement'){
  // Expired or removed: 410 Gone with a short noindex notice. Unknown id: the page answers 404.
  const live=await announcementLive(routed.id).catch(()=>true);
  if(live===false)return secure(new NextResponse(goneHtml(routed.lang),{status:410,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=3600','X-Robots-Tag':'noindex, follow'}}));
 }
 if(routed.kind==='redirect'){const target=url.clone();target.pathname=routed.pathname;return secure(NextResponse.redirect(target,308));}
 if(routed.kind==='rewrite'){const target=url.clone();target.pathname=routed.pathname;if(routed.dropPage)target.searchParams.delete('page');return secure(NextResponse.rewrite(target));}
 return secure(NextResponse.next());
}
export const config={matcher:['/((?!api|_next/static|_next/image|og/|favicon.ico|robots.txt|sitemap.xml|sitemaps/|manifest.webmanifest|fonts|images|brand|icon-|apple-touch-icon|opengraph-image|llms.txt|indexnow-key.txt|\\.well-known).*)']};
