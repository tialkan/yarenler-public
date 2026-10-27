import {NETWORK_MIN_SCORE} from './score-bands';
import {broad,pairTieBreak} from './research-matching';
export type DiscoveryPerson={id:string;fields:string[];interests:string[];facultyId:string|null;departmentId:string|null;scopes:{id:string;name:string;level:number}[]};
export type ProfileSuggestion={id:string;score:number;reasons:string[];reasonsEn?:string[];weak:boolean;commonPublications:number;reasonType?:'ortak_alan'|'tamamlayici_alan'|'ortak_konu'};
export function rankProfileSuggestions(center:DiscoveryPerson,people:DiscoveryPerson[],scores:{id:string;score:number;reasons:string[]}[],common:Map<string,number>,allowFallback=true):ProfileSuggestion[]{
 const base=scores.filter(x=>x.id!==center.id&&x.score>=NETWORK_MIN_SCORE).map(x=>({...x,weak:false,commonPublications:common.get(x.id)||0}));
 const order=(a:ProfileSuggestion,b:ProfileSuggestion)=>Number(a.commonPublications>0)-Number(b.commonPublications>0)||b.score-a.score||pairTieBreak(center.id,a.id)-pairTieBreak(center.id,b.id);
 base.sort(order);if(!allowFallback||base.length>=6){const fresh=base.filter(x=>!x.commonPublications),known=base.filter(x=>x.commonPublications);const first=fresh.slice(0,known.length?9:12),old=known.slice(0,12-first.length);return [...first,...fresh.slice(first.length,first.length+12-first.length-old.length),...old];}
 const used=new Set(base.map(x=>x.id));const fallback:{priority:number;match:ProfileSuggestion}[]=[];
 for(const other of people){if(other.id===center.id||used.has(other.id))continue;
  const intent=[...new Set([...center.interests.filter(x=>other.fields.includes(x)),...other.interests.filter(x=>center.fields.includes(x))])].filter(x=>!broad(x)).sort();
  const parent=center.scopes.filter(s=>other.scopes.some(o=>o.id===s.id)).sort((a,b)=>b.level-a.level||a.id.localeCompare(b.id))[0];
  const shared=center.fields.filter(x=>other.fields.includes(x)&&!broad(x)).sort();
  let priority=0,reasons:string[]=[],reasonsEn:string[]=[];
  if(intent.length){priority=1;reasons=[`İşbirliği ilgisi ile çalışma alanı örtüşüyor: ${intent.join(' · ')}`];reasonsEn=[`A collaboration interest overlaps a research field: ${intent.join(' · ')}`];}
  else if(parent){priority=2;reasons=[`Yayınların ortak OpenAlex üst alanı: ${parent.name}`];reasonsEn=[`Shared OpenAlex parent field in publications: ${parent.name}`];}
  else if(center.facultyId&&center.departmentId&&other.departmentId&&center.facultyId===other.facultyId&&center.departmentId!==other.departmentId&&shared.length){priority=3;reasons=[`Aynı fakültede farklı bölüm; ortak alan: ${shared.join(' · ')}`];reasonsEn=[`Different departments in the same faculty; shared field: ${shared.join(' · ')}`];}
  if(priority)fallback.push({priority,match:{id:other.id,score:0,reasons,reasonsEn,reasonType:priority===1?'tamamlayici_alan':priority===2?'ortak_konu':'ortak_alan',weak:true,commonPublications:common.get(other.id)||0}});
 }
 fallback.sort((a,b)=>Number(a.match.commonPublications>0)-Number(b.match.commonPublications>0)||a.priority-b.priority||pairTieBreak(center.id,a.match.id)-pairTieBreak(center.id,b.match.id));
 // Evidence, never an arbitrary minimum. Fewer than six is honest when the fallback has no support.
 const result=[...base,...fallback.slice(0,6-base.length).map(x=>x.match)];return result.sort((a,b)=>Number(a.commonPublications>0)-Number(b.commonPublications>0));
}
export function sharedPublicationLabel(count:number,lang:string){return lang==='en'?`${count} shared publication${count===1?'':'s'}`:`${count} ortak yayın`;}
export function profileBand(weak:boolean,normal:string,lang:string){return weak?(lang==='en'?'Weak match':'Zayıf eşleşme'):normal;}
