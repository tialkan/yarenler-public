import 'server-only';
import {db} from './db';
import {personPath,unitPath} from './model';
import {MIN_INDEXABLE_PEOPLE,fieldIndexable,unitIndexable,personIndexable,sitemapPair,type SitemapEntry} from './seo-rules';
import {titleEn} from './titles';
import {announcementPath} from './announcement-text';
export const SITEMAP_PART_SIZE=2000;
const iso=(value:unknown)=>value?new Date(value as string).toISOString():undefined;
const pair=sitemapPair;
let cache:{at:number;pages:SitemapEntry[];announcements:SitemapEntry[]}|null=null;
/** Every indexable page. noindex pages (thin fields and units, untranslated English copies, search, account) are never listed. */
async function build(){
 if(process.env.INDEXABLE!=='true')return {pages:[],announcements:[]};
 if(cache&&Date.now()-cache.at<600000)return cache;
 const base=process.env.PUBLIC_BASE_URL!;
 const [persons,fields,units,ann]=await Promise.all([
  db().query(`SELECT p.kisa_kimlik,p.gorunen_ad,p.unvan,(p.unit_id IS NOT NULL) has_unit,u.ad_en unit_en,
    NOT EXISTS(SELECT 1 FROM person_matching_area ma JOIN research_area a ON a.id=ma.area_id WHERE ma.person_id=p.id AND a.ad_en IS NULL) fields_en,
    greatest(p.guncelleme,(SELECT max(pa.eklenme) FROM person_research_area pa WHERE pa.person_id=p.id),(SELECT max(ca.added_at) FROM person_collaboration_area ca WHERE ca.person_id=p.id)) updated
   FROM person p LEFT JOIN unit u ON u.id=p.unit_id WHERE p.aktif ORDER BY p.kisa_kimlik LIMIT 45000`),
  db().query(`SELECT k.slug,k.ad_en,count(DISTINCT p.id)::int people,greatest(k.guncelleme,max(p.guncelleme),max(pa.eklenme)) updated
   FROM research_area k JOIN person_matching_area ma ON ma.area_id=k.id JOIN person p ON p.id=ma.person_id AND p.aktif LEFT JOIN person_research_area pa ON pa.person_id=p.id
   WHERE k.kanonik_id IS NULL AND k.slug IS NOT NULL GROUP BY k.id HAVING count(DISTINCT p.id)>=$1 ORDER BY k.slug`,[MIN_INDEXABLE_PEOPLE]),
  db().query(`WITH RECURSIVE tree AS (SELECT id root,id FROM unit UNION ALL SELECT tree.root,c.id FROM unit c JOIN tree ON c.ust_id=tree.id)
   SELECT u.slug,u.ad_en,count(DISTINCT p.id)::int people,greatest(u.guncelleme,max(p.guncelleme)) updated
   FROM unit u JOIN tree ON tree.root=u.id JOIN person p ON p.unit_id=tree.id AND p.aktif GROUP BY u.id HAVING count(DISTINCT p.id)>=$1 ORDER BY u.slug`,[MIN_INDEXABLE_PEOPLE]),
  db().query(`SELECT a.kisa_kimlik,a.yayin_metni,a.guncelleme FROM announcement a JOIN person p ON p.id=a.sahip_id AND p.aktif WHERE a.durum='yayinda' AND a.bitis>now() ORDER BY a.yayin_tarihi DESC`),
 ]);
 const statics:[string,string][]=[['/tr','/en'],['/tr/kesfet','/en/explore'],['/tr/duyurular','/en/announcements'],['/tr/hakkinda','/en/about'],['/tr/gizlilik','/en/privacy']];
 const pages:SitemapEntry[]=[
  ...statics.flatMap(([tr,en])=>pair(base,tr,en,{tr:true,en:true})),
  ...persons.rows.flatMap(r=>pair(base,personPath(r.kisa_kimlik,r.gorunen_ad),personPath(r.kisa_kimlik,r.gorunen_ad,'en'),{tr:true,en:personIndexable('en',{hasUnit:r.has_unit,unitEn:r.unit_en,fields:r.fields_en?[]:[{ad_tr:'',ad_en:null}],hasTitle:Boolean(r.unvan),titleEn:titleEn(r.unvan)})},iso(r.updated))),
  ...fields.rows.flatMap(r=>pair(base,`/tr/alan/${r.slug}`,`/en/field/${r.slug}`,{tr:fieldIndexable('tr',{people:r.people,nameEn:r.ad_en}),en:fieldIndexable('en',{people:r.people,nameEn:r.ad_en})},iso(r.updated))),
  ...units.rows.flatMap(r=>pair(base,unitPath(r.slug,'tr'),unitPath(r.slug,'en'),{tr:unitIndexable('tr',{people:r.people,nameEn:r.ad_en}),en:unitIndexable('en',{people:r.people,nameEn:r.ad_en})},iso(r.updated))),
 ];
 const announcements=ann.rows.flatMap(r=>pair(base,announcementPath('tr',r.kisa_kimlik,r.yayin_metni),announcementPath('en',r.kisa_kimlik,r.yayin_metni),{tr:true,en:true},iso(r.guncelleme)));
 cache={at:Date.now(),pages,announcements};return cache;
}
export async function sitemapEntries(){return (await build()).pages;}
export async function announcementSitemapEntries(){return (await build()).announcements;}
/** Drops the in-memory sitemap after a publish or profile change. */
export function invalidateSitemap(){cache=null;}
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function urlset(entries:SitemapEntry[]){return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.map(e=>`<url><loc>${escape(e.url)}</loc>${e.lastModified?`<lastmod>${e.lastModified}</lastmod>`:''}${e.alternates?Object.entries(e.alternates).map(([lang,url])=>`<xhtml:link rel="alternate" hreflang="${lang}" href="${escape(url)}"/>`).join(''):''}</url>`).join('')}</urlset>\n`;}
