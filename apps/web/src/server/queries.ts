import {profileRecommendations} from './network';
import {db} from './db';
import {band,personPath,type Person,type Area,type Match} from './model';
import {headingCase} from './text-case';
import {parseFieldParam,parseUnitParam} from './slug';
import {broad} from './research-matching';
import {announcementPath} from './announcement-text';
const fields=`p.kisa_kimlik id,p.gorunen_ad ad,p.unvan,p.avesis_url,p.orcid,p.sahiplenildi,p.kaynak,p.guncelleme::text revision,
 CASE WHEN p.institution_id IS NOT NULL THEN (SELECT jsonb_build_object('ad',i.ad,'ad_en',i.ad_en,'ror',i.ror,'aybu_disi',i.kisa_ad<>'aybu') FROM institution i WHERE i.id=p.institution_id) WHEN p.kurum_beyan IS NOT NULL THEN jsonb_build_object('ad',p.kurum_beyan,'aybu_disi',true) ELSE NULL END kurum,
 CASE WHEN u.id IS NOT NULL THEN jsonb_build_object('id',u.id,'ad',u.ad_tr,'ad_en',u.ad_en,'slug',u.slug) ELSE NULL END birim,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'slug',a.slug,'ad_tr',yarenler_alan_temiz(a.ad_tr),'ad_en',yarenler_alan_temiz(a.ad_en),'kaynak',(SELECT min(pa.kaynak::text) FROM person_research_area pa JOIN research_area s ON s.id=pa.area_id WHERE pa.person_id=p.id AND coalesce(s.kanonik_id,s.id)=a.id)) ORDER BY a.ad_tr) FROM person_matching_area ma JOIN research_area a ON a.id=ma.area_id WHERE ma.person_id=p.id AND NOT ma.interest),'[]'::jsonb) alanlar,coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'slug',a.slug,'ad_tr',yarenler_alan_temiz(a.ad_tr),'ad_en',yarenler_alan_temiz(a.ad_en)) ORDER BY a.ad_tr) FROM person_matching_area ma JOIN research_area a ON a.id=ma.area_id WHERE ma.person_id=p.id AND ma.interest),'[]'::jsonb) interests`;
const named=(a:Area):Area=>({...a,ad_tr:headingCase(a.ad_tr),ad_en:headingCase(a.ad_en)});
function decorate(p:Person):Person{return {...p,birim:p.birim?{...p.birim,ad:headingCase(p.birim.ad),ad_en:headingCase(p.birim.ad_en||null)}:null,kurum:p.kurum?{...p.kurum,ad:headingCase(p.kurum.ad)}:p.kurum,interests:(p.interests||[]).map(named),yol:{tr:personPath(p.id,p.ad),en:personPath(p.id,p.ad,'en')},alanlar:p.alanlar.map(named)};}
export async function stats(){const {rows}=await db().query(`SELECT (SELECT count(*)::int FROM person WHERE aktif) people,(SELECT count(DISTINCT yarenler_alan_anahtar(coalesce(ad_tr,ad_en)))::int FROM research_area WHERE kanonik_id IS NULL) areas,(SELECT count(*)::int FROM unit WHERE tur='fakulte') faculties`);return rows[0] as {people:number;areas:number;faculties:number};}
export type InstitutionFilter='aybu'|'disi'|null;
/** People search and listings. unitIds: a unit and all its sub-units (field and unit pages). */
export async function people(q='',page=1,perPage=20,areaId?:string,unitIds?:string[],kurum:InstitutionFilter=null){
 const params=[q,areaId||null,unitIds?.length?unitIds:null,kurum];
 const where=`p.aktif AND ($1::text='' OR strpos(yarenler_katla(p.gorunen_ad),yarenler_katla($1))>0 OR similarity(yarenler_katla(p.gorunen_ad),yarenler_katla($1))>0.3 OR EXISTS(SELECT 1 FROM person_matching_area f JOIN research_area a ON a.id=f.area_id WHERE f.person_id=p.id AND (strpos(a.normalize_ad,yarenler_katla($1))>0 OR EXISTS(SELECT 1 FROM research_area_synonym syn WHERE syn.area_id=a.id AND strpos(syn.normalize_ad,yarenler_katla($1))>0)))) AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM person_matching_area af WHERE af.person_id=p.id AND af.area_id=$2::uuid)) AND ($3::uuid[] IS NULL OR p.unit_id=ANY($3::uuid[])) AND ($4::text IS NULL OR ($4='disi')=NOT EXISTS(SELECT 1 FROM institution ki WHERE ki.id=p.institution_id AND ki.kisa_ad='aybu'))`;
 const total=Number((await db().query(`SELECT count(*) FROM person p LEFT JOIN unit u ON u.id=p.unit_id WHERE ${where}`,params)).rows[0].count);
 const result=await db().query(`SELECT ${fields} FROM person p LEFT JOIN unit u ON u.id=p.unit_id WHERE ${where} ORDER BY CASE WHEN $1='' THEN 0 WHEN yarenler_katla(p.gorunen_ad)=yarenler_katla($1) THEN 4 WHEN strpos(yarenler_katla(p.gorunen_ad),yarenler_katla($1))>0 THEN 3 WHEN EXISTS(SELECT 1 FROM person_matching_area ma JOIN research_area a ON a.id=ma.area_id WHERE ma.person_id=p.id AND a.normalize_ad=yarenler_katla($1)) THEN 2 ELSE 1 END DESC,CASE WHEN $1<>'' THEN GREATEST(similarity(yarenler_katla(p.gorunen_ad),yarenler_katla($1)),COALESCE((SELECT max(similarity(a.normalize_ad,yarenler_katla($1))) FROM person_matching_area ma JOIN research_area a ON a.id=ma.area_id WHERE ma.person_id=p.id),0)) ELSE 0 END DESC,p.soyad,p.ad,p.id LIMIT $5 OFFSET $6`,[...params,perPage,(page-1)*perPage]);
 return {items:result.rows.map(decorate),page,per_page:perPage,total};
}
/** First researchers of a field or unit listing, in listing order, for the ItemList structured data. */
export async function listingNames(areaId:string|null,unitIds:string[]|null,limit=50){const {rows}=await db().query(`SELECT p.kisa_kimlik id,p.gorunen_ad ad FROM person p WHERE p.aktif AND ($1::uuid IS NULL OR EXISTS(SELECT 1 FROM person_matching_area af WHERE af.person_id=p.id AND af.area_id=$1::uuid)) AND ($2::uuid[] IS NULL OR p.unit_id=ANY($2::uuid[])) ORDER BY p.soyad,p.ad,p.id LIMIT $3`,[areaId,unitIds?.length?unitIds:null,limit]);return rows.map(r=>({name:String(r.ad),path:personPath(r.id,r.ad)}));}
export async function person(id:string){const {rows}=await db().query(`SELECT ${fields} FROM person p LEFT JOIN unit u ON u.id=p.unit_id WHERE p.kisa_kimlik=$1 AND p.aktif`,[id]);return rows[0]?decorate(rows[0]):null;}
export async function ring(id:string){const center=await person(id);if(!center)return null;const ranked=(await profileRecommendations(id))?.matches||[];const ids=ranked.map(r=>r.id);const {rows}=await db().query(`SELECT ${fields} FROM person p LEFT JOIN unit u ON u.id=p.unit_id WHERE p.kisa_kimlik=ANY($1::text[])`,[ids]);const matches:Match[]=ranked.map(match=>{const row=rows.find(p=>p.id===match.id);return {kisi:decorate(row),affinity:{sicaklik:match.score||0,bant:band(match.score||0),bilesenler:{alan:(match.score||0)/100},gerekceler:(match.reasons||[]).map((label,i)=>({tur:match.reasonType||'ortak_alan',metin:label,metin_en:match.reasonsEn?.[i]})),mevcut_isbirligi:match.commonPublications>0,ortak_yayin:match.commonPublications,zayif_eslesme:match.weak}};});return {merkez:center,halka:matches};}
export async function areas(q='',limit=12){const {rows}=await db().query(`SELECT a.id,a.slug,yarenler_alan_temiz(a.ad_tr) ad_tr,yarenler_alan_temiz(a.ad_en) ad_en,a.sema,a.ust_id,coalesce((SELECT jsonb_agg(s.ad) FROM research_area_synonym s WHERE s.area_id=a.id),'[]'::jsonb) es_anlamlilar,(SELECT count(DISTINCT ma.person_id)::int FROM person_matching_area ma WHERE ma.area_id=a.id AND NOT ma.interest) people FROM research_area a WHERE a.kanonik_id IS NULL AND ($1::text='' OR a.ad_tr=$1 OR a.normalize_ad=yarenler_katla($1) OR EXISTS(SELECT 1 FROM research_area_synonym s WHERE s.area_id=a.id AND s.normalize_ad=yarenler_katla($1)) OR strpos(a.normalize_ad,yarenler_katla($1))>0 OR similarity(a.normalize_ad,yarenler_katla($1))>0.3) ORDER BY CASE WHEN a.ad_tr=$1 THEN 0 WHEN a.normalize_ad=yarenler_katla($1) THEN 1 WHEN EXISTS(SELECT 1 FROM research_area_synonym s WHERE s.area_id=a.id AND s.normalize_ad=yarenler_katla($1)) THEN 2 ELSE 3 END,people DESC,a.ad_tr LIMIT $2`,[q,limit]);return rows.map(named);}
export type FieldRecord={id:string;slug:string|null;ad_tr:string|null;ad_en:string|null;sema:string;schemes:string[];updated:string|null};
/**
 * Resolves a /alan/{param} address: the stored slug, a slug that moved to another canonical row, the
 * legacy "{uuid}-{name}" form, a merged (non-canonical) field or an address the panel renamed or merged
 * (research_area_eski_adres, migration 0014). Always returns the canonical field;
 * the caller redirects when its slug differs from the request.
 */
export async function findArea(param:string):Promise<FieldRecord|null>{
 const parsed=parseFieldParam(param);if(parsed.kind==='invalid')return null;
 const {rows}=await db().query(`SELECT k.id,k.slug,yarenler_alan_temiz(k.ad_tr) ad_tr,yarenler_alan_temiz(k.ad_en) ad_en,k.sema,(SELECT array_agg(DISTINCT s.sema::text) FROM research_area s WHERE s.id=k.id OR s.kanonik_id=k.id) schemes,k.guncelleme::text updated FROM ${parsed.kind==='legacy'?'(SELECT $1::uuid AS id,0 AS sira) m':'(SELECT x.id,0 AS sira FROM research_area x WHERE x.slug=$1::text UNION ALL SELECT e.area_id,1 FROM research_area_eski_adres e WHERE e.slug=$1::text) m'} JOIN research_area a ON a.id=m.id JOIN research_area k ON k.id=coalesce(a.kanonik_id,a.id) ORDER BY m.sira LIMIT 1`,[parsed.kind==='legacy'?parsed.id:parsed.slug]);
 const a=rows[0];return a?{...a,ad_tr:headingCase(a.ad_tr as string|null),ad_en:headingCase(a.ad_en as string|null),schemes:(a.schemes||[]) as string[]} as FieldRecord:null;
}
export type UnitRecord={id:string;slug:string;ad_tr:string;ad_en:string|null;tur:string;ancestors:{id:string;slug:string;ad_tr:string;ad_en:string|null}[];children:{id:string;slug:string;ad_tr:string;ad_en:string|null;people:number}[];subtree:string[];updated:string|null};
/** Unit by its slug or its address before migration 0011 (unit.eski_slug), with ancestors, children and sub-tree ids. */
export async function findUnit(param:string):Promise<UnitRecord|null>{
 const parsed=parseUnitParam(param);if(parsed.kind==='invalid')return null;
 const unit=(await db().query('SELECT id,slug,ad_tr,ad_en,tur,guncelleme::text updated FROM unit WHERE slug=$1 OR eski_slug=$1 ORDER BY (slug=$1) DESC LIMIT 1',[parsed.slug])).rows[0];if(!unit)return null;
 const [ancestors,subtree,children]=await Promise.all([
  db().query(`WITH RECURSIVE up AS (SELECT u.id,u.ust_id,u.slug,u.ad_tr,u.ad_en,0 depth FROM unit u WHERE u.id=(SELECT ust_id FROM unit WHERE id=$1) UNION ALL SELECT p.id,p.ust_id,p.slug,p.ad_tr,p.ad_en,up.depth+1 FROM unit p JOIN up ON p.id=up.ust_id WHERE up.depth<8) SELECT id,slug,ad_tr,ad_en FROM up ORDER BY depth DESC`,[unit.id]),
  db().query(`WITH RECURSIVE down AS (SELECT id,0 depth FROM unit WHERE id=$1 UNION ALL SELECT c.id,down.depth+1 FROM unit c JOIN down ON c.ust_id=down.id WHERE down.depth<8) SELECT id FROM down`,[unit.id]),
  db().query(`SELECT c.id,c.slug,c.ad_tr,c.ad_en,(WITH RECURSIVE down AS (SELECT c.id id,0 depth UNION ALL SELECT x.id,down.depth+1 FROM unit x JOIN down ON x.ust_id=down.id WHERE down.depth<8) SELECT count(*)::int FROM person p WHERE p.aktif AND p.unit_id IN (SELECT id FROM down)) people FROM unit c WHERE c.ust_id=$1 ORDER BY c.ad_tr`,[unit.id]),
 ]);
 const h=<T extends {ad_tr:string;ad_en:string|null}>(v:T):T=>({...v,ad_tr:headingCase(v.ad_tr)!,ad_en:headingCase(v.ad_en)});
 return {...unit,ad_tr:headingCase(unit.ad_tr)!,ad_en:headingCase(unit.ad_en),ancestors:ancestors.rows.map(h),children:children.rows.map(h).filter(c=>c.people>0),subtree:subtree.rows.map(r=>r.id)};
}
export async function announcements(page=1,perPage=20){const {rows}=await db().query(`SELECT a.id,a.kisa_kimlik,a.yayin_metni,a.kaynaklar,a.bitis,a.sure_hafta,a.yayin_tarihi,p.gorunen_ad ad,p.avesis_url FROM announcement a JOIN person p ON p.id=a.sahip_id AND p.aktif WHERE a.durum='yayinda' AND a.bitis>now() ORDER BY a.yayin_tarihi DESC LIMIT $1 OFFSET $2`,[perPage,(page-1)*perPage]);return rows.map(r=>({...r,yol:{tr:announcementPath('tr',r.kisa_kimlik,r.yayin_metni),en:announcementPath('en',r.kisa_kimlik,r.yayin_metni)}}));}
export async function announcementCount(){return (await db().query("SELECT count(*)::int AS total FROM announcement a JOIN person p ON p.id=a.sahip_id AND p.aktif WHERE a.durum='yayinda' AND a.bitis>now()")).rows[0].total as number;}

/** Facts for a field page, derived only from stored profile-field relations. */
export async function fieldFacts(areaId:string){const {rows}=await db().query(`SELECT count(DISTINCT p.id)::int people,count(DISTINCT p.unit_id)::int units,(SELECT u.ad_tr FROM person_matching_area ma JOIN person pp ON pp.id=ma.person_id AND pp.aktif JOIN unit u ON u.id=pp.unit_id WHERE ma.area_id=$1 GROUP BY u.id HAVING count(*)>=2 ORDER BY count(*) DESC,u.ad_tr LIMIT 1) top_unit FROM person_matching_area pa JOIN person p ON p.id=pa.person_id AND p.aktif WHERE pa.area_id=$1 AND NOT pa.interest`,[areaId]);const facts=rows[0] as {people:number;units:number;top_unit:string|null};return {...facts,top_unit:headingCase(facts.top_unit)};}
export type LinkedCount={id:string;slug:string|null;ad_tr:string|null;ad_en:string|null;count:number};
/**
 * Field page context: fields most often listed together with this one (by the same researchers,
 * broad catalogue headings excluded) and the units its researchers belong to.
 */
export async function fieldContext(areaId:string){
 const [related,units,listed]=await Promise.all([
  db().query(`SELECT k.id,k.slug,yarenler_alan_temiz(k.ad_tr) ad_tr,yarenler_alan_temiz(k.ad_en) ad_en,count(DISTINCT o.person_id)::int count FROM person_matching_area f JOIN person p ON p.id=f.person_id AND p.aktif JOIN person_matching_area o ON o.person_id=f.person_id AND NOT o.interest AND o.area_id<>f.area_id JOIN research_area k ON k.id=o.area_id WHERE f.area_id=$1 AND NOT f.interest GROUP BY k.id HAVING count(DISTINCT o.person_id)>=2 ORDER BY count DESC,k.ad_tr LIMIT 24`,[areaId]),
  db().query(`SELECT u.id,u.slug,u.ad_tr,u.ad_en,count(DISTINCT p.id)::int count FROM person_matching_area f JOIN person p ON p.id=f.person_id AND p.aktif JOIN unit u ON u.id=p.unit_id WHERE f.area_id=$1 GROUP BY u.id ORDER BY count DESC,u.ad_tr LIMIT 6`,[areaId]),
  db().query(`SELECT count(DISTINCT p.id)::int total,max(greatest(p.guncelleme,coalesce(pa.eklenme,p.guncelleme)))::text updated FROM person_matching_area f JOIN person p ON p.id=f.person_id AND p.aktif LEFT JOIN person_research_area pa ON pa.person_id=p.id WHERE f.area_id=$1`,[areaId]),
 ]);
 const h=(r:LinkedCount)=>({...r,ad_tr:headingCase(r.ad_tr),ad_en:headingCase(r.ad_en)});
 return {related:(related.rows as LinkedCount[]).map(h).filter(r=>!broad(r.ad_tr||r.ad_en||'')).slice(0,8),units:(units.rows as LinkedCount[]).map(h),listed:Number(listed.rows[0]?.total||0),updated:(listed.rows[0]?.updated as string|null)||null};
}
/**
 * Unit page context: researcher count in the sub-tree, the most frequent fields and the units whose
 * researchers share the most fields (inverse document frequency weighted, so broad headings count little).
 */
export async function unitContext(unit:UnitRecord){
 const ids=unit.subtree,exclude=[...ids,...unit.ancestors.map(a=>a.id)];
 const [count,top,related]=await Promise.all([
  db().query(`SELECT count(*)::int total,max(greatest(p.guncelleme,coalesce((SELECT max(pa.eklenme) FROM person_research_area pa WHERE pa.person_id=p.id),p.guncelleme)))::text updated FROM person p WHERE p.aktif AND p.unit_id=ANY($1::uuid[])`,[ids]),
  db().query(`SELECT k.id,k.slug,yarenler_alan_temiz(k.ad_tr) ad_tr,yarenler_alan_temiz(k.ad_en) ad_en,count(DISTINCT p.id)::int count FROM person p JOIN person_matching_area ma ON ma.person_id=p.id AND NOT ma.interest JOIN research_area k ON k.id=ma.area_id WHERE p.aktif AND p.unit_id=ANY($1::uuid[]) GROUP BY k.id ORDER BY count DESC,k.ad_tr LIMIT 15`,[ids]),
  db().query(`WITH df AS (SELECT ma.area_id,count(DISTINCT ma.person_id)::float n FROM person_matching_area ma JOIN person p ON p.id=ma.person_id AND p.aktif WHERE NOT ma.interest GROUP BY 1),
   mine AS (SELECT ma.area_id,count(DISTINCT p.id) n FROM person p JOIN person_matching_area ma ON ma.person_id=p.id AND NOT ma.interest WHERE p.aktif AND p.unit_id=ANY($1::uuid[]) GROUP BY 1),
   other AS (SELECT p.unit_id,ma.area_id,count(DISTINCT p.id) n FROM person p JOIN person_matching_area ma ON ma.person_id=p.id AND NOT ma.interest WHERE p.aktif AND p.unit_id IS NOT NULL AND NOT (p.unit_id=ANY($2::uuid[])) GROUP BY 1,2)
   SELECT u.id,u.slug,u.ad_tr,u.ad_en,count(DISTINCT o.area_id)::int count,sum(mine.n*o.n/df.n) score FROM other o JOIN mine ON mine.area_id=o.area_id JOIN df ON df.area_id=o.area_id JOIN unit u ON u.id=o.unit_id GROUP BY u.id HAVING count(DISTINCT o.area_id)>=2 ORDER BY score DESC,u.ad_tr LIMIT 3`,[ids,exclude]),
 ]);
 const h=(r:LinkedCount)=>({...r,ad_tr:headingCase(r.ad_tr),ad_en:headingCase(r.ad_en)});
 return {people:Number(count.rows[0]?.total||0),updated:(count.rows[0]?.updated as string|null)||null,topFields:(top.rows as LinkedCount[]).map(h).filter(r=>!broad(r.ad_tr||r.ad_en||'')).slice(0,5),related:(related.rows as LinkedCount[]).map(h)};
}

export type AnnouncementRow={id:string;text:string;published:string;ends:string;updated:string;ownerId:string;ownerShort:string;name:string;live:boolean;sources:unknown;skills:{id:string;name:string}[]};
const announcementSelect=`SELECT a.kisa_kimlik id,a.yayin_metni,a.kaynaklar,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',coalesce(r.kanonik_id,r.id),'name',yarenler_alan_temiz(coalesce(r.ad_tr,r.ad_en)))),'[]') FROM announcement_skill s JOIN research_area r ON r.id=s.area_id WHERE s.announcement_id=a.id) skills,a.yayin_tarihi,a.bitis,a.guncelleme,p.id owner_id,p.kisa_kimlik,p.gorunen_ad ad,(a.durum='yayinda' AND a.bitis>now() AND p.aktif) live FROM announcement a JOIN person p ON p.id=a.sahip_id`;
const announcementRow=(r:Record<string,unknown>):AnnouncementRow=>({id:String(r.id),text:String(r.yayin_metni),published:new Date(r.yayin_tarihi as string).toISOString(),ends:new Date(r.bitis as string).toISOString(),updated:new Date(r.guncelleme as string).toISOString(),ownerId:String(r.owner_id),ownerShort:String(r.kisa_kimlik),name:String(r.ad),live:Boolean(r.live),sources:r.kaynaklar??[],skills:(r.skills||[]) as {id:string;name:string}[]});
/** Active announcements, newest first, with the owner's Yarenler profile. */
export async function activeAnnouncements(limit=30){const {rows}=await db().query(`${announcementSelect} WHERE a.durum='yayinda' AND a.bitis>now() AND p.aktif ORDER BY a.yayin_tarihi DESC LIMIT $1`,[limit]);return rows.map(announcementRow).map(a=>({...a,text:a.text,path:personPath(a.ownerShort,a.name)}));}
export async function announcementById(id:string){const {rows}=await db().query(`${announcementSelect} WHERE a.kisa_kimlik=$1`,[id]);return rows[0]?announcementRow(rows[0]):null;}

/** Home page numbers: active researchers, distinct canonical fields on their profiles, units they belong to. */
export async function homeFacts(){const {rows}=await db().query(`SELECT (SELECT count(*)::int FROM person WHERE aktif) researchers,(SELECT count(DISTINCT ma.area_id)::int FROM person_matching_area ma JOIN person p ON p.id=ma.person_id AND p.aktif WHERE NOT ma.interest) fields,(SELECT count(DISTINCT unit_id)::int FROM person WHERE aktif AND unit_id IS NOT NULL) units`);return rows[0] as {researchers:number;fields:number;units:number};}
/** Canonical fields by number of active researchers (expertise only), for the featured field list. */
export async function fieldCounts(limit=80){const {rows}=await db().query(`SELECT a.id,a.slug,yarenler_alan_temiz(a.ad_tr) ad_tr,yarenler_alan_temiz(a.ad_en) ad_en,count(DISTINCT ma.person_id)::int people,EXISTS(SELECT 1 FROM research_area s WHERE coalesce(s.kanonik_id,s.id)=a.id AND COALESCE(s.ad_tr,s.ad_en) ~* '\\((soc|sci|eng|med|life|ahci)\\)') broad FROM person_matching_area ma JOIN person p ON p.id=ma.person_id AND p.aktif JOIN research_area a ON a.id=ma.area_id WHERE NOT ma.interest AND a.kanonik_id IS NULL GROUP BY a.id ORDER BY people DESC,a.ad_tr LIMIT $1`,[limit]);return rows.map(r=>({id:r.id,slug:r.slug??null,ad_tr:headingCase(r.ad_tr),ad_en:headingCase(r.ad_en),people:Number(r.people),broad:Boolean(r.broad)}));}
export type PersonPublications={counts:{tur:string|null;count:number}[];recent:{baslik:string;yil:number|null;tur:string|null;kaynak_adi:string|null;doi:string|null;openalex_id:string|null;avesis_url:string|null;trdizin_id:string|null;sira:number}[];topics:{id:string;slug:string|null;ad_tr:string|null;ad_en:string|null;count:number}[];sourceDate:string|null};
/**
 * Publications listed for a profile (migration 0013): counts by AVESİS type, the five most recent works
 * (year, then source order), OpenAlex topics if any were imported, and when the source was read.
 */
export async function personPublications(id:string):Promise<PersonPublications>{
 const {rows}=await db().query(`WITH k AS (SELECT id,kaynak_tarihi FROM person WHERE kisa_kimlik=$1::text AND aktif),
  w AS (SELECT pub.id,pub.baslik,pub.yil,pub.tur,pub.kaynak_adi,pub.doi,pub.openalex_id,pub.avesis_url,(SELECT min(t.source_id) FROM trdizin_publication t WHERE t.publication_id=pub.id) trdizin_id,pub.konu_alanlari,x.sira FROM k JOIN person_publication_effective x ON x.person_id=k.id JOIN publication pub ON pub.id=x.publication_id)
  SELECT (SELECT coalesce(jsonb_agg(jsonb_build_object('tur',tur,'count',n)),'[]'::jsonb) FROM (SELECT tur,count(*)::int n FROM w GROUP BY tur) t) counts,
   (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.yil DESC NULLS LAST,r.sira),'[]'::jsonb) FROM (SELECT baslik,yil,tur,kaynak_adi,doi,openalex_id,avesis_url,trdizin_id,sira FROM w ORDER BY yil DESC NULLS LAST,sira LIMIT 5) r) recent,
   (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.count DESC,t.ad_tr),'[]'::jsonb) FROM (SELECT a.id,a.slug,yarenler_alan_temiz(a.ad_tr) ad_tr,yarenler_alan_temiz(a.ad_en) ad_en,count(*)::int count FROM w CROSS JOIN LATERAL unnest(w.konu_alanlari) u(area_id) JOIN research_area a ON a.id=u.area_id WHERE a.sema='openalex' GROUP BY a.id ORDER BY count(*) DESC,a.ad_tr LIMIT 5) t) topics,
   (SELECT kaynak_tarihi::text FROM k) source_date`,[id]);
 const r=rows[0]||{};return {counts:r.counts||[],recent:r.recent||[],topics:(r.topics||[]).map((t:{ad_tr:string|null;ad_en:string|null})=>({...t,ad_tr:headingCase(t.ad_tr),ad_en:headingCase(t.ad_en)})),sourceDate:r.source_date||null};
}
