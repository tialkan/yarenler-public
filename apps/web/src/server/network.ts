import 'server-only';
import {db} from './db';
import {commonPublicationCounts,PROFILE_SCOPE_SQL} from './profile-evidence';
import {rankProfileSuggestions,type ProfileSuggestion} from './profile-discovery';
import {personPath,areaPath} from './model';
import {headingCase} from './text-case';
import {NETWORK_MIN_SCORE} from './score-bands';
import {broad,compare,pairTieBreak,rankTextMatches,tokenStatistics,type TextPerson} from './research-matching';
export type NetworkNode={id:string;name:string;unit:string|null;url:string;fields:string[];interests:string[];group:string};
export type NetworkSummary={fields:{name:string;url:string;count:number}[]};
export type NetworkLink={source:string;target:string;score:number;reasons:string[]};
type Researcher=NetworkNode&{labels:Set<string>;weight:number;faculty:string|null;facultyId:string|null;departmentId:string|null;unitId:string|null};
let cached:{at:number;people:Researcher[];weights:Map<string,number>;display:Map<string,string>;text?:{people:TextPerson[];idf:Map<string,number>}}|null=null;
async function corpus(){if(cached&&Date.now()-cached.at<300000)return cached;
 const {rows}=await db().query(`SELECT p.kisa_kimlik id,p.gorunen_ad name,p.unit_id::text unit_id,CASE WHEN top.tur='fakulte' THEN top.id WHEN parent.tur='fakulte' THEN parent.id WHEN u.tur='fakulte' THEN u.id END::text faculty_id,CASE WHEN parent.tur='bolum' THEN parent.id WHEN u.tur='bolum' THEN u.id END::text department_id,COALESCE(u.ad_tr,(SELECT i.ad FROM institution i WHERE i.id=p.institution_id AND i.kisa_ad<>'aybu'),p.kurum_beyan) unit,COALESCE(parent.ad_tr,u.ad_tr,(SELECT i.ad FROM institution i WHERE i.id=p.institution_id AND i.kisa_ad<>'aybu'),p.kurum_beyan,'') AS group_name,COALESCE(top.ad_tr,parent.ad_tr,u.ad_tr) AS faculty,COALESCE(jsonb_agg(DISTINCT jsonb_build_object('key',a.id::text,'name',yarenler_alan_temiz(COALESCE(a.ad_tr,a.ad_en)),'broad',EXISTS(SELECT 1 FROM research_area s WHERE coalesce(s.kanonik_id,s.id)=a.id AND COALESCE(s.ad_tr,s.ad_en) ~* '\\((soc|sci|eng|med|life|ahci)\\)'),'interest',pa.interest)) FILTER(WHERE a.id IS NOT NULL),'[]') labels FROM person p LEFT JOIN unit u ON u.id=p.unit_id LEFT JOIN unit parent ON parent.id=u.ust_id LEFT JOIN unit top ON top.id=parent.ust_id LEFT JOIN person_matching_area pa ON pa.person_id=p.id LEFT JOIN research_area a ON a.id=pa.area_id WHERE p.aktif GROUP BY p.id,u.id,parent.id,top.id ORDER BY p.kisa_kimlik`);
 // Display names in heading case ("Ağız, Diş ve Çene Cerrahisi") even if a source capitalised connectors.
 for(const row of rows){row.unit=headingCase(row.unit);row.group_name=headingCase(row.group_name);row.faculty=headingCase(row.faculty);for(const a of row.labels)a.name=headingCase(a.name);}
 const frequency=new Map<string,number>(),display=new Map<string,string>(),broadKeys=new Set<string>();for(const row of rows){for(const key of new Set<string>(row.labels.map((a:{key:string;name:string})=>a.key)))frequency.set(key,(frequency.get(key)||0)+1);for(const a of row.labels){display.set(a.key,a.name);if(a.broad)broadKeys.add(a.key);}}
 const weights=new Map<string,number>();for(const [key,n] of frequency)weights.set(key,(Math.log((rows.length+1)/(n+1))+1)*(broadKeys.has(key)||broad(display.get(key)||'')?.15:1));
 const people:Researcher[]=rows.map(row=>{const labels=new Set<string>(row.labels.map((a:{key:string})=>a.key));return {id:row.id,name:row.name,unit:row.unit,url:personPath(row.id,row.name),group:row.group_name,faculty:row.faculty,facultyId:row.faculty_id,departmentId:row.department_id,unitId:row.unit_id,fields:[...new Set<string>(row.labels.filter((a:{interest:boolean})=>!a.interest).map((a:{name:string})=>a.name))],interests:[...new Set<string>(row.labels.filter((a:{interest:boolean})=>a.interest).map((a:{name:string})=>a.name))],labels,weight:[...labels].reduce((sum,key)=>sum+weights.get(key)!,0)};});cached={at:Date.now(),people,weights,display};return cached;
}
function comparePeople(a:Researcher,b:Researcher,weights:Map<string,number>,display:Map<string,string>){const match=compare(a,b,weights,display);return match?{...match,reasons:match.reasons.map(reason=>a.interests.includes(reason)||b.interests.includes(reason)?reason+' (işbirliği ilgisi)':reason)}:null;}
let graphCache:{at:number;result:{nodes:NetworkNode[];links:NetworkLink[];method:string}}|null=null;
export function invalidateNetwork(){cached=null;graphCache=null;scopeCache=null;profileCache.clear();}
export async function network(){if(graphCache&&Date.now()-graphCache.at<300000)return graphCache.result;const data=await corpus(),links=new Map<string,NetworkLink>();for(const a of data.people){const best=data.people.filter(b=>b.id!==a.id).map(b=>({b,match:comparePeople(a,b,data.weights,data.display)})).filter(x=>x.match&&x.match.score>=NETWORK_MIN_SCORE).sort((x,y)=>y.match!.score-x.match!.score||pairTieBreak(a.id,x.b.id)-pairTieBreak(a.id,y.b.id)).slice(0,4);for(const {b,match} of best){const pair=[a.id,b.id].sort().join(':');if(!links.has(pair))links.set(pair,{source:a.id,target:b.id,score:match!.score,reasons:match!.reasons.map(reason=>a.interests.includes(reason)||b.interests.includes(reason)?reason+' (işbirliği ilgisi)':reason)});}}
 const result={nodes:data.people.map(({id,name,unit,url,fields,interests,group})=>({id,name,unit,url,fields,interests,group})),links:[...links.values()],method:'idf-overlap-jaccard-v2-intent'};graphCache={at:Date.now(),result};return result;
}
export async function weightedMatches(id:string){const data=await corpus(),center=data.people.find(p=>p.id===id);if(!center)return null;return data.people.filter(p=>p.id!==id).map(p=>({id:p.id,...comparePeople(center,p,data.weights,data.display)})).filter(p=>p.score!==undefined).sort((a,b)=>(b.score||0)-(a.score||0)||pairTieBreak(id,a.id)-pairTieBreak(id,b.id)).slice(0,8);}
/** Field proximity scores (0-100) between one researcher and the given ones; missing when they share no field. */
export async function proximityScores(centerId:string,ids:string[]){const data=await corpus(),center=data.people.find(p=>p.id===centerId),out=new Map<string,number>();if(!center)return out;const wanted=new Set(ids);for(const p of data.people)if(p.id!==centerId&&wanted.has(p.id)){const r=comparePeople(center,p,data.weights,data.display);if(r?.score!==undefined)out.set(p.id,r.score);}return out;}
export async function recommendText(keywords:string[],excludeId:string|null,text=''){const data=await corpus();if(!data.text){const people=data.people.map(p=>({id:p.id,labels:[...p.labels].map(key=>data.display.get(key)!),interests:p.interests,faculty:p.faculty}));data.text={people,idf:tokenStatistics(people)};}const byId=new Map(data.people.map(p=>[p.id,p]));return rankTextMatches(data.text.people,text?[...keywords,text]:keywords,data.text.idf,{excludeId,text,limit:8}).map(match=>{const p=byId.get(match.id)!;return {id:p.id,name:p.name,unit:p.unit,url:p.url,relevance:Math.round(match.score*100)/100,reasons:match.reasons.map(r=>({field:r.field,term:r.term}))};});}

/** Server-rendered field links remain available without JavaScript; no researcher popularity ranking. */
export async function networkSummary(lang:'tr'|'en',limit=20):Promise<NetworkSummary>{
 const {rows}=await db().query(`SELECT a.id,a.slug,yarenler_alan_temiz(a.ad_tr) ad_tr,yarenler_alan_temiz(a.ad_en) ad_en,count(DISTINCT pa.person_id)::int people FROM research_area a JOIN person_matching_area pa ON pa.area_id=a.id AND NOT pa.interest JOIN person p ON p.id=pa.person_id AND p.aktif GROUP BY a.id ORDER BY people DESC,a.ad_tr LIMIT $1`,[limit]);
 return {fields:rows.map(row=>{const name=headingCase((lang==='en'?row.ad_en||row.ad_tr:row.ad_tr||row.ad_en)||'');return {name,url:areaPath(row,lang),count:row.people};})};
}

/**
 * Potential collaborators for an announcement (field label evidence only, explainable) and the
 * catalogue fields those matches rest on, most frequent first.
 */
export async function announcementInsights(text:string,excludeId:string|null){
 const matches=await recommendText([],excludeId,text),data=await corpus(),byName=new Map<string,string>();
 for(const [key,name] of data.display)if(!byName.has(name))byName.set(name,key);
 const counts=new Map<string,number>();
 for(const m of matches)for(const r of m.reasons){const key=byName.get(r.field.replace(/ \(işbirliği ilgisi\)$/,''));if(key)counts.set(key,(counts.get(key)||0)+1);}
 return {people:matches,fieldIds:[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([key])=>key)};
}

/** Explicit skills are matched against research fields, never an interest-only declaration. */
export async function skillMatches(ids:string[],excludeId:string|null){const data=await corpus();const keys=[...new Set(ids)];return data.people.filter(p=>p.id!==excludeId).map(p=>{const found=keys.filter(k=>p.labels.has(k)&&p.fields.includes(data.display.get(k)||''));return {p,found,weight:found.reduce((n,k)=>n+(data.weights.get(k)||0),0)};}).filter(x=>x.found.length).sort((a,b)=>b.found.length-a.found.length||b.weight-a.weight||pairTieBreak(excludeId||'skill',a.p.id)-pairTieBreak(excludeId||'skill',b.p.id)).slice(0,8).map(({p,found})=>({id:p.id,name:p.name,unit:p.unit,url:p.url,reasons:found.map(k=>({field:data.display.get(k)!,term:data.display.get(k)!}))}));}

let scopeCache:{at:number;items:Map<string,{id:string;name:string;level:number}[]>}|null=null;
let scopePending:Promise<Map<string,{id:string;name:string;level:number}[]>>|null=null;
const profileCache=new Map<string,{at:number;matches:ProfileSuggestion[];common:Map<string,number>}>();
async function profileScopes(){if(scopeCache&&Date.now()-scopeCache.at<300000)return scopeCache.items;
 if(scopePending)return scopePending;
 scopePending=(async()=>{const items=new Map<string,{id:string;name:string;level:number}[]>();
  try{const {rows}=await db().query<{id:string;area_id:string;name:string;level:number}>(PROFILE_SCOPE_SQL);
   for(const r of rows){if(!items.has(r.id))items.set(r.id,[]);items.get(r.id)!.push({id:r.area_id,name:headingCase(r.name)||r.name,level:r.level});}}
  catch(error){console.error('Profil üst alanları geçici olarak kullanılamıyor:',(error as {code?:string}).code||'query_error');}
  scopeCache={at:Date.now(),items};return items;
 })();try{return await scopePending;}finally{scopePending=null;}
}
/** Profile discovery is distinct from the four-edge visual graph; no fabricated weak graph edges. */
export async function profileRecommendations(id:string){const prior=profileCache.get(id);if(prior&&Date.now()-prior.at<300000)return prior;
 const data=await corpus(),center=data.people.find(p=>p.id===id);if(!center)return null;
 const [common,scopes]=await Promise.all([commonPublicationCounts(id),profileScopes()]);
 const people=data.people.map(p=>({...p,scopes:scopes.get(p.id)||[]})),subject=people.find(p=>p.id===id)!;
 const scores=data.people.filter(p=>p.id!==id).flatMap(p=>{const match=comparePeople(center,p,data.weights,data.display);return match?[{id:p.id,...match}]:[];});
 const result={at:Date.now(),matches:rankProfileSuggestions(subject,people,scores,common),common};
 if(profileCache.size>=2000)profileCache.clear();profileCache.set(id,result);return result;
}
export async function profileConnections(id:string){const result=await profileRecommendations(id);if(!result)return null;const data=await corpus(),people=new Map(data.people.map(p=>[p.id,p]));return {id,sharedPublications:Object.fromEntries(result.common),matches:result.matches.map(m=>{const p=people.get(m.id)!;return {...m,name:p.name,url:p.url};})};}

/** Directed recommendation metrics, fixed cap of 12 on both sides; not graph-edge coverage or accuracy. */
export async function profileDiscoveryMetrics(){
 const data=await corpus(),scopes=await profileScopes(),people=data.people.map(p=>({...p,scopes:scopes.get(p.id)||[]}));
 const {rows}=await db().query<{a:string;b:string;count:number}>(`WITH effective AS MATERIALIZED (SELECT e.* FROM person_publication_effective e JOIN person p ON p.id=e.person_id AND p.aktif)
 SELECT pa.kisa_kimlik a,pb.kisa_kimlik b,count(*)::int count FROM effective a JOIN effective b ON b.publication_id=a.publication_id AND a.person_id<b.person_id JOIN person pa ON pa.id=a.person_id JOIN person pb ON pb.id=b.person_id GROUP BY pa.kisa_kimlik,pb.kisa_kimlik`);
 const commons=new Map<string,Map<string,number>>();for(const r of rows)for(const [a,b] of [[r.a,r.b],[r.b,r.a]]){if(!commons.has(a))commons.set(a,new Map());commons.get(a)!.set(b,r.count);}
 const byId=new Map(people.map(p=>[p.id,p]));
 const measure={before:{covered:0,suggestions:0,comparable:0,sameUnit:0},after:{covered:0,suggestions:0,comparable:0,sameUnit:0}};
 for(const center of people){const scores=people.filter(p=>p.id!==center.id).flatMap(p=>{const match=comparePeople(center,p,data.weights,data.display);return match?[{id:p.id,...match}]:[];});
  for(const [key,allowFallback] of [['before',false],['after',true]] as const){const matches=rankProfileSuggestions(center,people,scores,commons.get(center.id)||new Map(),allowFallback),m=measure[key];m.covered+=Number(matches.length>0);m.suggestions+=matches.length;
   for(const match of matches){const other=byId.get(match.id)!;if(center.unitId&&other.unitId){m.comparable++;m.sameUnit+=Number(center.unitId===other.unitId);}}
  }
 }
 return {researchers:people.length,definition:'Directed profile recommendations; threshold >=20; cap 12; identical common-publication grouping; after adds justified fallback only',before:{...measure.before,coverage:measure.before.covered/Math.max(1,people.length),sameUnitRatio:measure.before.comparable?measure.before.sameUnit/measure.before.comparable:null},after:{...measure.after,coverage:measure.after.covered/Math.max(1,people.length),sameUnitRatio:measure.after.comparable?measure.after.sameUnit/measure.after.comparable:null}};
}
