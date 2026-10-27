import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import {copy,paths,type Lang} from '@/server/i18n';
import {person,ring,personPublications,type PersonPublications} from '@/server/queries';
import {profileTitle,profileDescription} from '@/server/seo-text';
import {distinctAreas,profileLink,areaName,areaPath,unitPath} from '@/server/model';
import {personIndexable} from '@/server/seo-rules';
import {titleEn,displayTitle} from '@/server/titles';
import {pageMetadata,baseUrl,version} from '@/server/page-meta';
import {jsonLd,profilePage} from '@/server/structured-data';
import {groupCounts,publicationLink,publicationMeta,workNodes} from '@/server/publications';
import {ProfileFingerprint} from '@/components/profile-fingerprint';
import {personFieldEvidence} from '@/server/profile-evidence';
import {profileBand,sharedPublicationLabel} from '@/server/profile-discovery';
import {bandLabel,bandTitle} from '@/server/score-bands';
import {UniversityNetwork} from '@/components/university-network';
import {SiteShell,JsonLd} from '@/components/site-shell';
type Found=NonNullable<Awaited<ReturnType<typeof person>>>;
async function load(param:string){const id=param.split('-')[0];if(!/^[0-9a-z]{4,12}$/.test(id))return null;return person(id);}
function indexable(found:Found){const fields=[...distinctAreas(found.alanlar),...distinctAreas(found.interests||[])];return {tr:true,en:personIndexable('en',{hasUnit:Boolean(found.birim),unitEn:found.birim?.ad_en,fields,hasTitle:Boolean(found.unvan),titleEn:titleEn(found.unvan)})};}
const unitName=(found:Found,lang:Lang)=>found.birim?(lang==='en'?found.birim.ad_en||found.birim.ad:found.birim.ad):null;
const institutionName=(found:Found,lang:Lang)=>found.kurum?(lang==='en'?found.kurum.ad_en||found.kurum.ad:found.kurum.ad):null;
export const personOg=(found:Found,lang:Lang)=>`/og/person/${found.id}.png?v=${version(found.revision)}${lang==='en'?'&lang=en':''}`;
export async function personMetadata(lang:Lang,param:string):Promise<Metadata>{
 const found=await load(param);if(!found)return {title:lang==='tr'?'Profil bulunamadı':'Profile not found',robots:{index:false,follow:true}};
 const institution=found.kurum?{name:institutionName(found,lang)!,outside:found.kurum.aybu_disi}:null;
 return pageMetadata({lang,title:profileTitle(found.ad,unitName(found,lang),institution),description:profileDescription({lang,name:found.ad,title:displayTitle(found.unvan,lang),unit:unitName(found,lang),institution,fields:distinctAreas(found.alanlar).map(a=>areaName(a,lang))}),pair:found.yol,indexable:indexable(found),ogImage:personOg(found,lang),ogAlt:found.ad,type:'profile'});
}
export async function PersonView({lang,param}:{lang:Lang;param:string}){
 const t=copy[lang],p=paths[lang],other:Lang=lang==='tr'?'en':'tr';
 const found=await load(param);if(!found)notFound();if(`/${lang}/a/${param}`!==found.yol[lang])permanentRedirect(found.yol[lang]);
 const id=found.id,base=baseUrl(),url=base+found.yol[lang],unit=unitName(found,lang),en=lang==='en';
 const interests=distinctAreas(found.interests||[]),interestNames=new Set(interests.flatMap(a=>[a.ad_tr,a.ad_en].filter(Boolean).map(n=>n!.normalize('NFKC').toLocaleLowerCase('tr').trim())));
 const fields=distinctAreas(found.alanlar).filter(a=>!interests.some(i=>i.id===a.id)&&![a.ad_tr,a.ad_en].filter(Boolean).some(n=>interestNames.has(n!.normalize('NFKC').toLocaleLowerCase('tr').trim())));
 const pubsPromise=personPublications(id).catch(()=>null);
 const [circle,pubs,fingerprint]=await Promise.all([ring(id),pubsPromise,personFieldEvidence(id,fields,pubsPromise.then(data=>data?groupCounts(data.counts,lang).total:0))]);
 const institution=found.kurum?{name:institutionName(found,lang)!,ror:found.kurum.ror,university:!found.kurum.aybu_disi||/üniversite|university|universit/i.test(found.kurum.ad)}:null;
 const structured=jsonLd(profilePage({base,url,lang,name:found.ad,jobTitle:displayTitle(found.unvan,lang),institution,unit,knowsAbout:[...fields.map(a=>areaName(a,lang)),...(pubs?.topics||[]).map(a=>areaName(a,lang))],publicationCount:pubs?groupCounts(pubs.counts,lang).total:0,works:pubs?workNodes(pubs.recent,url+'#person'):[],sameAs:[found.avesis_url,found.orcid?'https://orcid.org/'+found.orcid:null],dateModified:found.revision?new Date(found.revision).toISOString():null,crumbs:[{name:'Yarenler',url:`${base}/${lang}`},{name:t.explore,url:`${base}/${lang}/${p.explore}`},{name:found.ad,url}]}));
 const tagLang=(a:{ad_en:string|null})=>en&&!a.ad_en?'tr':undefined;
 return <SiteShell lang={lang} otherPath={found.yol[other].slice(3)}><section className="profile-page"><JsonLd json={structured}/><div className="profile-copy"><Link href={`/${lang}/${p.explore}`} className="text-link">← {t.back}</Link><p className="eyebrow">{displayTitle(found.unvan,lang)||t.profile}</p><h1>{found.ad}</h1>{profileLink(found)&&<p className="profile-source-link"><a href={profileLink(found)!} target="_blank" rel="noopener noreferrer">{found.avesis_url?(en?'View AVESİS profile':'AVESİS profilini aç'):(en?'View ORCID record':'ORCID kaydını aç')}</a></p>}{found.kurum&&<p className="profile-unit">{institutionName(found,lang)}</p>}{found.birim&&unit&&<p className="profile-unit"><Link href={unitPath(found.birim.slug,lang)} lang={en&&!found.birim.ad_en?'tr':undefined}>{unit}</Link></p>}{fields.length>0&&<h2 className="label-heading">{fieldHeading(lang,fields.length)}</h2>}<ProfileFingerprint items={fingerprint} lang={lang}/>{interests.length>0&&<><h2 className="label-heading">{en?'Collaboration interests':'Ortak çalışmak istediğim alanlar'}</h2><div className="tags large-tags">{interests.map(a=><Link key={a.id} href={areaPath(a,lang)} lang={tagLang(a)}>{areaName(a,lang)}</Link>)}</div></>}{pubs&&<Publications lang={lang} pubs={pubs}/>}<p className="claim-profile"><Link className="button" href={`/${lang}/${p.login}`}>{en?'Edit your profile with ORCID':'ORCID ile profilini düzenle'}</Link></p></div><UniversityNetwork lang={lang} initialId={id}/>{circle&&circle.halka.length>0&&<section className="profile-matches"><h2>{en?'Potential collaborators':'Potansiyel yarenler'}</h2><ul>{circle.halka.filter(m=>!m.affinity.mevcut_isbirligi).map(m=><ProfileMatch key={m.kisi.id} match={m} lang={lang}/>)}</ul>{circle.halka.some(m=>m.affinity.mevcut_isbirligi)&&<details className="existing-collaborators"><summary>{en?'Researchers with shared publications':'Ortak yayınınız bulunan araştırmacılar'}</summary><p className="source-note">{en?'Shown separately to make new collaboration opportunities easier to find. Shared publication records are not independent authorship verification.':'Yeni işbirliği fırsatlarını öne çıkarmak için ayrı gösterilir. Ortak yayın kayıtları bağımsız yazarlık doğrulaması değildir.'}</p><ul>{circle.halka.filter(m=>m.affinity.mevcut_isbirligi).map(m=><ProfileMatch key={m.kisi.id} match={m} lang={lang}/>)}</ul></details>}</section>}</section></SiteShell>;
}
/** Profile heading by count: "Çalışma alanı" / "Çalışma alanları", "Research field(s)". */
function fieldHeading(lang:Lang,count:number){return lang==='tr'?(count===1?'Çalışma alanı':'Çalışma alanları'):(count===1?'Research field':'Research fields');}
/**
 * Publication counts by type, the five most recent works and OpenAlex topics when imported. Source label
 * and date come from the record; nothing is shown for a profile without listed publications.
 */
function Publications({lang,pubs}:{lang:Lang;pubs:PersonPublications}){
 const en=lang==='en',{total,groups}=groupCounts(pubs.counts,lang);if(!total)return null;

 return <section className="profile-publications" aria-labelledby="yayinlar"><h2 className="label-heading" id="yayinlar">{en?'Publications':'Yayınlar'}</h2><dl className="publication-counts"><div><dt>{en?'Total':'Toplam'}</dt><dd>{total.toLocaleString(lang)}</dd></div>{groups.map(g=><div key={g.key}><dt>{g.label}</dt><dd>{g.count.toLocaleString(lang)}</dd></div>)}</dl><h3 className="label-heading">{en?'Recent publications':'Son yayınlar'}</h3><ol className="publication-list">{pubs.recent.map((p,i)=>{const link=publicationLink(p),meta=publicationMeta(p);return <li key={i}>{link?<a href={link.href} target="_blank" rel="noopener noreferrer">{p.baslik}</a>:<span>{p.baslik}</span>}<p>{meta}{link&&<span className="publication-link-kind">{meta?' · ':''}{link.kind} ↗</span>}</p></li>;})}</ol>{pubs.topics.length>0&&<><h3 className="label-heading">{en?'OpenAlex topics':'OpenAlex konuları'}</h3><div className="tags">{pubs.topics.map(a=><Link key={a.id} href={areaPath(a,lang)}>{areaName(a,lang)}</Link>)}</div></>}</section>;
}

function ProfileMatch({match:m,lang}:{match:NonNullable<Awaited<ReturnType<typeof ring>>>['halka'][number];lang:Lang}){const weak=Boolean(m.affinity.zayif_eslesme);return <li><Link href={m.kisi.yol[lang]}>{m.kisi.ad}</Link><span className="match-band" title={weak?undefined:bandTitle(m.affinity.sicaklik,lang)}>{profileBand(weak,bandLabel(m.affinity.sicaklik,lang),lang)}</span><p>{m.affinity.gerekceler.map(g=>lang==='en'?g.metin_en||g.metin:g.metin).join(' · ')}</p>{Boolean(m.affinity.ortak_yayin)&&<p className="shared-publications">{sharedPublicationLabel(m.affinity.ortak_yayin!,lang)}</p>}</li>;}
