/* eslint-disable @next/next/no-img-element -- ImageResponse uses its own SVG renderer. */
import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {person,findArea,findUnit,fieldFacts,unitContext,announcementById} from '@/server/queries';
import {distinctAreas,areaName} from '@/server/model';
import {broad} from '@/server/research-matching';
import {displayTitle} from '@/server/titles';
import {announcementTitle} from '@/server/announcement-text';
import {remainingLabel} from '@/server/model';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/**
 * Share images, 1200×630: brand colour, Oswald for the name, Lato for the details.
 * /og/person/{id}.png, /og/field/{slug}.png, /og/unit/{slug}.png, /og/announcement/{id}.png (?lang=en)
 * Fonts come from public/fonts (static TTF instances for Satori). Cacheable: the page URL carries ?v=.
 */
let assets:Promise<[Buffer,Buffer,Buffer]>|undefined;
const load=()=>assets??=Promise.all([readFile(join(process.cwd(),'public/fonts/oswald-og.ttf')),readFile(join(process.cwd(),'public/fonts/lato-og.ttf')),readFile(join(process.cwd(),'public/brand/yarenler-logo.svg'))]);
type Card={eyebrow:string;title:string;lines:string[];accent?:string;footer:string};
async function render(card:Card){
 const [heading,body,logo]=await load();const size=card.title.length>60?44:card.title.length>36?52:64;
 return new ImageResponse(<div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',background:'white',padding:'56px 68px',borderBottom:'14px solid #1683A8',fontFamily:'YarenlerShare',color:'#18373e'}}><img src={'data:image/svg+xml;base64,'+logo.toString('base64')} width={260} height={84} alt="Yarenler"/><div style={{display:'flex',marginTop:34,fontSize:24,color:'#1683A8',fontFamily:'YarenlerShareHeading',letterSpacing:1}}>{card.eyebrow.toLocaleUpperCase('tr-TR')}</div><div style={{display:'flex',marginTop:10,fontSize:size,lineHeight:1.12,fontFamily:'YarenlerShareHeading'}}>{card.title}</div>{card.lines.filter(Boolean).map((line,i)=><div key={i} style={{display:'flex',fontSize:25,marginTop:i?6:18,color:'#526d74'}}>{line}</div>)}{card.accent&&<div style={{display:'flex',fontSize:23,marginTop:24,color:'#10677f'}}>{card.accent}</div>}<div style={{display:'flex',fontSize:20,marginTop:'auto',color:'#526d74'}}>{card.footer}</div></div>,{width:1200,height:630,fonts:[{name:'YarenlerShareHeading',data:heading,weight:500,style:'normal'},{name:'YarenlerShare',data:body,weight:400,style:'normal'}],headers:{'Cache-Control':'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400'}});
}
const missing=()=>new Response(null,{status:404,headers:{'Cache-Control':'public, max-age=300'}});
export async function GET(request:Request,{params}:{params:Promise<{kind:string;key:string}>}){
 const {kind,key}=await params,lang=new URL(request.url).searchParams.get('lang')==='en'?'en':'tr',tr=lang==='tr';
 if(!key.endsWith('.png'))return missing();const id=key.slice(0,-4);
 const footer=tr?'Akademik yarenini bul. · yarenler.org':'Find your research partner. · yarenler.org';
 if(kind==='person'){
  if(!/^[0-9a-z]{4,12}$/.test(id))return missing();const p=await person(id);if(!p)return missing();
  const institution=p.kurum?(tr?p.kurum.ad:p.kurum.ad_en||p.kurum.ad):null;
  const unit=p.birim?(tr?p.birim.ad:p.birim.ad_en||p.birim.ad):null;
  const fields=distinctAreas(p.alanlar).filter(a=>!broad(a.ad_tr||a.ad_en||'')).slice(0,3).map(a=>areaName(a,lang));
  return render({eyebrow:displayTitle(p.unvan,lang)||(tr?'Araştırmacı':'Researcher'),title:p.ad,lines:[unit||'',institution||''],accent:fields.join(' · '),footer});
 }
 if(kind==='field'){
  const f=await findArea(id);if(!f||f.slug!==id)return missing();const facts=await fieldFacts(f.id);
  return render({eyebrow:tr?'Çalışma alanı':'Research field',title:areaName(f,lang),lines:[tr?`${facts.people} araştırmacı${facts.units>1?` · ${facts.units} birim`:''}`:`${facts.people} researcher${facts.people===1?'':'s'}${facts.units>1?` · ${facts.units} units`:''}`,facts.top_unit&&facts.units>1?(tr?`En sık: ${facts.top_unit}`:`Most frequent: ${facts.top_unit}`):''],footer});
 }
 if(kind==='unit'){
  const u=await findUnit(id);if(!u||u.slug!==id)return missing();const c=await unitContext(u);
  return render({eyebrow:tr?'Birim':'Unit',title:tr?u.ad_tr:u.ad_en||u.ad_tr,lines:[u.ancestors.map(a=>tr?a.ad_tr:a.ad_en||a.ad_tr).join(' · '),tr?'Ankara Yıldırım Beyazıt Üniversitesi':'Ankara Yıldırım Beyazıt University'],accent:tr?`${c.people} araştırmacı`:`${c.people} researcher${c.people===1?'':'s'}`,footer});
 }
 if(kind==='announcement'){
  if(!/^[0-9a-z]{6,12}$/.test(id))return missing();const a=await announcementById(id);if(!a||!a.live)return missing();
  return render({eyebrow:tr?'İşbirliği duyurusu':'Collaboration announcement',title:announcementTitle(a.text,80),lines:[a.name],accent:remainingLabel(a.ends,lang),footer});
 }
 return missing();
}
