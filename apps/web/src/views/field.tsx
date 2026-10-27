import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {copy,paths,type Lang} from '@/server/i18n';
import {people,findArea,fieldFacts,fieldContext,listingNames} from '@/server/queries';
import {fieldSummary} from '@/server/seo-text';
import {areaName,areaPath,unitPath} from '@/server/model';
import {fieldIndexable} from '@/server/seo-rules';
import {pageMetadata,baseUrl,version} from '@/server/page-meta';
import {jsonLd,collectionPage} from '@/server/structured-data';
import {PersonCard} from '@/components/person-card';
import {SiteShell,JsonLd} from '@/components/site-shell';
import {PAGE_SIZE,Pagination,pageQuery} from './shared';
async function load(param:string){const field=await findArea(param);if(!field)return null;const [facts,context]=await Promise.all([fieldFacts(field.id),fieldContext(field.id)]);return {field,facts,context};}
const summary=(lang:Lang,d:NonNullable<Awaited<ReturnType<typeof load>>>)=>fieldSummary(lang,{name:areaName(d.field,lang),schemes:d.field.schemes,people:d.facts.people,units:d.facts.units,topUnit:d.facts.top_unit});
const fieldPair=(slug:string)=>({tr:`/tr/alan/${slug}`,en:`/en/field/${slug}`});
export async function fieldMetadata(lang:Lang,param:string,page:number):Promise<Metadata>{
 const d=await load(param);if(!d||!d.field.slug)return {title:lang==='tr'?'Alan bulunamadı':'Field not found',robots:{index:false,follow:true}};
 const name=areaName(d.field,lang),people=d.context.listed;
 const description=summary(lang,d)+' '+(lang==='tr'?`${name} alanındaki araştırmacıları ve ortak alanlarını keşfet.`:`Explore researchers in ${name} and their shared fields.`);
 return pageMetadata({lang,title:page>1?`${name} · ${page}`:name,description,pair:fieldPair(d.field.slug),query:pageQuery(page),indexable:{tr:fieldIndexable('tr',{people,nameEn:d.field.ad_en}),en:fieldIndexable('en',{people,nameEn:d.field.ad_en})},ogImage:`/og/field/${d.field.slug}.png?v=${version(d.context.updated)}${lang==='en'?'&lang=en':''}`});
}
export async function FieldView({lang,param,page}:{lang:Lang;param:string;page:number}){
 const t=copy[lang],p=paths[lang],other:Lang=lang==='tr'?'en':'tr',en=lang==='en';
 const d=await load(param);if(!d)notFound();const {field,context}=d;
 if(field.slug&&field.slug!==param)permanentRedirect(`/${lang}/${p.field}/${field.slug}${pageQuery(page)}`);
 const [result,names]=await Promise.all([people('',page,PAGE_SIZE,field.id),listingNames(field.id,null)]);
 if(page>1&&(page-1)*PAGE_SIZE>=result.total)notFound();
 const base=baseUrl(),name=areaName(field,lang),path=`/${lang}/${p.field}/${param}`,url=base+path+pageQuery(page);
 const structured=jsonLd(collectionPage({base,url,lang,name,description:summary(lang,d),total:result.total,people:names.map(n=>({name:n.name,url:base+(en?n.path.replace('/tr/','/en/'):n.path)})),crumbs:[{name:'Yarenler',url:`${base}/${lang}`},{name:t.explore,url:`${base}/${lang}/${p.explore}`},{name,url:base+path}]}));
 const nameLang=(a:{ad_en:string|null})=>en&&!a.ad_en?'tr':undefined;
 return <SiteShell lang={lang} otherPath={`/${paths[other].field}/${param}${pageQuery(page)}`}><section className="inner-page"><JsonLd json={structured}/><p className="eyebrow">{t.field}</p><h1 lang={nameLang(field)}>{name}</h1><p className="lead field-intro">{summary(lang,d)}</p>
  {context.related.length>0&&<><h2 className="label-heading">{en?'Fields listed together':'Birlikte görülen alanlar'}</h2><div className="tags large-tags">{context.related.map(a=><Link key={a.id} href={areaPath(a,lang)} lang={nameLang(a)}>{areaName(a,lang)} ({a.count})</Link>)}</div></>}
  {context.units.length>0&&<><h2 className="label-heading">{en?'Researchers by unit':'Birimlere dağılım'}</h2><div className="tags large-tags">{context.units.map(u=><Link key={u.id} href={unitPath(u.slug||'',lang)} lang={nameLang(u)}>{en?u.ad_en||u.ad_tr:u.ad_tr} ({u.count})</Link>)}</div></>}
  <p className="result-count">{result.total} {t.results}</p><div className="people-grid">{result.items.map(person=><PersonCard person={person} lang={lang} key={person.id}/>)}</div><Pagination lang={lang} page={page} total={result.total} path={path}/></section></SiteShell>;
}
