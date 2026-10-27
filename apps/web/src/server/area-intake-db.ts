import 'server-only';
import {db} from './db';
import {authDb,appOrigin} from './auth';
import {headingCase} from './text-case';
import {openRouterKey} from './llm';
import {logServerError} from './action-errors';
import {personPath,areaPath} from './model';
import {AI_TIMEOUT_MS,AREA_AI_MODEL,MAX_CANDIDATES,aiCacheKey,aiCheckAllowed,buildAiMessages,decide,parseAiContent,shortIds,validateAiReview,type AiOutcome,type AreaRef,type Candidate,type Decision} from './area-intake';
/**
 * Database and model calls of the "Alan ekle" flow (rules in area-intake.ts, schema in migration 0012).
 * Reads use the read-only pool; audit rows and the AI budget use the auth pool; the field itself is written
 * only by the SECURITY DEFINER function yarenler_alan_ekle. Every parameter has an explicit cast.
 */
const name=(v:unknown)=>headingCase(typeof v==='string'?v:'')||'';

/** Canonical field whose key equals the name's key (Turkish name, English name or synonym). */
export async function exactArea(text:string):Promise<AreaRef|null>{
 const {rows}=await db().query('SELECT r.id,yarenler_alan_temiz(coalesce(r.ad_tr,r.ad_en)) AS ad,r.slug FROM research_area r WHERE r.id=yarenler_alan_birebir($1::text)',[text]);
 return rows[0]?{id:String(rows[0].id),ad:name(rows[0].ad),slug:rows[0].slug??null}:null;
}

const LEXICAL_SQL=`SELECT k.id,yarenler_alan_temiz(coalesce(k.ad_tr,k.ad_en)) AS ad,yarenler_alan_temiz(k.ad_en) AS ad_en
 FROM (SELECT coalesce(a.kanonik_id,a.id) AS id,
              greatest(similarity(a.normalize_ad,yarenler_katla($1::text)),word_similarity(yarenler_katla($1::text),a.normalize_ad),
                       coalesce(similarity(yarenler_katla(a.ad_en),yarenler_katla($1::text)),0)) AS skor
         FROM research_area a
       UNION ALL
       SELECT coalesce(a.kanonik_id,a.id),greatest(similarity(s.normalize_ad,yarenler_katla($1::text)),word_similarity(yarenler_katla($1::text),s.normalize_ad))
         FROM research_area_synonym s JOIN research_area a ON a.id=s.area_id) m
 JOIN research_area k ON k.id=m.id
 WHERE m.skor>=0.3
 GROUP BY k.id
 ORDER BY max(m.skor) DESC,k.id
 LIMIT $2::int`;
/** Trigram neighbours (pg_trgm) over names, English names and synonyms, mapped to canonical fields. */
export async function lexicalCandidates(text:string):Promise<Candidate[]>{
 const {rows}=await db().query(LEXICAL_SQL,[text,MAX_CANDIDATES]);
 return rows.map(r=>({id:String(r.id),ad:name(r.ad),ad_en:r.ad_en?name(r.ad_en):null}));
}

/**
 * Semantic neighbours from the FastEmbed service on yarenler-01 (infra/semantic, POST /areas/similar).
 * Optional: no SEMANTIC_URL, an older service without the endpoint, a timeout or an error gives [].
 * Names always come from the database, never from the service.
 */
export async function semanticCandidates(text:string):Promise<Candidate[]>{
 const base=process.env.SEMANTIC_URL;if(!base)return [];
 try{
  const response=await fetch(base+'/areas/similar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,limit:MAX_CANDIDATES}),signal:AbortSignal.timeout(2500),cache:'no-store'});
  if(!response.ok)return [];
  const result=await response.json() as {candidates?:{id?:unknown}[]};
  const ids=(result.candidates||[]).map(c=>String(c.id||'')).filter(id=>/^[0-9a-f-]{36}$/.test(id)).slice(0,MAX_CANDIDATES);if(!ids.length)return [];
  const {rows}=await db().query('SELECT r.id,yarenler_alan_temiz(coalesce(r.ad_tr,r.ad_en)) AS ad,yarenler_alan_temiz(r.ad_en) AS ad_en FROM research_area r WHERE r.id=ANY($1::uuid[]) AND r.kanonik_id IS NULL',[ids]);
  const byId=new Map(rows.map(r=>[String(r.id),{id:String(r.id),ad:name(r.ad),ad_en:r.ad_en?name(r.ad_en):null}]));
  return ids.map(id=>byId.get(id)).filter((c):c is Candidate=>Boolean(c));
 }catch{return [];}
}

/** Fields of the given candidates that are already on the person's profile (expertise or interests). */
export async function linkedAreaIds(personId:string,areaIds:string[],hedef:'alan'|'ilgi'):Promise<Set<string>>{
 if(!areaIds.length)return new Set();
 const {rows}=await db().query('SELECT DISTINCT ma.area_id FROM person_matching_area ma WHERE ma.person_id=$1::uuid AND ma.area_id=ANY($2::uuid[]) AND ma.interest=$3::boolean',[personId,areaIds,hedef==='ilgi']);
 return new Set(rows.map(r=>String(r.area_id)));
}

const RESERVE_USD=.005;
async function storedReview(cacheKey:string):Promise<Decision|null>{
 const {rows}=await authDb().query("SELECT karar,duzeltilmis_ad,ad_en,mevcut_alan_id,kisa_gerekce FROM alan_denetimi WHERE onbellek_anahtari=$1::text AND durum='denetlendi' AND olusturma>now()-interval '30 days' ORDER BY olusturma DESC LIMIT 1",[cacheKey]);
 const r=rows[0];if(!r)return null;
 return {karar:r.karar,duzeltilmisAd:r.duzeltilmis_ad,adEn:r.ad_en,mevcutId:r.mevcut_alan_id?String(r.mevcut_alan_id):null,gerekce:r.kisa_gerekce,durum:'denetlendi',hata:null};
}

/**
 * One bounded model call (Claude Haiku 5.5 via OpenRouter) or a stored answer for the same input and
 * candidates. Shares the monthly ceiling (advisory lock, LLM_MONTHLY_BUDGET_USD, at most 5 USD) with
 * announcement assist; at most AI_CHECKS_PER_HOUR checks per person. Never throws for provider problems:
 * they come back as a failure code and the caller continues without AI.
 */
export async function reviewName(text:string,candidates:Candidate[],personId:string):Promise<{decision:Decision;model:string|null;cacheKey:string|null}>{
 const model=AREA_AI_MODEL,cacheKey=aiCacheKey(model,text,candidates.map(c=>c.id));
 const cached=await storedReview(cacheKey);if(cached)return {decision:cached,model,cacheKey};
 const outcome=await callModel(text,candidates,personId,model,cacheKey);
 return {decision:decide(text,candidates,outcome),model:outcome.ok?model:null,cacheKey:outcome.ok?cacheKey:null};
}

async function callModel(text:string,candidates:Candidate[],personId:string,model:string,cacheKey:string):Promise<AiOutcome>{
 const key=openRouterKey();if(!key)return {ok:false,reason:'yapilandirma'};
 const pool=authDb(),client=await pool.connect();let logId:string;
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('yarenler_ai_budget'::text))");
  const configured=Number(process.env.LLM_MONTHLY_BUDGET_USD||5),budget=Number.isFinite(configured)?Math.max(0,Math.min(configured,5)):0;
  const spent=Number((await client.query("SELECT COALESCE(sum(maliyet_usd),0) AS spent FROM ai_call_log WHERE olusturma>=date_trunc('month',now())")).rows[0].spent);
  if(spent+RESERVE_USD>budget){await client.query('ROLLBACK');return {ok:false,reason:'butce'};}
  const calls=Number((await client.query("SELECT count(*) AS n FROM ai_call_log WHERE person_id=$1::uuid AND amac='alan_eslestirme' AND olusturma>now()-interval '1 hour'",[personId])).rows[0].n);
  if(!aiCheckAllowed(calls)){await client.query('ROLLBACK');return {ok:false,reason:'sinir'};}
  logId=String((await client.query("INSERT INTO ai_call_log(amac,saglayici,model,girdi_token,cikti_token,maliyet_usd,person_id,onbellek_anahtari,basarili) VALUES('alan_eslestirme','openrouter',$1::text,0,0,$2::numeric,$3::uuid,$4::text,false) RETURNING id",[model,RESERVE_USD,personId,cacheKey])).rows[0].id);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 let usage:{prompt_tokens?:number;completion_tokens?:number;cost?:number}={};
 try{
  const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':appOrigin(),'X-Title':'Yarenler'},body:JSON.stringify({model,max_tokens:400,temperature:0,response_format:{type:'json_object'},messages:buildAiMessages(text,candidates)}),cache:'no-store',signal:AbortSignal.timeout(AI_TIMEOUT_MS)});
  if(!response.ok){logServerError('area_review_http',new Error(`status ${response.status}`));return {ok:false,reason:'http'};}
  const result=await response.json();usage=result.usage||{};
  let parsed:unknown;try{parsed=parseAiContent(result.choices?.[0]?.message?.content);}catch{logServerError('area_review_schema',new Error('json'));return {ok:false,reason:'sema'};}
  const checked=validateAiReview(parsed,shortIds(candidates));
  if(!checked.ok){logServerError('area_review_schema',new Error(checked.reason));return {ok:false,reason:'sema'};}
  await pool.query('UPDATE ai_call_log SET basarili=true WHERE id=$1::uuid',[logId]);
  return {ok:true,value:checked.value};
 }catch(error){
  const errorName=(error as {name?:string}).name;const timeout=errorName==='TimeoutError'||errorName==='AbortError';
  logServerError(timeout?'area_review_timeout':'area_review_failed',error);
  return {ok:false,reason:timeout?'zaman_asimi':'http'};
 }finally{
  const cost=Number(usage.cost);
  await pool.query('UPDATE ai_call_log SET girdi_token=$1::int,cikti_token=$2::int,maliyet_usd=$3::numeric WHERE id=$4::uuid',[Math.max(0,Number(usage.prompt_tokens)||0),Math.max(0,Number(usage.completion_tokens)||0),Number.isFinite(cost)&&cost>0?cost:RESERVE_USD,logId]).catch(error=>logServerError('area_review_log',error));
 }
}

export type AuditInput={personId:string;girdi:string;hedef:'alan'|'ilgi';durum:'birebir'|'denetlendi'|'denetlenmedi';karar:'yeni'|'mevcut'|'gecersiz';duzeltilmisAd:string|null;adEn:string|null;mevcutId:string|null;gerekce:string|null;adaylar:string[];model:string|null;hata:string|null;cacheKey:string|null};
/** Audit row of one check; the confirm step may only use what is stored here. */
export async function insertAudit(a:AuditInput):Promise<string>{
 const {rows}=await authDb().query(`INSERT INTO alan_denetimi(person_id,girdi,hedef,durum,karar,duzeltilmis_ad,ad_en,mevcut_alan_id,kisa_gerekce,adaylar,model,hata,onbellek_anahtari)
  VALUES($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::uuid,$9::text,$10::uuid[],$11::text,$12::text,$13::text) RETURNING id`,
  [a.personId,a.girdi,a.hedef,a.durum,a.karar,a.duzeltilmisAd,a.adEn,a.mevcutId,a.gerekce,a.adaylar,a.model,a.hata,a.cacheKey]);
 return String(rows[0].id);
}

/** Adds (or reuses) the field and links it to the profile in one transaction (yarenler_alan_ekle). */
export async function linkArea(auditId:string,personId:string,secim:'yeni'|'mevcut',areaId:string|null):Promise<AreaRef&{yeni:boolean}>{
 const {rows}=await authDb().query('SELECT sonuc_id,sonuc_ad,sonuc_slug,sonuc_yeni FROM yarenler_alan_ekle($1::uuid,$2::uuid,$3::text,$4::uuid)',[auditId,personId,secim,areaId]);
 const r=rows[0];return {id:String(r.sonuc_id),ad:name(r.sonuc_ad),slug:r.sonuc_slug??null,yeni:Boolean(r.sonuc_yeni)};
}

/** Public addresses that show the change: the field, the person, the person's unit, home and explore. */
export async function changedPaths(personId:string,area:AreaRef){
 const {rows}=await db().query('SELECT p.kisa_kimlik,p.gorunen_ad,u.slug AS birim FROM person p LEFT JOIN unit u ON u.id=p.unit_id WHERE p.id=$1::uuid',[personId]);
 const p=rows[0],paths=['/tr','/en','/tr/kesfet','/en/explore',areaPath({id:area.id,ad_tr:area.ad,ad_en:null,slug:area.slug},'tr'),areaPath({id:area.id,ad_tr:area.ad,ad_en:null,slug:area.slug},'en')];
 if(p){paths.push(personPath(p.kisa_kimlik,p.gorunen_ad),personPath(p.kisa_kimlik,p.gorunen_ad,'en'));if(p.birim)paths.push(`/tr/birim/${p.birim}`,`/en/unit/${p.birim}`);}
 return paths;
}

/** Asks the semantic service to embed queued fields and people now; otherwise its next run does it. */
export async function requestSemanticRefresh(){
 const base=process.env.SEMANTIC_URL;if(!base)return false;
 try{const response=await fetch(base+'/refresh',{method:'POST',signal:AbortSignal.timeout(3000),cache:'no-store'});return response.ok;}catch{return false;}
}
