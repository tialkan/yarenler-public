/**
 * Indexing rules for public pages, shared with tests. Pure functions: no database access.
 *
 * Thin pages: a field or unit page lists fewer than MIN_INDEXABLE_PEOPLE researchers after the
 * canonical field merge, so it is "noindex, follow" and left out of the sitemap.
 * English copies: an English page is indexable only when its content really exists in English
 * (an English field or unit name from the source data). Otherwise the page stays readable but noindex.
 */
export const MIN_INDEXABLE_PEOPLE=3;
export type Lang='tr'|'en';
export type NamedArea={ad_tr:string|null;ad_en:string|null};
/** Field page: enough researchers, and in English a source-provided English name. */
export function fieldIndexable(lang:Lang,{people,nameEn}:{people:number;nameEn:string|null|undefined}){return people>=MIN_INDEXABLE_PEOPLE&&(lang==='tr'||Boolean(nameEn?.trim()));}
/** Unit page: same threshold; English needs unit.ad_en. */
export function unitIndexable(lang:Lang,{people,nameEn}:{people:number;nameEn:string|null|undefined}){return people>=MIN_INDEXABLE_PEOPLE&&(lang==='tr'||Boolean(nameEn?.trim()));}
/**
 * Person page: Turkish pages are always indexable (0.4 decision 7); a profile with listed publications
 * (Paket 3) is never thin, so no future threshold may drop it. The English copy only when the unit
 * (if any), every listed field and the title (if any) have English forms: publication titles keep their
 * original language and do not make an untranslated page English.
 */
export function personIndexable(lang:Lang,{unitEn,hasUnit,fields,titleEn,hasTitle}:{unitEn:string|null|undefined;hasUnit:boolean;fields:NamedArea[];titleEn:string|null|undefined;hasTitle:boolean;publications?:number}){
 if(lang==='tr')return true;
 return (!hasUnit||Boolean(unitEn?.trim()))&&fields.every(f=>Boolean(f.ad_en?.trim()))&&(!hasTitle||Boolean(titleEn));
}
export type RobotsDecision={index:boolean;follow:true};
export function robots(indexable:boolean):RobotsDecision{return {index:indexable,follow:true};}
/**
 * Canonical and hreflang: hreflang pairs only when both language versions are indexable.
 * x-default points to the Turkish page.
 */
export function alternates(base:string,lang:Lang,pair:{tr:string;en:string},{tr,en}:{tr:boolean;en:boolean},query=''){
 const self=base+pair[lang]+query;
 return tr&&en?{canonical:self,languages:{tr:base+pair.tr+query,en:base+pair.en+query,'x-default':base+pair.tr+query}}:{canonical:self};
}
export type SitemapEntry={url:string;lastModified?:string;alternates?:{tr:string;en:string;'x-default':string}};
/** Sitemap entries for both language versions: noindex versions are left out, hreflang only for indexable pairs. */
export function sitemapPair(base:string,tr:string,en:string,indexable:{tr:boolean;en:boolean},lastModified?:string):SitemapEntry[]{
 const both=indexable.tr&&indexable.en,alt=both?{tr:base+tr,en:base+en,'x-default':base+tr}:undefined,out:SitemapEntry[]=[];
 if(indexable.tr)out.push({url:base+tr,lastModified,alternates:alt});
 if(indexable.en)out.push({url:base+en,lastModified,alternates:alt});
 return out;
}
