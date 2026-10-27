/* Pure helpers for ORCID self-registration. No imports: unit tests load this file directly. */
export type PersonName={given:string|null;family:string|null;display:string};
export type Employment={name:string;city:string|null;country:string|null;ror:string|null;department:string|null;role:string|null;startYear:string|null;putCode:string|null};
export type InstitutionChoice={key:string;name:string;country:string|null;ror:string|null;openalexId:string|null;origin:'orcid'|'openalex';detail:string|null};
export type OpenAlexInstitution={id?:unknown;ror?:unknown;display_name?:unknown;country_code?:unknown};
export type DuplicateRow={id:string;name:string;orcid:string|null;resolutionOrcid:string|null;institutionRor:string|null;institutionOpenalex:string|null;institutionName:string|null;institutionNameEn:string|null};
export type Duplicate={personId:string;reason:'avesis_orcid'|'ad_kurum'};
export type TopicLabel={label:string;external:string|null;weight:number};
export type AreaMatch={label:string;id:string;ad:string};

const text=(value:unknown,max=300)=>typeof value==='string'&&value.trim()?value.trim().replace(/\s+/g,' ').slice(0,max):null;
const valueOf=(node:unknown)=>text((node as {value?:unknown}|null|undefined)?.value);

/** Turkish aware fold used only for comparing names; token order does not matter. */
export function foldName(value:string){return value.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(Boolean).sort().join(' ');}

/** ORCID iD checksum (ISO 7064 11,2). */
export function validOrcid(value:string){if(!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value))return false;const digits=value.replace(/-/g,'');let total=0;for(const ch of digits.slice(0,15))total=(total+Number(ch))*2;const result=(12-total%11)%11;return digits[15]===(result===10?'X':String(result));}

/** Name from the public ORCID /person record; falls back to the name in the authenticated token response. */
export function parseOrcidPerson(json:unknown,fallback:string|null):PersonName|null{const name=(json as {name?:Record<string,unknown>}|null)?.name||null;const given=name?valueOf(name['given-names']):null,family=name?valueOf(name['family-name']):null,credit=name?valueOf(name['credit-name']):null;const display=credit||[given,family].filter(Boolean).join(' ')||text(fallback,250);return display?{given,family,display}:null;}

export function normalizeRor(value:unknown){const v=text(value);const m=v?.match(/(?:^|ror\.org\/)(0[a-z0-9]{6}[0-9]{2})$/i);return m?m[1].toLowerCase():null;}
export function normalizeOpenAlexId(value:unknown){const v=text(value);const m=v?.match(/(?:^|openalex\.org\/)([IAWT]\d+)$/i);return m?m[1].toUpperCase():null;}

/** Active (no end date) employment summaries from ORCID /employments. */
export function activeEmployments(json:unknown):Employment[]{const groups=(json as {'affiliation-group'?:unknown[]}|null)?.['affiliation-group'];if(!Array.isArray(groups))return [];const out:Employment[]=[],seen=new Set<string>();for(const group of groups){const summaries=(group as {summaries?:unknown[]})?.summaries;if(!Array.isArray(summaries))continue;for(const item of summaries){const s=(item as Record<string,unknown>)?.['employment-summary'] as Record<string,unknown>|undefined;if(!s||s['end-date'])continue;const org=s.organization as Record<string,unknown>|undefined,name=text(org?.name,200);if(!name)continue;const address=org?.address as Record<string,unknown>|undefined,dis=org?.['disambiguated-organization'] as Record<string,unknown>|undefined;const ror=text(dis?.['disambiguation-source'])==='ROR'?normalizeRor(dis?.['disambiguated-organization-identifier']):null;const country=text(address?.country,2);const key=ror||foldName(name)+'|'+(country||'');if(seen.has(key))continue;seen.add(key);const start=s['start-date'] as {year?:unknown}|null|undefined;out.push({name,city:text(address?.city,120),country:country&&/^[A-Z]{2}$/.test(country)?country:null,ror,department:text(s['department-name'],200),role:text(s['role-title'],200),startYear:valueOf(start?.year),putCode:s['put-code']!=null?String(s['put-code']):null});}}return out;}

/** Institution options: ORCID employments first, then OpenAlex (ROR backed) search results, deduplicated by ROR. */
export function institutionChoices(employments:Employment[],openalex:OpenAlexInstitution[],limit=8):InstitutionChoice[]{const out:InstitutionChoice[]=[];for(const e of employments){out.push({key:e.ror?'ror:'+e.ror:'orcid:'+(e.putCode||foldName(e.name)),name:e.name,country:e.country,ror:e.ror,openalexId:null,origin:'orcid',detail:[e.role,e.department,e.city].filter(Boolean).join(', ')||null});}
 for(const item of openalex){const name=text(item.display_name,200),id=normalizeOpenAlexId(item.id);if(!name||!id)continue;const ror=normalizeRor(item.ror);const same=out.find(c=>(ror&&c.ror===ror)||c.openalexId===id);if(same){same.openalexId??=id;same.ror??=ror;continue;}const country=text(item.country_code,2);out.push({key:ror?'ror:'+ror:'oa:'+id,name,country:country&&/^[A-Z]{2}$/i.test(country)?country.toUpperCase():null,ror,openalexId:id,origin:'openalex',detail:null});}
 return out.slice(0,limit);}

/** Self-declared institution text: trimmed, bounded, no markup. */
export function declaredInstitution(value:unknown){const v=text(value,200);if(!v||v.length<2||/[<>]/.test(v))return null;return v;}

function sameInstitution(choice:Pick<InstitutionChoice,'ror'|'openalexId'|'name'>,row:DuplicateRow){if(choice.ror&&row.institutionRor&&choice.ror===normalizeRor(row.institutionRor))return true;if(choice.openalexId&&row.institutionOpenalex&&choice.openalexId===normalizeOpenAlexId(row.institutionOpenalex))return true;const n=foldName(choice.name);return Boolean(n)&&[row.institutionName,row.institutionNameEn].some(x=>x&&foldName(x)===n);}

/**
 * An existing profile that is very likely the same person. An ORCID recorded for the profile
 * (AVESİS or verified resolution) wins; otherwise the same folded name at the same institution.
 * Profiles already tied to another ORCID are never matched.
 */
export function findDuplicate(candidate:{orcid:string;name:string;institutions:Pick<InstitutionChoice,'ror'|'openalexId'|'name'>[]},rows:DuplicateRow[]):Duplicate|null{for(const row of rows)if(row.orcid===candidate.orcid||row.resolutionOrcid===candidate.orcid)return {personId:row.id,reason:'avesis_orcid'};const name=foldName(candidate.name);if(!name)return null;for(const row of rows){if(row.orcid||row.resolutionOrcid)continue;if(foldName(row.name)!==name)continue;if(candidate.institutions.some(c=>sameInstitution(c,row)))return {personId:row.id,reason:'ad_kurum'};}return null;}

/** Topic, subfield and field labels from an OpenAlex author record, weighted by work counts. */
export function topicLabels(author:unknown,limit=40):TopicLabel[]{const topics=(author as {topics?:unknown[]}|null)?.topics;if(!Array.isArray(topics))return [];const map=new Map<string,TopicLabel>();const add=(label:string|null,external:string|null,weight:number)=>{if(!label||!(weight>0))return;const key=label.toLocaleLowerCase('en');const prev=map.get(key);if(prev){prev.weight+=weight;prev.external??=external;}else map.set(key,{label,external,weight});};
 for(const t of topics){const item=t as Record<string,unknown>,count=typeof item.count==='number'&&item.count>0?item.count:1;add(text(item.display_name,200),normalizeOpenAlexId(item.id),count);add(text((item.subfield as Record<string,unknown>|undefined)?.display_name,200),null,count*.5);add(text((item.field as Record<string,unknown>|undefined)?.display_name,200),null,count*.25);}
 return [...map.values()].sort((a,b)=>b.weight-a.weight||a.label.localeCompare(b.label)).slice(0,limit);}

/** Rank catalog matches by label weight; one entry per canonical area. Unmatched labels are dropped, never invented. */
export function rankAreaSuggestions(labels:TopicLabel[],matches:AreaMatch[],limit=15){const weight=new Map(labels.map(l=>[l.label,l.weight]));const best=new Map<string,{id:string;ad:string;weight:number}>();for(const m of matches){const w=weight.get(m.label)||0;const prev=best.get(m.id);if(!prev||w>prev.weight)best.set(m.id,{id:m.id,ad:m.ad,weight:(prev?.weight||0)+w});else prev.weight+=w;}return [...best.values()].sort((a,b)=>b.weight-a.weight||a.ad.localeCompare(b.ad,'tr')).slice(0,limit).map(({id,ad})=>({id,ad}));}

/** API key from a file that may be plain text or RTF. The key itself is never logged. */
export function extractApiKey(content:string){let body=content;if(body.trimStart().startsWith('{\\rtf'))body=body.replace(/\{\\\*[^{}]*\}/g,' ').replace(/\{\\(fonttbl|colortbl|stylesheet)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g,' ').replace(/\\'[0-9a-f]{2}/gi,' ').replace(/\\[a-z]+-?\d* ?/gi,' ').replace(/[{}]/g,' ');const m=body.match(/(?<![A-Za-z0-9_-])([A-Za-z0-9][A-Za-z0-9_-]{15,})(?![A-Za-z0-9_-])/g)||[];return m.find(k=>/\d/.test(k))||null;}

/** Short URL id like the importer's: ten lowercase hex characters. */
export function shortSlug(name:string){return name.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'kurum';}
