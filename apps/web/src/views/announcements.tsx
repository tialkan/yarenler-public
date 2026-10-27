import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {copy,paths,type Lang} from '@/server/i18n';
import {activeAnnouncements,announcementById} from '@/server/queries';
import {announcementInsights,skillMatches} from '@/server/network';
import {db} from '@/server/db';
import {programLinks} from '@/server/program-links';
import {domainOf,storedSources} from '@/server/web-sources';
import {remainingLabel,personPath,areaName,areaPath} from '@/server/model';
import {announcementTitle,announcementPath,announcementDescription,announcementIdFrom,announcementsSegment} from '@/server/announcement-text';
import {pageMetadata,baseUrl,version} from '@/server/page-meta';
import {jsonLd,webPage,announcementArticle} from '@/server/structured-data';
import {headingCase} from '@/server/text-case';
import {AnnouncementInterest} from '@/components/announcement-interest';
import {PublishCta} from '@/components/announcement-strip';
import {SiteShell,JsonLd} from '@/components/site-shell';
const listPair={tr:'/tr/duyurular',en:'/en/announcements'};
const dateLabel=(iso:string,lang:Lang)=>new Date(iso).toLocaleDateString(lang==='tr'?'tr-TR':'en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Istanbul'});
export function announcementsMetadata(lang:Lang):Metadata{const t=copy[lang];return pageMetadata({lang,title:t.announcements,description:t.annIntro,pair:listPair,indexable:{tr:true,en:true}});}
/** Announcement list: every active announcement with its own address; cached, revalidated after publish and removal. */
export async function AnnouncementsView({lang}:{lang:Lang}){
 const t=copy[lang],other:Lang=lang==='tr'?'en':'tr',base=baseUrl(),path=listPair[lang];
 const items=await activeAnnouncements(100);
 const structured=jsonLd(webPage({base,url:base+path,lang,name:t.announcements,description:t.annIntro,type:'CollectionPage',crumbs:[{name:'Yarenler',url:`${base}/${lang}`},{name:t.announcements,url:base+path}]}));
 return <SiteShell lang={lang} otherPath={'/'+announcementsSegment[other]}><section className="inner-page prose"><JsonLd json={structured}/><p className="eyebrow">Yarenler / {t.announcements}</p><h1>{t.annTitle}</h1><p className="lead">{t.annIntro}</p><p className="source-note"><a href={`${path}/rss.xml`} type="application/rss+xml">{lang==='tr'?'RSS akışı':'RSS feed'}</a></p><PublishCta lang={lang}/>
  {items.length?items.map(a=><article className="announcement" key={a.id}><h2><Link href={announcementPath(lang,a.id,a.text)}>{announcementTitle(a.text)}</Link></h2><p>{announcementDescription(a.text,280)}</p><p className="ann-meta"><Link href={lang==='en'?a.path.replace('/tr/','/en/'):a.path}>{a.name}</Link><span aria-hidden="true"> · </span><time dateTime={a.ends}>{remainingLabel(a.ends,lang)}</time></p></article>):<div className="empty-state"><h2>{t.annEmpty}</h2><p>{t.annEmptyText}</p><Link className="button" href={`/${lang}/${paths[lang].login}`}>{t.login} ↗</Link></div>}
 </section></SiteShell>;
}
async function load(param:string){const id=announcementIdFrom(param);if(!id)return null;return announcementById(id);}
type Item=NonNullable<Awaited<ReturnType<typeof announcementById>>>;
const ogFor=(a:Item,lang:Lang)=>`/og/announcement/${a.id}.png?v=${version(a.updated)}${lang==='en'?'&lang=en':''}`;
export async function announcementMetadata(lang:Lang,param:string):Promise<Metadata>{
 const a=await load(param);if(!a)return {title:lang==='tr'?'Duyuru bulunamadı':'Announcement not found',robots:{index:false,follow:true}};
 const pair={tr:announcementPath('tr',a.id,a.text),en:announcementPath('en',a.id,a.text)};
 return {...pageMetadata({lang,title:announcementTitle(a.text),description:announcementDescription(a.text),pair,indexable:{tr:a.live,en:a.live},ogImage:ogFor(a,lang),type:'article'}),other:{'article:published_time':a.published,'article:expiration_time':a.ends}};
}
/** Insight lists for an announcement: catalogue fields that match its text and researchers whose fields match. */
async function insights(a:Item,lang:Lang){
 const {people,fieldIds}=a.skills.length?{people:await skillMatches(a.skills.map(s=>s.id),a.ownerShort),fieldIds:a.skills.map(s=>s.id)}:await announcementInsights(a.text,a.ownerShort).catch(()=>({people:[],fieldIds:[] as string[]}));
 const fields=fieldIds.length?(await db().query('SELECT id,slug,yarenler_alan_temiz(ad_tr) ad_tr,yarenler_alan_temiz(ad_en) ad_en FROM research_area WHERE id=ANY($1::uuid[])',[fieldIds])).rows.map(r=>({...r,ad_tr:headingCase(r.ad_tr),ad_en:headingCase(r.ad_en)})):[];
 fields.sort((x,y)=>fieldIds.indexOf(x.id)-fieldIds.indexOf(y.id));
 return {people:people.slice(0,6).map(p=>({...p,url:lang==='en'?p.url.replace('/tr/','/en/'):p.url})),fields};
}
export async function AnnouncementView({lang,param}:{lang:Lang;param:string}){
 const t=copy[lang],other:Lang=lang==='tr'?'en':'tr',en=lang==='en';
 const a=await load(param);if(!a)notFound();
 const canonical=announcementPath(lang,a.id,a.text);if(`/${lang}/${en?'announcement':'duyuru'}/${param}`!==canonical)permanentRedirect(canonical);
 const base=baseUrl(),url=base+canonical,title=announcementTitle(a.text),owner=personPath(a.ownerShort,a.name,lang),list=listPair[lang];
 if(!a.live)return <SiteShell lang={lang} otherPath={announcementPath(other,a.id,a.text).slice(3)}><section className="inner-page prose"><p className="eyebrow">410 / YARENLER</p><h1>{en?'This announcement has expired':'Bu duyurunun süresi doldu'}</h1><p><Link href={list}>{en?'Current announcements':'Güncel duyurular'}</Link></p></section></SiteShell>;
 // Sources: the verified program dictionary first, then the web sources the author kept (verified at assistance time).
 const dictionary=programLinks(a.text),sources=[...dictionary.map(d=>({url:d.url,title:d.label,domain:domainOf(d.url)})),...storedSources(a.sources).filter(w=>!dictionary.some(d=>d.url===w.url))];
 const {people,fields}=await insights(a,lang);
 const structured=jsonLd(announcementArticle({base,url,lang,headline:title,text:a.text,datePublished:a.published,dateModified:a.updated,expires:a.ends,author:{name:a.name,url:base+owner},about:fields.map(f=>({name:areaName(f,lang),url:base+areaPath(f,lang)})),crumbs:[{name:'Yarenler',url:`${base}/${lang}`},{name:t.announcements,url:base+list},{name:title,url}]}));
 return <SiteShell lang={lang} otherPath={announcementPath(other,a.id,a.text).slice(3)}><article className="inner-page"><JsonLd json={structured}/><p className="eyebrow"><Link href={list}>{t.announcements}</Link></p><h1>{title}</h1><p className="ann-meta"><Link href={owner}>{a.name}</Link><span aria-hidden="true"> · </span><time dateTime={a.published}>{dateLabel(a.published,lang)}</time><span aria-hidden="true"> · </span><time dateTime={a.ends}>{remainingLabel(a.ends,lang)}</time></p><div className="announcement prose"><p>{a.text}</p></div><AnnouncementInterest id={a.id} lang={lang}/>{a.skills.length>0&&<p className="source-note">{en?'Skills sought: ':'Aranan yetkinlikler: '}{a.skills.map(s=>s.name).join(' · ')}</p>}
  {sources.length>0&&<section className="ann-sources"><h2 className="label-heading">{en?'Sources':'Kaynaklar'}</h2><ul>{sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a> <span className="source-domain">{s.domain}</span></li>)}</ul></section>}
  {fields.length>0&&<><h2 className="label-heading">{en?'Related fields':'İlgili alanlar'}</h2><div className="tags large-tags">{fields.map(f=><Link key={f.id} href={areaPath(f,lang)} lang={en&&!f.ad_en?'tr':undefined}>{areaName(f,lang)}</Link>)}</div></>}
  {people.length>0&&<section className="profile-matches"><h2>{en?'Potential collaborators':'Potansiyel yarenler'}</h2><ul>{people.map(p=><li key={p.id}><Link href={p.url}>{p.name}</Link>{p.unit&&<span>{p.unit}</span>}<p>{p.reasons.map(r=>r.field).join(' · ')}</p></li>)}</ul><p className="source-note">{en?'Matched by research field labels in the announcement text; not a probability of collaboration.':'Duyuru metnindeki ifadelerle çalışma alanı etiketleri eşleştirildi; işbirliği olasılığı değildir.'}</p></section>}
  <p><Link className="text-link" href={list}>← {en?'All announcements':'Tüm duyurular'}</Link></p></article></SiteShell>;
}
/** Shared GET for both RSS routes. */
export async function announcementRss(lang:Lang){
 const {rssFeed}=await import('@/server/rss');const base=baseUrl(),t=copy[lang],list=listPair[lang];
 const items=await activeAnnouncements(100);
 const body=rssFeed({title:`Yarenler · ${t.announcements}`,link:base+list,self:`${base}${list}/rss.xml`,description:t.annIntro,language:lang,items:items.map(a=>{const link=base+announcementPath(lang,a.id,a.text);return {title:announcementTitle(a.text),link,guid:link,description:a.text,pubDate:new Date(a.published),creator:a.name};})});
 return new Response(body,{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'public, max-age=300, s-maxage=900, stale-while-revalidate=3600'}});
}
