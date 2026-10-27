import 'server-only';
import {readFileSync} from 'node:fs';
import {authDb} from './auth';
import {db} from './db';
import {activeEmployments,extractApiKey,findDuplicate,institutionChoices,parseOrcidPerson,rankAreaSuggestions,topicLabels,type DuplicateRow,type Employment,type InstitutionChoice,type OpenAlexInstitution,type PersonName,type TopicLabel} from './registration';

export const KVKK_VERSION='1.5';
export type RegistrationDraft={v:1;orcid:string;name:PersonName|null;employments:Employment[];choices:InstitutionChoice[];openalexAuthor:string|null;suggestions:{id:string;ad:string}[];duplicate:{personId:string;kisa:string;ad:string;url:string|null;reason:'avesis_orcid'|'ad_kurum'}|null;removed:boolean;notes:string[]};

const agent='Yarenler/0.4 (+https://yarenler.org)';
function orcidApi(){return process.env.ORCID_ENV==='sandbox'?'https://pub.sandbox.orcid.org/v3.0':'https://pub.orcid.org/v3.0';}
async function getJson(url:string):Promise<unknown|null>{const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':agent},signal:AbortSignal.timeout(10000),cache:'no-store'});if(response.status===404)return null;if(!response.ok)throw new Error('Kaynak yanıt vermedi');return response.json();}
function openalexUrl(path:string,params:Record<string,string>){const url=new URL('https://api.openalex.org'+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const file=process.env.OPENALEX_API_KEY_FILE;if(file){try{const key=extractApiKey(readFileSync(file,'utf8'));if(key)url.searchParams.set('api_key',key);}catch{/* key is optional for these reads */}}if(process.env.CONTACT_EMAIL)url.searchParams.set('mailto',process.env.CONTACT_EMAIL);return url.toString();}

/** Catalog lookup only (no AI): exact, folded, canonical key and synonym matches. */
async function matchCatalog(labels:TopicLabel[]){if(!labels.length)return [];const {rows}=await db().query(`SELECT l.label,k.id::text id,yarenler_alan_temiz(coalesce(k.ad_tr,k.ad_en)) ad FROM unnest($1::text[],$2::text[]) AS l(label,ext) CROSS JOIN LATERAL (SELECT a.id,a.kanonik_id FROM research_area a WHERE (l.ext IS NOT NULL AND a.sema='openalex' AND a.dis_kimlik=l.ext) OR a.normalize_ad=yarenler_katla(l.label) OR EXISTS(SELECT 1 FROM research_area_synonym s WHERE s.area_id=a.id AND s.normalize_ad=yarenler_katla(l.label)) ORDER BY (a.kanonik_id IS NULL) DESC LIMIT 1) a JOIN research_area k ON k.id=coalesce(a.kanonik_id,a.id)`,[labels.map(l=>l.label),labels.map(l=>l.external)]);return rows as {label:string;id:string;ad:string}[];}

async function duplicateRows(orcid:string,name:string){const {rows}=await authDb().query(`SELECT p.id::text id,p.kisa_kimlik,p.gorunen_ad name,p.avesis_url,p.orcid,r.orcid resolution_orcid,i.ror,i.openalex_id,i.ad institution_name,i.ad_en institution_name_en FROM person p LEFT JOIN institution i ON i.id=p.institution_id LEFT JOIN person_identifier_resolution r ON r.person_id=p.id WHERE p.aktif AND p.kaynak='avesis' AND (r.orcid=$1::text OR yarenler_katla(p.gorunen_ad)=yarenler_katla($2::text) OR similarity(yarenler_katla(p.gorunen_ad),yarenler_katla($2::text))>0.6) AND NOT EXISTS(SELECT 1 FROM profil_sahiplenme_talebi t WHERE t.person_id=p.id AND t.orcid=$1::text AND t.durum='reddedildi') LIMIT 25`,[orcid,name]);return rows.map(r=>({row:{id:r.id,name:r.name,orcid:r.orcid,resolutionOrcid:r.resolution_orcid,institutionRor:r.ror,institutionOpenalex:r.openalex_id,institutionName:r.institution_name,institutionNameEn:r.institution_name_en} as DuplicateRow,kisa:r.kisa_kimlik as string,url:r.avesis_url as string|null}));}

/** Existing AVESİS profile that looks like this person; used before and at submit time. */
export async function detectDuplicate(orcid:string,name:string,institutions:Pick<InstitutionChoice,'ror'|'openalexId'|'name'>[]){const candidates=await duplicateRows(orcid,name);const hit=findDuplicate({orcid,name,institutions},candidates.map(c=>c.row));if(!hit)return null;const c=candidates.find(x=>x.row.id===hit.personId)!;return {personId:hit.personId,kisa:c.kisa,ad:c.row.name,url:c.url,reason:hit.reason};}

async function build(orcid:string,fallbackName:string|null):Promise<RegistrationDraft>{const notes:string[]=[];
 const removed=Boolean((await authDb().query('SELECT 1 FROM person WHERE orcid=$1 AND NOT aktif',[orcid])).rowCount);
 let name:PersonName|null=null,employments:Employment[]=[];
 try{const [personJson,employmentJson]=await Promise.all([getJson(`${orcidApi()}/${orcid}/person`),getJson(`${orcidApi()}/${orcid}/employments`)]);name=parseOrcidPerson(personJson,fallbackName);employments=activeEmployments(employmentJson);}catch{notes.push('orcid');name=parseOrcidPerson(null,fallbackName);}
 let openalex:OpenAlexInstitution[]=[];
 if(employments.length){try{const results=await Promise.all(employments.slice(0,3).map(e=>getJson(openalexUrl('/institutions',{search:e.name,'per-page':'3',select:'id,ror,display_name,country_code'}))));openalex=results.flatMap(r=>Array.isArray((r as {results?:unknown[]}|null)?.results)?(r as {results:OpenAlexInstitution[]}).results:[]);}catch{notes.push('openalex-kurum');}}
 const choices=institutionChoices(employments,openalex);
 let openalexAuthor:string|null=null,suggestions:{id:string;ad:string}[]=[];
 try{const author=await getJson(openalexUrl(`/authors/orcid:${orcid}`,{select:'id,orcid,topics'})) as {id?:unknown;orcid?:unknown}|null;
  // Only accept the author record when OpenAlex itself reports the same ORCID.
  if(author&&typeof author.orcid==='string'&&author.orcid.endsWith(orcid)){openalexAuthor=typeof author.id==='string'?author.id.replace('https://openalex.org/',''):null;const labels=topicLabels(author);suggestions=rankAreaSuggestions(labels,await matchCatalog(labels));}else notes.push('openalex-yazar-yok');
 }catch{notes.push('openalex');}
 const duplicate=name?await detectDuplicate(orcid,name.display,choices):null;
 return {v:1,orcid,name,employments,choices,openalexAuthor,suggestions,duplicate,removed,notes};}

/** Cached for a day so a page reload does not hit ORCID and OpenAlex again. */
export async function registrationDraft(orcid:string,fallbackName:string|null,refresh=false):Promise<RegistrationDraft>{if(!refresh){const {rows}=await authDb().query("SELECT veri FROM orcid_kayit_taslagi WHERE orcid=$1 AND olusturma>now()-interval '1 day'",[orcid]);if(rows[0]?.veri?.v===1){const draft=rows[0].veri as RegistrationDraft;draft.removed=Boolean((await authDb().query('SELECT 1 FROM person WHERE orcid=$1 AND NOT aktif',[orcid])).rowCount);return draft;}}
 const draft=await build(orcid,fallbackName);await authDb().query('INSERT INTO orcid_kayit_taslagi(orcid,veri) VALUES($1,$2) ON CONFLICT(orcid) DO UPDATE SET veri=excluded.veri,olusturma=now()',[orcid,draft]);return draft;}
