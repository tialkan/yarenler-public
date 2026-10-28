import type {Metadata} from 'next';
import {copy,type Lang} from '@/server/i18n';
import {activeAnnouncements} from '@/server/queries';
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
export async function HomeView({lang}:{lang:Lang}){
 const t=copy[lang],anchor=lang==='tr'?'duyurular':'announcements';
 const [summary,active]=await Promise.all([networkSummary(lang).catch(()=>undefined),activeAnnouncements().catch(()=>[])]);
 const items=active.map(a=>({id:a.id,text:a.text,name:a.name,path:a.path,url:announcementPath(lang,a.id,a.text),ends:a.ends,remaining:remainingLabel(a.ends,lang),sources:[...programLinks(a.text),...storedSources(a.sources).filter(w=>!programLinks(a.text).some(d=>d.url===w.url)).map(w=>({id:w.url,label:w.title,url:w.url}))]}));
 return <SiteShell lang={lang} otherPath=""><section className="hero home-hero" id={items.length?undefined:anchor}><div className="hero-copy"><h1>{t.title}{' '}<br/><span>{t.accent}</span></h1></div><div className="hero-network"><AnnouncementStrip lang={lang} items={items} anchor={anchor}/><UniversityNetwork lang={lang} toolbar={<Search lang={lang} networkMode/>} summary={summary} readPersonParam/></div></section></SiteShell>;
}
