import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {copy,paths,type Lang} from '@/server/i18n';
import {people,findUnit,unitContext,listingNames} from '@/server/queries';
import {unitSummary} from '@/server/seo-text';
import {areaName,areaPath,unitPath} from '@/server/model';
import {unitIndexable} from '@/server/seo-rules';
import {pageMetadata,baseUrl,version} from '@/server/page-meta';
import {jsonLd,collectionPage} from '@/server/structured-data';
import {PersonCard} from '@/components/person-card';
import {SiteShell,JsonLd} from '@/components/site-shell';
import {PAGE_SIZE,Pagination,pageQuery} from './shared';
async function load(param:string){const unit=await findUnit(param);if(!unit)return null;return {unit,context:await unitContext(unit)};}
type Loaded=NonNullable<Awaited<ReturnType<typeof load>>>;
const nameOf=(u:{ad_tr:string|null;ad_en:string|null},lang:Lang)=>(lang==='en'?u.ad_en||u.ad_tr:u.ad_tr)||'';
const summary=(lang:Lang,d:Loaded)=>unitSummary(lang,{name:nameOf(d.unit,lang),people:d.context.people,topFields:d.context.topFields.map(a=>areaName(a,lang)),related:d.context.related.map(u=>nameOf(u,lang))});
export async function unitMetadata(lang:Lang,param:string,page:number):Promise<Metadata>{
 const d=await load(param);if(!d)return {title:lang==='tr'?'Birim bulunamadı':'Unit not found',robots:{index:false,follow:true}};
 const name=nameOf(d.unit,lang),n=d.context.people;
 return pageMetadata({lang,title:page>1?`${name} · ${page}`:name,description:summary(lang,d),pair:{tr:unitPath(d.unit.slug,'tr'),en:unitPath(d.unit.slug,'en')},query:pageQuery(page),indexable:{tr:unitIndexable('tr',{people:n,nameEn:d.unit.ad_en}),en:unitIndexable('en',{people:n,nameEn:d.unit.ad_en})},ogImage:`/og/unit/${d.unit.slug}.png?v=${version(d.context.updated)}${lang==='en'?'&lang=en':''}`});
}
export async function UnitView({lang,param,page}:{lang:Lang;param:string;page:number}){
 const t=copy[lang],other:Lang=lang==='tr'?'en':'tr',en=lang==='en';
 const d=await load(param);if(!d)notFound();const {unit,context}=d;
 if(unit.slug!==param)permanentRedirect(unitPath(unit.slug,lang)+pageQuery(page));
 const [result,names]=await Promise.all([people('',page,PAGE_SIZE,undefined,unit.subtree),listingNames(null,unit.subtree)]);
 if(page>1&&(page-1)*PAGE_SIZE>=result.total)notFound();
 const base=baseUrl(),name=nameOf(unit,lang),path=unitPath(unit.slug,lang),url=base+path+pageQuery(page);
 const crumbs=[{name:'Yarenler',url:`${base}/${lang}`},...unit.ancestors.map(a=>({name:nameOf(a,lang),url:base+unitPath(a.slug,lang)})),{name,url:base+path}];
 const structured=jsonLd(collectionPage({base,url,lang,name,description:summary(lang,d),total:result.total,people:names.map(n=>({name:n.name,url:base+(en?n.path.replace('/tr/','/en/'):n.path)})),crumbs}));
 const nameLang=(a:{ad_en:string|null})=>en&&!a.ad_en?'tr':undefined;
 return <SiteShell lang={lang} otherPath={`/${paths[other].unit}/${unit.slug}${pageQuery(page)}`}><section className="inner-page"><JsonLd json={structured}/><p className="eyebrow">{t.unit}{unit.ancestors.map(a=><span key={a.id}> / <Link href={unitPath(a.slug,lang)} lang={nameLang(a)}>{nameOf(a,lang)}</Link></span>)}</p><h1 lang={nameLang(unit)}>{name}</h1><p className="lead field-intro">{summary(lang,d)}</p>
  {context.topFields.length>0&&<><h2 className="label-heading">{en?'Most frequent fields':'En sık çalışma alanları'}</h2><div className="tags large-tags">{context.topFields.map(a=><Link key={a.id} href={areaPath(a,lang)} lang={nameLang(a)}>{areaName(a,lang)} ({a.count})</Link>)}</div></>}
  {context.related.length>0&&<><h2 className="label-heading">{en?'Related units':'İlişkili birimler'}</h2><div className="tags large-tags">{context.related.map(u=><Link key={u.id} href={unitPath(u.slug||'',lang)} lang={nameLang(u)}>{nameOf(u,lang)}</Link>)}</div></>}
  {unit.children.length>0&&<><h2 className="label-heading">{en?'Sub-units':'Alt birimler'}</h2><div className="tags large-tags">{unit.children.map(c=><Link key={c.id} href={unitPath(c.slug,lang)} lang={nameLang(c)}>{nameOf(c,lang)} ({c.people})</Link>)}</div></>}
  <p className="result-count">{result.total} {t.results}</p><div className="people-grid">{result.items.map(person=><PersonCard person={person} lang={lang} key={person.id}/>)}</div><Pagination lang={lang} page={page} total={result.total} path={path}/></section></SiteShell>;
}
