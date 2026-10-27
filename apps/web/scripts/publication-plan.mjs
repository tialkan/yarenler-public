// Plans the publication import from AVESİS profile rows (pipeline `avesis-yayinlar`, parser 0.2.0).
// Pure functions, no database: import.mjs writes the result. The same work listed on several
// co-authors' pages becomes one publication; records sharing a DOI, an OpenAlex id or an AVESİS
// publication id are joined. Nothing is invented: missing values stay null.
import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AVESIS_URL=/^https:\/\/avesis\.[a-z0-9.-]+\/yayin\/[0-9a-f-]{36}(\/[^\s?#]*)?$/;
const clean=(value,max)=>{if(typeof value!=='string')return null;const s=value.normalize('NFC').replace(/\s+/g,' ').trim();return s?s.slice(0,max):null;};

/** "https://doi.org/10.1/X" → "10.1/x"; anything that is not a DOI → null. */
export function normalizeDoi(value){
 const s=clean(value,300);if(!s)return null;
 const doi=s.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i,'').toLowerCase();
 return /^10\.\d{4,9}\/\S+$/.test(doi)?doi:null;
}
export function normalizeOpenAlex(value){const s=clean(value,40);return s&&/^W\d{1,12}$/.test(s)?s:null;}
export function normalizeYear(value){return Number.isInteger(value)&&value>=1900&&value<=2100?value:null;}
const fold=s=>s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

/** One publication summary from a profile row, normalised; null without a title. */
export function normalizePublication(y){
 const baslik=clean(y?.baslik,2000);if(!baslik)return null;
 const avesisId=typeof y.avesis_yayin_id==='string'&&UUID.test(y.avesis_yayin_id.toLowerCase())?y.avesis_yayin_id.toLowerCase():null;
 const url=typeof y.avesis_url==='string'&&AVESIS_URL.test(y.avesis_url)?y.avesis_url:null;
 return {baslik,yil:normalizeYear(y.yil),tur:clean(y.tur,40)||'bilinmeyen',doi:normalizeDoi(y.doi),openalex_id:normalizeOpenAlex(y.openalex_id),kaynak_adi:clean(y.kaynak_adi,300),avesis_yayin_id:avesisId,avesis_url:url};
}

const richness=r=>(r.kaynak_adi?4:0)+(r.yil?2:0)+(r.avesis_url?1:0)+(r.tur!=='bilinmeyen'?1:0)+(r.doi?1:0)+(r.openalex_id?1:0);

/**
 * entries: [{personId, publications:[pipeline YayinOzeti, ...]}] in source order.
 * Returns {publications:[{anahtar,...fields}], links:[{personId,anahtar,sira}], skipped}.
 */
export function planPublications(entries){
 const records=[];let skipped=0;
 for(const {personId,publications} of entries)(publications||[]).forEach((y,sira)=>{const r=normalizePublication(y);if(!r){skipped++;return;}records.push({...r,personId,sira});});
 // Union-find over shared identifiers.
 const parent=records.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const owner=new Map();
 records.forEach((r,i)=>{for(const id of [r.doi&&'d:'+r.doi,r.openalex_id&&'w:'+r.openalex_id,r.avesis_yayin_id&&'a:'+r.avesis_yayin_id]){if(!id)continue;if(owner.has(id)){const a=find(owner.get(id)),b=find(i);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);}else owner.set(id,i);}});
 const clusters=new Map();
 records.forEach((r,i)=>{const hasId=r.doi||r.openalex_id||r.avesis_yayin_id;const key=hasId?'c'+find(i):'t'+r.personId+'|'+fold(r.baslik)+'|'+(r.yil||'');if(!clusters.has(key))clusters.set(key,[]);clusters.get(key).push(r);});
 const publications=[],links=new Map();
 for(const [key,members] of clusters){
  const min=list=>list.filter(Boolean).sort()[0]||null;
  const doi=min(members.map(m=>m.doi)),w=min(members.map(m=>m.openalex_id)),avesis=min(members.map(m=>m.avesis_yayin_id));
  const anahtar=doi?'doi:'+doi:w?'openalex:'+w:avesis?'avesis:'+avesis:'baslik:'+createHash('sha256').update(key).digest('hex').slice(0,32);
  const best=[...members].sort((a,b)=>richness(b)-richness(a)||String(a.avesis_yayin_id||'').localeCompare(String(b.avesis_yayin_id||''))||a.baslik.localeCompare(b.baslik))[0];
  const linked=best.avesis_url?best:members.find(m=>m.avesis_url)||best;
  publications.push({anahtar,baslik:best.baslik,yil:best.yil,tur:best.tur,doi,openalex_id:w,kaynak_adi:best.kaynak_adi,avesis_yayin_id:linked.avesis_yayin_id||avesis,avesis_url:linked.avesis_url||null});
  for(const m of members){const k=m.personId+'|'+anahtar,prev=links.get(k);if(!prev||m.sira<prev.sira)links.set(k,{personId:m.personId,anahtar,sira:m.sira});}
 }
 return {publications,links:[...links.values()],skipped};
}

/** Newest source read time in the input (ISO string) or null. */
export function newestSourceDate(rows){let best=null;for(const r of rows){const d=sourceDate(r);if(d&&(!best||d>best))best=d;}return best?best.toISOString():null;}
/** A row's source read time as a Date, or null when missing or not a real timestamp. */
export function sourceDate(row){const s=row?.kaynak_tarihi;if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(s))return null;const d=new Date(s);return Number.isNaN(d.getTime())?null:d;}
