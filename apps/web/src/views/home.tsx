import type {Metadata} from 'next';
import {copy,type Lang} from '@/server/i18n';
import Link from 'next/link';
import {activeAnnouncements,homeFacts,fieldCounts} from '@/server/queries';
import {featuredFields} from '@/server/home-facts';
import {areaName,areaPath} from '@/server/model';
import {programLinks} from '@/server/program-links';
import {storedSources} from '@/server/web-sources';
import {networkSummary} from '@/server/network';
import {remainingLabel} from '@/server/model';
import {announcementPath} from '@/server/announcement-text';
import {pageMetadata} from '@/server/page-meta';
import {AnnouncementStrip} from '@/components/announcement-strip';
import {UniversityNetwork} from '@/components/university-network';
import {SiteShell} from '@/components/site-shell';
import {Search} from './shared';
export function homeMetadata(lang:Lang):Metadata{
 return pageMetadata({lang,title:lang==='tr'?'Akademik yarenini bul.':'Find your research partner.',description:lang==='tr'?'Araştırmacıları ve çalışma alanlarını keşfedin. Açıklanabilir alan yakınlığıyla akademik işbirlikleri ve proje ortakları bulun.':'Discover researchers and research fields. Find academic collaborators with explainable field similarity.',pair:{tr:'/tr',en:'/en'},indexable:{tr:true,en:true},ogAlt:'Yarenler · Akademik yarenini bul.'});
}
const HOW={tr:[['Ara','Bir isim ya da çalışma alanı yaz.'],['Gör','Ağda en yakın araştırmacılar ve ortak alanlarınız açılır.'],['Bağlan','Profilden AVESİS sayfasına geç ya da işbirliği duyurusu yayımla.']],en:[['Search','Type a name or a research field.'],['See','The network shows the closest researchers and the fields you share.'],['Connect','Open the AVESİS page from a profile or publish a collaboration announcement.']]};
/**
 * Home page: the same HTML for every visitor; "?person=" is read by the network in the browser.
 * Grid areas keep heading and search on the first mobile screen; numbers, how it works and
 * featured fields follow the network on mobile and sit under the heading on wide screens.
 */
export async function HomeView({lang}:{lang:Lang}){
 const t=copy[lang],anchor=lang==='tr'?'duyurular':'announcements';
 const en=lang==='en',[summary,active,facts,fieldRows]=await Promise.all([networkSummary(lang).catch(()=>undefined),activeAnnouncements().catch(()=>[]),homeFacts().catch(()=>null),fieldCounts().catch(()=>[])]);
 const featured=featuredFields(fieldRows),n=(v:number)=>v.toLocaleString(lang);
 const items=active.map(a=>({id:a.id,text:a.text,name:a.name,path:a.path,url:announcementPath(lang,a.id,a.text),ends:a.ends,remaining:remainingLabel(a.ends,lang),sources:[...programLinks(a.text),...storedSources(a.sources).filter(w=>!programLinks(a.text).some(d=>d.url===w.url)).map(w=>({id:w.url,label:w.title,url:w.url}))]}));
 return <SiteShell lang={lang} otherPath=""><section className="hero home-hero" id={items.length?undefined:anchor}><div className="hero-copy"><h1>{t.title}{' '}<br/><span>{t.accent}</span></h1></div><div className="hero-network"><AnnouncementStrip lang={lang} items={items} anchor={anchor}/><UniversityNetwork lang={lang} toolbar={<Search lang={lang} networkMode/>} summary={summary} readPersonParam/></div><div className="home-facts">{facts&&<dl className="home-numbers" aria-label={en?'Yarenler in numbers':'Sayılarla Yarenler'}><div><dt>{en?'researchers':'araştırmacı'}</dt><dd>{n(facts.researchers)}</dd></div><div><dt>{en?'research fields':'çalışma alanı'}</dt><dd>{n(facts.fields)}</dd></div><div><dt>{en?'units':'birim'}</dt><dd>{n(facts.units)}</dd></div></dl>}<section className="home-how" aria-labelledby="nasil-calisir"><h2 id="nasil-calisir">{en?'How it works':'Nasıl çalışır'}</h2><ol>{HOW[lang].map(([title,text])=><li key={title}><span><strong>{title}.</strong> {text}</span></li>)}</ol></section>{featured.length>0&&<section className="home-fields" aria-labelledby="one-cikan-alanlar"><h2 id="one-cikan-alanlar">{en?'Featured fields':'Öne çıkan alanlar'}</h2><ul>{featured.map(f=><li key={f.id}><Link href={areaPath(f,lang)} lang={en&&!f.ad_en?'tr':undefined}>{areaName(f,lang)}<span>{n(f.people)}</span></Link></li>)}</ul></section>}</div></section></SiteShell>;
}
