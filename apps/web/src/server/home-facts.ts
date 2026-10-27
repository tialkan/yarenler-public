/**
 * Home page facts: featured fields and the default network focus. Pure, shared with tests.
 */
import {broad} from './research-matching';
import {MIN_INDEXABLE_PEOPLE} from './seo-rules';
/** broad: a merged source label carries a WoS broad category code such as "(Soc)" (the display name drops it). */
export type FieldCount={id:string;slug:string|null;ad_tr:string|null;ad_en:string|null;people:number;broad?:boolean};
export const FEATURED_FIELD_LIMIT=12;
/**
 * Most shared specific fields: broad source categories ("Sağlık Bilimleri", "(Sci)") and thin fields
 * (fewer people than an indexable field page needs) are left out; the same display name counts once.
 * Order: people descending, then Turkish alphabetical order.
 */
export function featuredFields(rows:FieldCount[],limit=FEATURED_FIELD_LIMIT):FieldCount[]{
 const seen=new Set<string>();
 return rows.filter(r=>{const name=(r.ad_tr||r.ad_en||'').trim();if(!name||r.broad||broad(name)||(r.ad_en&&broad(r.ad_en))||r.people<MIN_INDEXABLE_PEOPLE)return false;const key=name.toLocaleLowerCase('tr-TR');if(seen.has(key))return false;seen.add(key);return true;})
  .sort((a,b)=>b.people-a.people||(a.ad_tr||a.ad_en||'').localeCompare(b.ad_tr||b.ad_en||'','tr'))
  .slice(0,limit);
}
export type FocusLink={source:string;target:string;score:number};
/**
 * Default network focus: the most tightly connected small cluster. Among researchers with a readable
 * number of connections (minDegree..maxDegree), pick the one whose direct connections are most linked
 * to each other, then the higher total score, then the id. Deterministic: no randomness, no ranking of people.
 */
export function focusCluster(links:FocusLink[],{minDegree=4,maxDegree=10}:{minDegree?:number;maxDegree?:number}={}){
 const nb=new Map<string,Map<string,number>>();
 const add=(a:string,b:string,s:number)=>{if(!nb.has(a))nb.set(a,new Map());nb.get(a)!.set(b,s);};
 for(const l of links){if(l.source===l.target)continue;add(l.source,l.target,l.score);add(l.target,l.source,l.score);}
 let best:{center:string;members:string[];internal:number;total:number}|null=null;
 for(const [center,map] of nb){
  if(map.size<minDegree||map.size>maxDegree)continue;
  const members=[...map.keys()];let internal=0;
  for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++)if(nb.get(members[i])?.has(members[j]))internal++;
  const total=[...map.values()].reduce((s,v)=>s+v,0);
  if(!best||internal>best.internal||(internal===best.internal&&(total>best.total||(total===best.total&&center<best.center))))best={center,members:members.sort(),internal,total};
 }
 return best;
}
