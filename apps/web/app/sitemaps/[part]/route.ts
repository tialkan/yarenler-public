import {sitemapEntries,announcementSitemapEntries,urlset,SITEMAP_PART_SIZE} from '@/server/sitemap';
export const dynamic='force-dynamic';
const headers={'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'};
export async function GET(_request:Request,{params}:{params:Promise<{part:string}>}){
 const {part}=await params;
 if(part==='duyurular.xml'){const entries=await announcementSitemapEntries();return entries.length?new Response(urlset(entries),{headers}):new Response('Not found',{status:404});}
 if(!/^\d{1,4}\.xml$/.test(part))return new Response('Not found',{status:404});
 const entries=await sitemapEntries(),start=Number(part.split('.')[0])*SITEMAP_PART_SIZE;
 if(start>=entries.length)return new Response('Not found',{status:404});
 return new Response(urlset(entries.slice(start,start+SITEMAP_PART_SIZE)),{headers});
}
