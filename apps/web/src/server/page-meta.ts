import type {Metadata} from 'next';
import {alternates,type Lang} from './seo-rules';
export const baseUrl=()=>process.env.PUBLIC_BASE_URL||'http://localhost:3000';
export const DEFAULT_OG='/opengraph-image.png?v=2';
/** Short cache-busting token for share image URLs, from a last-change timestamp. */
export const version=(stamp:string|null|undefined)=>{const t=stamp?Date.parse(stamp):NaN;return Number.isFinite(t)?Math.floor(t/1000).toString(36):'1';};
export const rssLinks=(lang:Lang)=>({'application/rss+xml':[{url:lang==='tr'?'/tr/duyurular/rss.xml':'/en/announcements/rss.xml',title:lang==='tr'?'Yarenler duyuruları':'Yarenler announcements'}]});
/**
 * Page metadata in one place: canonical, hreflang only for pairs that are both indexable, RSS link,
 * robots, Open Graph and Twitter card with the page's own share image.
 */
export function pageMetadata({lang,title,description,pair,indexable,query='',ogImage=DEFAULT_OG,ogAlt,type='website',absoluteTitle=false}:{lang:Lang;title:string;description:string;pair:{tr:string;en:string};indexable:{tr:boolean;en:boolean};query?:string;ogImage?:string;ogAlt?:string;type?:'website'|'profile'|'article';absoluteTitle?:boolean}):Metadata{
 const base=baseUrl(),alt=alternates(base,lang,pair,indexable,query),self=indexable[lang];
 return {
  title:absoluteTitle?{absolute:title}:title,description,
  robots:self?undefined:{index:false,follow:true},
  alternates:{...alt,types:rssLinks(lang)},
  openGraph:{title:`${title} | Yarenler`,description,url:base+pair[lang]+query,type,locale:lang==='tr'?'tr_TR':'en_GB',siteName:'Yarenler',images:[{url:ogImage,width:1200,height:630,alt:ogAlt||title}]},
  twitter:{card:'summary_large_image',title:`${title} | Yarenler`,description,images:[ogImage]},
 };
}
