import type {Area} from './model';
import type {PublicationRow} from './publications';
export type FingerprintField=Area;
export type EvidenceRow=Pick<PublicationRow,'baslik'|'yil'|'doi'|'openalex_id'|'avesis_url'|'trdizin_id'>&{area_id:string;supported:number;basis?:string};
export function fingerprintRows(fields:FingerprintField[],rows:EvidenceRow[],total:number){
 return fields.map(field=>{const evidence=rows.filter(r=>r.area_id===field.id),count=Math.min(total,Math.max(0,...evidence.map(r=>r.supported)));
  return {field,count,percent:total>0?Math.round(1000*count/total)/10:0,publications:evidence.slice(0,3)};
 }).sort((a,b)=>b.count-a.count||(a.field.ad_tr||a.field.ad_en||'').localeCompare(b.field.ad_tr||b.field.ad_en||'','tr')||a.field.id.localeCompare(b.field.id));
}
export function fieldDeclaration(source:Area['kaynak'],lang:'tr'|'en'){
 if(source==='kullanici')return lang==='tr'?'Profil sahibinin beyanı':'Declared by the profile owner';
 if(source==='avesis')return lang==='tr'?'AVESİS kaydı':'AVESİS record';
 return lang==='tr'?'Kayıtlı çalışma alanı':'Recorded research field';
}
