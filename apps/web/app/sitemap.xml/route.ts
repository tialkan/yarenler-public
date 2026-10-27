import {sitemapEntries,announcementSitemapEntries,SITEMAP_PART_SIZE} from '@/server/sitemap';
export const dynamic='force-dynamic';
/** Sitemap index: page parts plus a separate announcement sitemap. Public, cacheable at the CDN. */
export async function GET(){
 const [entries,announcements]=await Promise.all([sitemapEntries(),announcementSitemapEntries()]);const base=process.env.PUBLIC_BASE_URL;
 const parts=Array.from({length:Math.ceil(entries.length/SITEMAP_PART_SIZE)},(_,i)=>`<sitemap><loc>${base}/sitemaps/${i}.xml</loc></sitemap>`);
 if(announcements.length)parts.push(`<sitemap><loc>${base}/sitemaps/duyurular.xml</loc></sitemap>`);
 return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${parts.join('')}</sitemapindex>\n`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'}});
}
