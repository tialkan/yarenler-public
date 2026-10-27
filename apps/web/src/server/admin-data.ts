import 'server-only';
import {adminDb} from './admin-auth';
import type {AdminConfig} from './admin-security';

/** Read queries of the panel (yarenler_admin role: SELECT only on these tables). Parameters are cast explicitly. */
export const PAGE=50;
const page=(n:number)=>Math.max(0,(Math.max(1,Math.floor(n)||1)-1)*PAGE);

export type Summary={arastirmaci:number;birim:number;katalog:number;kullanici:number;yonetici:number;onayli_kullanici:number;duyuru:number;
 kullanici_7:number;yonetici_7:number;acik_talep:number;acik_itiraz:number;geciken_itiraz:number;kisitli:number;denetim_24:number;denetim_hata_24:number;ai_24:number;ai_hata_24:number;
 web_ay:number;web_ay_hata:number;ihlal_24:number;aktif_duyuru_yasagi:number;platform_yasagi:number;aktarim_bitis:Date|null;aktarim_kaynak:string|null;aktarim_kaynak_tarihi:Date|null};
export async function summary(config:AdminConfig):Promise<Summary>{
 const {rows}=await adminDb(config).query<Summary>(`SELECT
  (SELECT count(*)::int FROM person WHERE aktif) AS arastirmaci,
  (SELECT count(*)::int FROM unit) AS birim,
  (SELECT count(*)::int FROM research_area WHERE kanonik_id IS NULL AND kaynak='katalog') AS katalog,
  (SELECT count(*)::int FROM research_area WHERE kanonik_id IS NULL AND kaynak='kullanici') AS kullanici,
  (SELECT count(*)::int FROM research_area WHERE kanonik_id IS NULL AND kaynak='yonetici') AS yonetici,
  (SELECT count(*)::int FROM research_area WHERE kanonik_id IS NULL AND kaynak='kullanici' AND onayli) AS onayli_kullanici,
  (SELECT count(*)::int FROM announcement a JOIN person p ON p.id=a.sahip_id AND p.aktif WHERE a.durum='yayinda' AND a.bitis>now()) AS duyuru,
  (SELECT count(*)::int FROM research_area WHERE kaynak='kullanici' AND olusturma>now()-interval '7 days') AS kullanici_7,
  (SELECT count(*)::int FROM research_area WHERE kaynak='yonetici' AND olusturma>now()-interval '7 days') AS yonetici_7,
  (SELECT count(*)::int FROM profil_sahiplenme_talebi WHERE durum='acik') AS acik_talep,
  (SELECT count(*)::int FROM itiraz WHERE durum='acik') AS acik_itiraz,
  (SELECT count(*)::int FROM itiraz WHERE durum='acik' AND olusturma<now()-interval '30 days') AS geciken_itiraz,
  (SELECT count(*)::int FROM kisi_kisitlamasi) AS kisitli,
  (SELECT count(*)::int FROM alan_denetimi WHERE olusturma>now()-interval '24 hours' AND durum<>'birebir') AS denetim_24,
  (SELECT count(*)::int FROM alan_denetimi WHERE olusturma>now()-interval '24 hours' AND hata IS NOT NULL) AS denetim_hata_24,
  (SELECT count(*)::int FROM ai_call_log WHERE olusturma>now()-interval '24 hours') AS ai_24,
  (SELECT count(*)::int FROM ai_call_log WHERE olusturma>now()-interval '24 hours' AND NOT basarili) AS ai_hata_24,
  (SELECT count(*)::int FROM web_arama_kaydi WHERE olusturma>=date_trunc('month',now())) AS web_ay,
  (SELECT count(*)::int FROM web_arama_kaydi WHERE olusturma>=date_trunc('month',now()) AND durum='hata') AS web_ay_hata,
  (SELECT count(*)::int FROM icerik_ihlali WHERE olusturma>now()-interval '24 hours') AS ihlal_24,
  (SELECT count(*)::int FROM duyuru_yasagi WHERE bitis>now()) AS aktif_duyuru_yasagi,
  (SELECT count(*)::int FROM platform_yasagi WHERE bitis IS NULL OR bitis>now()) AS platform_yasagi,
  v.bitis AS aktarim_bitis,v.kaynak AS aktarim_kaynak,v.kaynak_tarihi AS aktarim_kaynak_tarihi
  FROM (SELECT 1) x LEFT JOIN LATERAL (SELECT bitis,kaynak,kaynak_tarihi FROM veri_aktarimi WHERE bitis IS NOT NULL ORDER BY bitis DESC LIMIT 1) v ON true`);
 return rows[0];
}

export type AreaRow={id:string;ad_tr:string|null;ad_en:string|null;slug:string|null;kaynak:string;sema:string;ai_denetim:string|null;onayli:boolean;olusturma:Date;ekleyen:string|null;ekleyen_kimlik:string|null;kisi:number;toplam:number};
// People per canonical field, counted once per query (the matching view is a DISTINCT union).
const COUNTS=`WITH sayim AS (SELECT area_id,count(DISTINCT person_id)::int AS kisi FROM person_matching_area GROUP BY area_id)`;
const AREA_COLUMNS=`a.id,a.ad_tr,a.ad_en,a.slug,a.kaynak,a.sema::text AS sema,a.ai_denetim,a.onayli,a.olusturma,p.gorunen_ad AS ekleyen,p.kisa_kimlik AS ekleyen_kimlik,coalesce(s.kisi,0) AS kisi`;
const AREA_FROM=`research_area a LEFT JOIN person p ON p.id=a.ekleyen_person_id LEFT JOIN sayim s ON s.area_id=a.id`;
export async function recentUserAreas(config:AdminConfig,limit=20){
 return (await adminDb(config).query<AreaRow>(`${COUNTS} SELECT ${AREA_COLUMNS},0 AS toplam FROM ${AREA_FROM} WHERE a.kaynak='kullanici' ORDER BY a.olusturma DESC,a.id LIMIT $1::int`,[limit])).rows;
}
/** kisi: people per field ('0', '1-4', '5+'); tarih: added on or after / before (YYYY-MM-DD, Europe/Istanbul); onay: approval flag. */
export type AreaFilter={kaynak:'kullanici'|'yonetici'|'katalog'|'hepsi';q:string;denetim:''|'denetlendi'|'denetlenmedi';kisi:''|'0'|'1-4'|'5+';onay:''|'onayli'|'onaysiz';baslangic:string;bitis:string;sayfa:number};
export async function listAreas(config:AdminConfig,f:AreaFilter){
 return (await adminDb(config).query<AreaRow>(`${COUNTS} SELECT ${AREA_COLUMNS},count(*) OVER()::int AS toplam
  FROM ${AREA_FROM}
  WHERE a.kanonik_id IS NULL AND ($1::text='hepsi' OR a.kaynak=$1::text)
   AND ($2::text='' OR strpos(yarenler_katla(coalesce(a.ad_tr,'')||' '||coalesce(a.ad_en,'')),yarenler_katla($2::text))>0
        OR EXISTS(SELECT 1 FROM research_area_synonym s WHERE s.area_id=a.id AND strpos(s.normalize_ad,yarenler_katla($2::text))>0))
   AND ($3::text='' OR a.ai_denetim=$3::text)
   AND ($5::text='' OR ($5::text='0' AND coalesce(s.kisi,0)=0) OR ($5::text='1-4' AND coalesce(s.kisi,0) BETWEEN 1 AND 4) OR ($5::text='5+' AND coalesce(s.kisi,0)>=5))
   AND ($6::text='' OR ($6::text='onayli' AND a.onayli) OR ($6::text='onaysiz' AND NOT a.onayli))
   AND ($7::date IS NULL OR a.olusturma>=($7::date::timestamp AT TIME ZONE 'Europe/Istanbul'))
   AND ($8::date IS NULL OR a.olusturma<(($8::date+1)::timestamp AT TIME ZONE 'Europe/Istanbul'))
  ORDER BY CASE WHEN $1::text IN ('katalog','hepsi') THEN NULL ELSE a.olusturma END DESC NULLS LAST,a.ad_tr,a.id
  LIMIT ${PAGE} OFFSET $4::int`,[f.kaynak,f.q,f.denetim,page(f.sayfa),f.kisi,f.onay,f.baslangic||null,f.bitis||null])).rows;
}

export async function areaDetail(config:AdminConfig,id:string){
 const pool=adminDb(config);
 const area=(await pool.query(`SELECT a.id,a.ad_tr,a.ad_en,a.ad_en_kaynak,a.slug,a.kaynak,a.sema::text AS sema,a.ai_denetim,a.onayli,a.kanonik_id,a.yonetici_hedef_id,a.olusturma,a.guncelleme,
  a.normalize_ad,p.gorunen_ad AS ekleyen,p.kisa_kimlik AS ekleyen_kimlik,
  (SELECT count(DISTINCT ma.person_id)::int FROM person_matching_area ma WHERE ma.area_id=coalesce(a.kanonik_id,a.id)) AS kisi,
  (SELECT count(*)::int FROM research_area x WHERE (x.kanonik_id=a.id OR x.yonetici_hedef_id=a.id) AND x.id<>a.id) AS bagli_alan
  FROM research_area a LEFT JOIN person p ON p.id=a.ekleyen_person_id WHERE a.id=$1::uuid`,[id])).rows[0];
 if(!area)return null;
 const [synonyms,members,people,review,aliases]=await Promise.all([
  pool.query<{ad:string;kaynak:string;normalize_ad:string}>('SELECT ad,kaynak,normalize_ad FROM research_area_synonym WHERE area_id=$1::uuid ORDER BY kaynak,ad',[id]),
  pool.query<{id:string;ad_tr:string|null;ad_en:string|null;sema:string;kaynak:string;yonetici:boolean;kisi:number}>(`SELECT x.id,x.ad_tr,x.ad_en,x.sema::text AS sema,x.kaynak,(x.yonetici_hedef_id IS NOT NULL) AS yonetici,
    (SELECT count(*)::int FROM person_research_area pa WHERE pa.area_id=x.id) AS kisi FROM research_area x WHERE x.kanonik_id=$1::uuid ORDER BY x.sema,x.ad_tr`,[id]),
  pool.query<{kisa_kimlik:string;gorunen_ad:string;interest:boolean;aktif:boolean}>(`SELECT p.kisa_kimlik,p.gorunen_ad,bool_and(ma.interest) AS interest,p.aktif FROM person_matching_area ma JOIN person p ON p.id=ma.person_id
    WHERE ma.area_id=$1::uuid GROUP BY p.id ORDER BY p.soyad,p.ad LIMIT 30`,[area.kanonik_id||id]),
  pool.query<{girdi:string;karar:string;durum:string;kisa_gerekce:string|null;model:string|null;kullanildi:Date|null}>('SELECT girdi,karar,durum,kisa_gerekce,model,kullanildi FROM alan_denetimi WHERE sonuc_alan_id=$1::uuid AND yeni_alan ORDER BY kullanildi LIMIT 1',[id]),
  pool.query<{slug:string;olusturma:Date}>('SELECT slug,olusturma FROM research_area_eski_adres WHERE area_id=$1::uuid ORDER BY olusturma DESC',[id]),
 ]);
 return {area,synonyms:synonyms.rows,members:members.rows,people:people.rows,review:review.rows[0]||null,aliases:aliases.rows};
}

/** Merge target candidates: canonical fields by address, id, partial name or trigram similarity. */
export async function mergeCandidates(config:AdminConfig,query:string,exclude:string){
 return (await adminDb(config).query<{id:string;ad_tr:string|null;ad_en:string|null;kaynak:string;slug:string|null;kisi:number}>(`${COUNTS} SELECT a.id,a.ad_tr,a.ad_en,a.kaynak,a.slug,coalesce(s.kisi,0) AS kisi
  FROM research_area a LEFT JOIN sayim s ON s.area_id=a.id WHERE a.kanonik_id IS NULL AND a.id<>$2::uuid
   AND (a.slug=$1::text OR a.id::text=$1::text OR strpos(a.normalize_ad,yarenler_katla($1::text))>0 OR similarity(a.normalize_ad,yarenler_katla($1::text))>0.3)
  ORDER BY (a.slug=$1::text OR a.id::text=$1::text) DESC,similarity(a.normalize_ad,yarenler_katla($1::text)) DESC,a.ad_tr LIMIT 8`,[query,exclude])).rows;
}

export type AnnouncementFilter='yayinda'|'suresi_doldu'|'kaldirildi'|'hepsi';
export type AnnouncementRow={id:string;kisa_kimlik:string;yayin_metni:string;kaynaklar:{url:string;baslik?:string;alan_adi?:string}[]|null;durum:string;yonetici_kaldirdi:boolean;yayin_tarihi:Date;bitis:Date;sure_hafta:number;suresi_var:boolean;gecen_hafta:number;sahip:string;sahip_kimlik:string;sahip_aktif:boolean;toplam:number};
export async function listAnnouncements(config:AdminConfig,filter:AnnouncementFilter,sayfa=1,limit=PAGE){
 return (await adminDb(config).query<AnnouncementRow>(`SELECT a.id,a.kisa_kimlik,a.yayin_metni,a.kaynaklar,a.durum,a.yonetici_kaldirdi,a.yayin_tarihi,a.bitis,a.sure_hafta,
   (a.bitis>now()) AS suresi_var,floor(extract(epoch FROM now()-a.yayin_tarihi)/604800)::int AS gecen_hafta,p.gorunen_ad AS sahip,p.kisa_kimlik AS sahip_kimlik,p.aktif AS sahip_aktif,count(*) OVER()::int AS toplam
  FROM announcement a JOIN person p ON p.id=a.sahip_id
  WHERE $1::text='hepsi' OR ($1::text='yayinda' AND a.durum='yayinda' AND a.bitis>now())
     OR ($1::text='suresi_doldu' AND a.durum<>'kaldirildi' AND a.bitis<=now()) OR ($1::text='kaldirildi' AND a.durum='kaldirildi')
  ORDER BY a.yayin_tarihi DESC,a.id LIMIT $2::int OFFSET $3::int`,[filter,limit,limit===PAGE?page(sayfa):0])).rows;
}

export type PersonFilter='hepsi'|'gizli'|'orcid_kayit'|'kisitli';
export type PersonRow={id:string;kisa_kimlik:string;gorunen_ad:string;unvan:string|null;orcid:string|null;kaynak:string;aktif:boolean;yonetici_gizledi:boolean;sahiplenildi:boolean;olusturma:Date;birim:string|null;alan_ekleme:boolean|null;duyuru:boolean|null;toplam:number};
export async function listPeople(config:AdminConfig,q:string,filter:PersonFilter,sayfa:number){
 return (await adminDb(config).query<PersonRow>(`SELECT p.id,p.kisa_kimlik,p.gorunen_ad,p.unvan,p.orcid,p.kaynak,p.aktif,p.yonetici_gizledi,p.sahiplenildi,p.olusturma,
   coalesce(u.ad_tr,i.ad,p.kurum_beyan) AS birim,k.alan_ekleme,k.duyuru,count(*) OVER()::int AS toplam
  FROM person p LEFT JOIN unit u ON u.id=p.unit_id LEFT JOIN institution i ON i.id=p.institution_id LEFT JOIN kisi_kisitlamasi k ON k.person_id=p.id
  WHERE ($1::text='' OR strpos(yarenler_katla(p.gorunen_ad),yarenler_katla($1::text))>0 OR p.orcid=$1::text OR p.kisa_kimlik=$1::text)
   AND ($2::text='hepsi' OR ($2::text='gizli' AND NOT p.aktif) OR ($2::text='orcid_kayit' AND p.kaynak='orcid_kayit') OR ($2::text='kisitli' AND k.person_id IS NOT NULL))
  ORDER BY CASE WHEN $2::text IN ('orcid_kayit','kisitli','gizli') THEN p.olusturma END DESC NULLS LAST,p.soyad,p.ad,p.id
  LIMIT ${PAGE} OFFSET $3::int`,[q,filter,page(sayfa)])).rows;
}
export async function personDetail(config:AdminConfig,kimlik:string){
 const pool=adminDb(config);
 const person=(await pool.query(`SELECT p.id,p.kisa_kimlik,p.gorunen_ad,p.unvan,p.orcid,p.kaynak,p.aktif,p.yonetici_gizledi,p.sahiplenildi,p.sahiplenme_tarihi,p.kaldirma_tarihi,p.olusturma,p.avesis_url,
   coalesce(u.ad_tr,i.ad,p.kurum_beyan) AS birim,k.alan_ekleme,k.duyuru,k.sebep,k.olusturma AS kisit_tarihi,k.guncelleme AS kisit_guncelleme,
   (SELECT count(*)::int FROM person_matching_area ma WHERE ma.person_id=p.id) AS alan,
   (SELECT count(*)::int FROM research_area r WHERE r.ekleyen_person_id=p.id) AS ekledigi_alan,
   (SELECT count(*)::int FROM announcement a WHERE a.sahip_id=p.id) AS duyuru_sayisi
  FROM person p LEFT JOIN unit u ON u.id=p.unit_id LEFT JOIN institution i ON i.id=p.institution_id LEFT JOIN kisi_kisitlamasi k ON k.person_id=p.id
  WHERE p.kisa_kimlik=$1::text`,[kimlik])).rows[0];
 if(!person)return null;
 const announcements=(await pool.query<{id:string;kisa_kimlik:string;yayin_metni:string;durum:string;bitis:Date;suresi_var:boolean}>('SELECT id,kisa_kimlik,yayin_metni,durum,bitis,(bitis>now()) AS suresi_var FROM announcement WHERE sahip_id=$1::uuid ORDER BY yayin_tarihi DESC LIMIT 20',[person.id])).rows;
 // Migration 0016: violation history and active bans of the person.
 const violations=(await pool.query<{id:string;olusturma:Date;karar:string;kategori:string;gerekce:string;metin:string|null;ip:string|null;user_agent:string|null}>('SELECT id,olusturma,karar,kategori,gerekce,metin,host(ip) AS ip,user_agent FROM icerik_ihlali WHERE person_id=$1::uuid OR ($2::text IS NOT NULL AND orcid=$2::text) ORDER BY olusturma DESC LIMIT 50',[person.id,person.orcid])).rows;
 const ban=(await pool.query<{bitis:Date;neden:string;kategori:string|null;gerekce:string|null}>('SELECT bitis,neden,kategori,gerekce FROM duyuru_yasagi WHERE person_id=$1::uuid AND bitis>now()',[person.id])).rows[0]||null;
 const platform=(await pool.query<{id:string;bitis:Date|null;gerekce:string;profil_gizlendi:boolean;olusturma:Date}>('SELECT id,bitis,gerekce,profil_gizlendi,olusturma FROM platform_yasagi WHERE (person_id=$1::uuid OR ($2::text IS NOT NULL AND orcid=$2::text)) AND (bitis IS NULL OR bitis>now()) ORDER BY olusturma DESC LIMIT 1',[person.id,person.orcid])).rows[0]||null;
 return {person,announcements,violations,ban,platform};
}

export type ClaimFilter='acik'|'onaylandi'|'reddedildi'|'hepsi';
export type ClaimRow={id:string;orcid:string;neden:string;durum:string;olusturma:Date;islenme:Date|null;yonetici_notu:string|null;kisa_kimlik:string;gorunen_ad:string;
 profil_orcid:string|null;sahiplenildi:boolean;aktif:boolean;kaynak:string;birim:string|null;orcid_baska:string|null;toplam:number};
export async function listClaims(config:AdminConfig,filter:ClaimFilter,sayfa=1){
 return (await adminDb(config).query<ClaimRow>(`SELECT t.id,t.orcid,t.neden,t.durum,t.olusturma,t.islenme,t.yonetici_notu,
   p.kisa_kimlik,p.gorunen_ad,p.orcid AS profil_orcid,p.sahiplenildi,p.aktif,p.kaynak,coalesce(u.ad_tr,i.ad,p.kurum_beyan) AS birim,
   (SELECT x.kisa_kimlik FROM person x WHERE x.orcid=t.orcid AND x.id<>p.id LIMIT 1) AS orcid_baska,count(*) OVER()::int AS toplam
  FROM profil_sahiplenme_talebi t JOIN person p ON p.id=t.person_id LEFT JOIN unit u ON u.id=p.unit_id LEFT JOIN institution i ON i.id=p.institution_id
  WHERE $1::text='hepsi' OR t.durum=$1::text
  ORDER BY t.olusturma DESC,t.id LIMIT ${PAGE} OFFSET $2::int`,[filter,page(sayfa)])).rows;
}

export async function listAudit(config:AdminConfig,sayfa:number){
 return (await adminDb(config).query<{id:string;zaman:Date;kullanici:string;islem:string;hedef_tur:string;hedef_id:string|null;hedef_ad:string|null;once:unknown;sonra:unknown;ip_ozeti:string|null;toplam:number}>(`SELECT id::text,zaman,kullanici,islem,hedef_tur,hedef_id,hedef_ad,once,sonra,ip_ozeti,count(*) OVER()::int AS toplam
  FROM yonetici_islem ORDER BY zaman DESC,id DESC LIMIT ${PAGE} OFFSET $1::int`,[page(sayfa)])).rows;
}

// ---------------------------------------------------------------------------
// Violations and bans (migration 0016)
// ---------------------------------------------------------------------------
export type ViolationFilter={karar:''|'ret'|'agir_ihlal';kategori:string;q:string;sayfa:number};
export type ViolationRow={id:string;olusturma:Date;person_id:string|null;kisa_kimlik:string|null;ad:string|null;orcid:string|null;kurum:string|null;karar:string;kategori:string;gerekce:string;metin:string|null;model:string|null;ip:string|null;user_agent:string|null;
 yasak_bitis:Date|null;platform:boolean;toplam:number};
/** Violation records with the person's current ban state; filter by decision, category and name, ORCID or IP. */
export async function listViolations(config:AdminConfig,f:ViolationFilter){
 const {rows}=await adminDb(config).query<ViolationRow>(`SELECT i.id,i.olusturma,i.person_id,p.kisa_kimlik,coalesce(p.gorunen_ad,i.ad) AS ad,i.orcid,i.kurum,i.karar,i.kategori,i.gerekce,i.metin,i.model,host(i.ip) AS ip,i.user_agent,
   (SELECT y.bitis FROM duyuru_yasagi y WHERE y.person_id=i.person_id AND y.bitis>now()) AS yasak_bitis,
   (yarenler_platform_yasagi(i.person_id,i.orcid) IS NOT NULL) AS platform,count(*) OVER()::int AS toplam
  FROM icerik_ihlali i LEFT JOIN person p ON p.id=i.person_id
  WHERE ($1::text='' OR i.karar=$1::text) AND ($2::text='' OR i.kategori=$2::text)
    AND ($3::text='' OR coalesce(p.gorunen_ad,i.ad,'') ILIKE '%'||$3::text||'%' OR i.orcid=$3::text OR host(i.ip)=$3::text OR coalesce(i.kurum,'') ILIKE '%'||$3::text||'%')
  ORDER BY i.olusturma DESC LIMIT $4::int OFFSET $5::int`,[f.karar,f.kategori,f.q,PAGE,page(f.sayfa)]);
 return rows;
}
export type BanRow={person_id:string;kisa_kimlik:string;ad:string;orcid:string|null;kurum:string|null;bitis:Date;neden:string;kategori:string|null;gerekce:string|null;olusturma:Date};
export async function activeBans(config:AdminConfig){
 const {rows}=await adminDb(config).query<BanRow>(`SELECT y.person_id,p.kisa_kimlik,p.gorunen_ad AS ad,p.orcid,coalesce(i.ad,p.kurum_beyan) AS kurum,y.bitis,y.neden,y.kategori,y.gerekce,y.olusturma
  FROM duyuru_yasagi y JOIN person p ON p.id=y.person_id LEFT JOIN institution i ON i.id=p.institution_id WHERE y.bitis>now() ORDER BY y.bitis DESC LIMIT 200`);
 return rows;
}
export type PlatformBanRow={id:string;orcid:string|null;person_id:string|null;kisa_kimlik:string|null;ad:string|null;gerekce:string;bitis:Date|null;profil_gizlendi:boolean;olusturma:Date};
export async function platformBans(config:AdminConfig){
 const {rows}=await adminDb(config).query<PlatformBanRow>(`SELECT b.id,b.orcid,b.person_id,p.kisa_kimlik,coalesce(p.gorunen_ad,b.ad) AS ad,b.gerekce,b.bitis,b.profil_gizlendi,b.olusturma
  FROM platform_yasagi b LEFT JOIN person p ON p.id=b.person_id WHERE b.bitis IS NULL OR b.bitis>now() ORDER BY b.olusturma DESC LIMIT 200`);
 return rows;
}
