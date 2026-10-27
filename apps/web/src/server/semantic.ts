import 'server-only';
import {recommendText} from './network';
import {personPath} from './model';
/** A semantic hit without distinctive lexical evidence must be clearly similar. */
const SEMANTIC_ONLY_MIN=.45;
export type Candidate={id:string;name:string;unit:string|null;url:string;relevance?:number;reasons:{field:string;term:string;kind?:'semantic';sourceUrl?:string}[]};
export async function announcementMatches(text:string,keywords:string[],excludeId:string|null,o:{timeoutMs?:number}={}):Promise<{candidates:Candidate[];semanticUsed:boolean}>{
 const lexical:Candidate[]=await recommendText(keywords,excludeId,text);
 if(!process.env.SEMANTIC_URL)return {candidates:lexical,semanticUsed:false};
 try{
  const response=await fetch(process.env.SEMANTIC_URL+'/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,exclude_id:excludeId}),signal:AbortSignal.timeout(Math.max(1000,Math.min(o.timeoutMs??20000,20000))),cache:'no-store'});
  if(!response.ok)return {candidates:lexical,semanticUsed:false};
  const result=await response.json();const combined=new Map<string,{candidate:Candidate;rank:number}>();
  lexical.forEach((candidate,i)=>combined.set(candidate.id,{candidate,rank:1/(20+i)}));
  for(const [i,item] of result.candidates.entries()){
   const reason={field:item.basis==='publication'?'Yayın başlığı':'Beyan edilmiş çalışma alanı',term:String(item.evidence.title),kind:'semantic' as const,sourceUrl:/^https:\/\/(?:avesis\.[a-z0-9.-]+|doi\.org|openalex\.org)\//.test(String(item.evidence.source_url))?item.evidence.source_url:undefined};
   const old=combined.get(item.id);
   if(!old&&!(Number(item.similarity)>=SEMANTIC_ONLY_MIN))continue;
   if(old){old.rank+=1/(20+i);old.candidate.reasons.push(reason);}
   else combined.set(item.id,{candidate:{id:item.id,name:item.name,unit:item.unit,url:personPath(item.id,item.name),reasons:[reason]},rank:1/(20+i)});
  }
  return {candidates:[...combined.values()].sort((a,b)=>b.rank-a.rank).slice(0,8).map(x=>({...x.candidate,reasons:x.candidate.reasons.slice(0,3)})),semanticUsed:true};
 }catch{return {candidates:lexical,semanticUsed:false};}
}
