import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {copy,paths,type Lang} from '@/server/i18n';
import {people,type InstitutionFilter} from '@/server/queries';
import {pageMetadata,baseUrl} from '@/server/page-meta';
import {jsonLd,webPage} from '@/server/structured-data';
import {PersonCard} from '@/components/person-card';
import {SiteShell,JsonLd} from '@/components/site-shell';
import {PAGE_SIZE,Pagination,Search,pageQuery} from './shared';
const pair={tr:'/tr/kesfet',en:'/en/explore'};
/** Researcher listing without a query: static, cached; "?page=" is rewritten to "/kesfet/{n}" by the proxy. */
export function exploreMetadata(lang:Lang,page:number):Metadata{const t=copy[lang];return pageMetadata({lang,title:page>1?`${t.explore} · ${page}`:t.explore,description:t.exploreDescription,pair,query:pageQuery(page),indexable:{tr:true,en:true}});}
/** Search results ("?q=", "?kurum="): rendered per request, never indexed; canonical is the explore page. */
export function searchMetadata(lang:Lang,q:string):Metadata{const t=copy[lang],s=q.slice(0,120);const meta=pageMetadata({lang,title:s?`${s} · ${t.explore}`:t.explore,description:lang==='tr'?`${s} araması: Araştırmacılar ve çalışma alanları.`:`Search for ${s}: Researchers and their fields.`,pair,indexable:{tr:false,en:false}});return {...meta,alternates:{canonical:baseUrl()+pair[lang],types:meta.alternates?.types}};}
export async function ExploreView({lang,q='',page,search=false}:{lang:Lang;q?:string;page:number;kurum?:InstitutionFilter;search?:boolean}){
 const t=copy[lang],p=paths[lang],other:Lang=lang==='tr'?'en':'tr';
 if(q.length>120)return <SiteShell lang={lang} otherPath={'/'+paths[other].explore}><div className="error-page">{lang==='tr'?'Arama en fazla 120 karakter olabilir.':'Search may contain at most 120 characters.'}</div></SiteShell>;
 const result=await people(q,page,PAGE_SIZE);
 if(!search&&page>1&&(page-1)*PAGE_SIZE>=result.total)notFound();
 const path=`/${lang}/${p.explore}`,base=baseUrl();
 const structured=search?null:jsonLd(webPage({base,url:base+path+pageQuery(page),lang,name:t.explore,description:t.exploreDescription,type:'CollectionPage',crumbs:[{name:'Yarenler',url:`${base}/${lang}`},{name:t.explore,url:base+path}]}));
 const query=q?'q='+encodeURIComponent(q):'';
 return <SiteShell lang={lang} otherPath={'/'+paths[other].explore+(q?'?q='+encodeURIComponent(q):'')}><section className="inner-page">{structured&&<JsonLd json={structured}/>}<p className="eyebrow">Yarenler / {t.explore}</p><h1>{t.peopleTitle}</h1><Search lang={lang} value={q}/><p className="result-count">{result.total.toLocaleString(lang)} {t.results}{q&&<> · “{q}”</>}</p>{q&&<p className="source-note">{lang==='tr'?'Ad ve alan eşleşme yakınlığına göre sıralanır.':'Sorted by name and research-field relevance.'}</p>}<div className="people-grid">{result.items.map(person=><PersonCard key={person.id} person={person} lang={lang}/>)}</div>{!result.total&&<div className="empty-state"><h2>{t.noResults}</h2><p>{t.tryAgain}</p></div>}<Pagination lang={lang} page={page} total={result.total} path={path} query={query}/></section></SiteShell>;
}
