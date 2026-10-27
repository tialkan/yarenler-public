import {TRDIZIN_RECONCILE_SQL,TRDIZIN_CONFLICT_SQL} from './publication-source-sql.mjs';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
// Node 22.18+/24 strips TypeScript types natively; the same heading-case rule as the web display and 0010.
import {headingCase} from '../src/server/text-case.ts';
import {planPublications,newestSourceDate,sourceDate} from './publication-plan.mjs';
if(!process.env.DATABASE_URL || !process.argv[2])throw new Error('DATABASE_URL ve JSONL dosya yolu gerekli');
const rows=(await readFile(process.argv[2],'utf8')).split('\n').filter(Boolean).map(s=>JSON.parse(s));
const unique=new Map(rows.map(r=>[r.avesis_kullanici,r]));
const orcidCounts=new Map();
for(const r of unique.values())if(r.orcid)orcidCounts.set(r.orcid,(orcidCounts.get(r.orcid)||0)+1);
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const c=await pool.connect();
let people=0,links=0,missingName=0,orcidConflicts=0;const publicationEntries=[];
try {
 await c.query('BEGIN');
 await c.query("SELECT pg_advisory_xact_lock(hashtext('yarenler_import'))");
 // Import run record: the footer's "data updated" date comes from the newest finished run (migration 0013).
 const run=(await c.query(`INSERT INTO veri_aktarimi(kaynak,kaynak_tarihi) VALUES('avesis',$1::timestamptz) RETURNING id`,[newestSourceDate([...unique.values()])])).rows[0].id;
 const institution=(await c.query(`INSERT INTO institution(kisa_ad,ad,ad_en,ulke,ror,openalex_id,avesis_kok) VALUES('aybu','Ankara Yıldırım Beyazıt Üniversitesi','Ankara Yıldırım Beyazıt University','TR','05ryemn72','I4210150808','https://avesis.aybu.edu.tr') ON CONFLICT(kisa_ad) DO UPDATE SET ad=excluded.ad RETURNING id`)).rows[0].id;
 const units=new Map(),areas=new Map();
 for(const r of unique.values()){
  if(!r.ad?.gorunen){missingName++;continue;}
  let parent=null;let unit=null;let path='';
  for(const [key,kind] of [['fakulte','fakulte'],['bolum','bolum'],['anabilim_dali','anabilim_dali']]){
   const name=headingCase(r.birim?.[key]);if(!name)continue;path+='/'+name;
   if(!units.has(path)){
    // Reuse an existing unit whatever the connector case ("Ve"/"ve"), so unit slugs and URLs stay stable.
    const existing=(await c.query('SELECT id FROM unit WHERE institution_id=$1::uuid AND ust_id IS NOT DISTINCT FROM $2::uuid AND tur=$3::text AND yarenler_katla(ad_tr)=yarenler_katla($4::text) ORDER BY olusturma LIMIT 1',[institution,parent,kind,name])).rows[0];
    if(existing){await c.query('UPDATE unit SET ad_tr=$2::text,guncelleme=now() WHERE id=$1::uuid AND ad_tr IS DISTINCT FROM $2::text',[existing.id,name]);units.set(path,existing.id);}
    // New units get a readable, globally unique address ("ad", "ad-2"...); see migration 0011.
    else{const row=await c.query(`INSERT INTO unit(institution_id,ust_id,tur,ad_tr,slug) VALUES($1,$2,$3,$4::text,yarenler_birim_slug_yeni($4::text)) RETURNING id`,[institution,parent,kind,name]);units.set(path,row.rows[0].id);}
   }unit=units.get(path);parent=unit;
  }
  const resolution=(await c.query('SELECT r.orcid FROM person_identifier_resolution r JOIN person p ON p.id=r.person_id WHERE p.institution_id=$1 AND p.avesis_kullanici=$2',[institution,r.avesis_kullanici])).rows[0];
  const orcid=resolution?resolution.orcid:r.orcid && orcidCounts.get(r.orcid)===1?r.orcid:null;
  if(r.orcid&&!orcid)orcidConflicts++;
  const personRow=(await c.query(`INSERT INTO person(kisa_kimlik,institution_id,unit_id,ad,soyad,gorunen_ad,unvan,avesis_kullanici,avesis_url,orcid,kaynak_tarihi) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz) ON CONFLICT(institution_id,avesis_kullanici) DO UPDATE SET unit_id=excluded.unit_id,ad=excluded.ad,soyad=excluded.soyad,gorunen_ad=excluded.gorunen_ad,unvan=CASE WHEN person.unvan_kaynagi='kullanici' THEN person.unvan ELSE excluded.unvan END,avesis_url=excluded.avesis_url,orcid=CASE WHEN person.sahiplenildi THEN person.orcid ELSE excluded.orcid END,kaynak_tarihi=COALESCE(excluded.kaynak_tarihi,person.kaynak_tarihi),guncelleme=CASE WHEN (person.unit_id,person.ad,person.soyad,person.gorunen_ad,person.avesis_url) IS DISTINCT FROM (excluded.unit_id,excluded.ad,excluded.soyad,excluded.gorunen_ad,excluded.avesis_url) OR (person.unvan_kaynagi<>'kullanici' AND person.unvan IS DISTINCT FROM excluded.unvan) OR (NOT person.sahiplenildi AND person.orcid IS DISTINCT FROM excluded.orcid) THEN now() ELSE person.guncelleme END RETURNING id,aktif`,[randomBytes(5).toString('hex'),institution,unit,r.ad.ad||r.ad.gorunen,r.ad.soyad||'',r.ad.gorunen,r.unvan?.metin||null,r.avesis_kullanici,r.avesis_url,orcid,sourceDate(r)?.toISOString()||null])).rows[0];
  const person=personRow.id;
  // Publications of hidden (removed) profiles are not kept; see importPublications.
  publicationEntries.push({personId:person,active:personRow.aktif,publications:r.ikincil?.yayinlar||[]});
  const reviewed=(await c.query('SELECT 1 FROM profile_field_review WHERE person_id=$1',[person])).rowCount;
  if(reviewed){people++;continue;}
  // Only real changes touch the rows, so person.guncelleme and eklenme stay true dates for sitemap lastmod.
  const wanted=[];
  for(const schema of ['avesis','wos','scopus'])for(const label of (r.arastirma_alanlari?.[schema]||[]).map(headingCase)){
   const cacheKey=schema+'|'+label;
   if(!areas.has(cacheKey)){
    const area=(await c.query(`INSERT INTO research_area(ad_tr,normalize_ad,sema,onayli) VALUES($1::text,yarenler_katla($1::text),$2,true) ON CONFLICT(sema,dis_kimlik,normalize_ad) DO UPDATE SET ad_tr=research_area.ad_tr RETURNING id`,[label,schema])).rows[0].id;areas.set(cacheKey,area);
   }
   wanted.push(areas.get(cacheKey));
  }
  let changed=(await c.query("DELETE FROM person_research_area WHERE person_id=$1::uuid AND kaynak='avesis' AND NOT(area_id=ANY($2::uuid[]))",[person,wanted])).rowCount;
  for(const area of wanted){changed+=(await c.query("INSERT INTO person_research_area(person_id,area_id,kaynak) VALUES($1,$2,'avesis') ON CONFLICT DO NOTHING",[person,area])).rowCount;links++;}
  if(changed)await c.query('UPDATE person SET guncelleme=now() WHERE id=$1',[person]);
  people++;
 }
 // Canonical fields, English names from the AVESİS dictionary and field addresses (migrations 0008, 0011).
 const canonical=(await c.query('SELECT yarenler_alan_kanoniklestir() AS n')).rows[0].n;
 const publications=await importPublications(c,publicationEntries);
 const evidence=await syncEvidence(c,publicationEntries.map(e=>e.personId));
 const summary={evidence,input:rows.length,unique:unique.size,duplicates:rows.length-unique.size,people,missingName,orcidConflicts,areaLabels:areas.size,links,canonical,publications};
 await c.query('UPDATE veri_aktarimi SET bitis=clock_timestamp(),ozet=$2::jsonb WHERE id=$1::uuid',[run,JSON.stringify(summary)]);
 await c.query('COMMIT');
 console.log(JSON.stringify(summary));
} catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}

/**
 * AVESİS publication lists → publication + person_publication (migration 0013), set based and idempotent.
 * Only real changes touch rows; people whose list changed get a new guncelleme (sitemap lastmod).
 */
async function importPublications(c,entries){
 const active=entries.filter(e=>e.active),plan=planPublications(active);
 const ids=entries.map(e=>e.personId);
 await c.query(`CREATE TEMP TABLE yayin_kayit(anahtar text PRIMARY KEY,baslik text,yil smallint,tur text,doi text,openalex_id text,kaynak_adi text,avesis_yayin_id uuid,avesis_url text) ON COMMIT DROP`);
 await c.query(`CREATE TEMP TABLE yayin_bag(person_id uuid,anahtar text,sira int,PRIMARY KEY(person_id,anahtar)) ON COMMIT DROP`);
 const col=(list,key)=>list.map(x=>x[key]??null);
 for(let i=0;i<plan.publications.length;i+=5000){const b=plan.publications.slice(i,i+5000);
  await c.query(`INSERT INTO yayin_kayit SELECT * FROM unnest($1::text[],$2::text[],$3::smallint[],$4::text[],$5::text[],$6::text[],$7::text[],$8::uuid[],$9::text[])`,['anahtar','baslik','yil','tur','doi','openalex_id','kaynak_adi','avesis_yayin_id','avesis_url'].map(k=>col(b,k)));}
 for(let i=0;i<plan.links.length;i+=10000){const b=plan.links.slice(i,i+10000);
  await c.query(`INSERT INTO yayin_bag SELECT * FROM unnest($1::uuid[],$2::text[],$3::int[])`,[col(b,'personId'),col(b,'anahtar'),col(b,'sira')]);}
 if((await c.query(TRDIZIN_CONFLICT_SQL)).rows[0].conflicts)throw new Error('Kaynak yayın kimliği çakışması; aktarım durduruldu.');
 for(const sql of TRDIZIN_RECONCILE_SQL)await c.query(sql);
 const changed=new Set();
 // 1. Links that are gone (also every link of a hidden profile).
 for(const r of (await c.query(`DELETE FROM person_publication pp USING publication p WHERE p.id=pp.publication_id AND pp.kaynak='avesis' AND pp.person_id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM yayin_bag b WHERE b.person_id=pp.person_id AND b.anahtar=p.anahtar) RETURNING pp.person_id`,[ids])).rows)changed.add(r.person_id);
 // 2. AVESİS publications nobody lists any more.
 const removed=(await c.query(`DELETE FROM publication p WHERE p.kaynak='avesis' AND NOT EXISTS(SELECT 1 FROM person_publication pp WHERE pp.publication_id=p.id) AND NOT EXISTS(SELECT 1 FROM yayin_kayit k WHERE k.anahtar=p.anahtar) AND NOT EXISTS(SELECT 1 FROM person_publication_choice c WHERE c.publication_id=p.id) AND NOT EXISTS(SELECT 1 FROM trdizin_publication t WHERE t.publication_id=p.id)`)).rowCount;
 // 3. Upsert; a DOI or OpenAlex id already held by another row is left empty instead of failing.
 const upserted=(await c.query(`INSERT INTO publication AS t(anahtar,kaynak,baslik,yil,tur,doi,openalex_id,kaynak_adi,avesis_yayin_id,avesis_url)
  SELECT k.anahtar,'avesis',k.baslik,k.yil,k.tur,CASE WHEN EXISTS(SELECT 1 FROM publication o WHERE o.doi=k.doi AND o.anahtar IS DISTINCT FROM k.anahtar) THEN NULL ELSE k.doi END,CASE WHEN EXISTS(SELECT 1 FROM publication o WHERE o.openalex_id=k.openalex_id AND o.anahtar IS DISTINCT FROM k.anahtar) THEN NULL ELSE k.openalex_id END,k.kaynak_adi,k.avesis_yayin_id,k.avesis_url FROM yayin_kayit k
  ON CONFLICT(anahtar) DO UPDATE SET baslik=excluded.baslik,yil=excluded.yil,tur=excluded.tur,doi=coalesce(excluded.doi,t.doi),openalex_id=coalesce(excluded.openalex_id,t.openalex_id),kaynak_adi=excluded.kaynak_adi,avesis_yayin_id=excluded.avesis_yayin_id,avesis_url=excluded.avesis_url,guncelleme=now()
  WHERE t.kaynak<>'kullanici' AND (t.baslik,t.yil,t.tur,t.doi,t.openalex_id,t.kaynak_adi,t.avesis_yayin_id,t.avesis_url) IS DISTINCT FROM (excluded.baslik,excluded.yil,excluded.tur,coalesce(excluded.doi,t.doi),coalesce(excluded.openalex_id,t.openalex_id),excluded.kaynak_adi,excluded.avesis_yayin_id,excluded.avesis_url)
  RETURNING t.id,(xmax=0) inserted`)).rows;
 const updatedIds=upserted.filter(r=>!r.inserted).map(r=>r.id);
 if(updatedIds.length)for(const r of (await c.query(`SELECT DISTINCT person_id FROM person_publication WHERE publication_id=ANY($1::uuid[])`,[updatedIds])).rows)changed.add(r.person_id);
 // 4. New links and changed list positions.
 for(const r of (await c.query(`INSERT INTO person_publication AS t(person_id,publication_id,kaynak,sira) SELECT b.person_id,p.id,'avesis',b.sira FROM yayin_bag b JOIN publication p ON p.anahtar=b.anahtar ON CONFLICT(person_id,publication_id) DO UPDATE SET sira=excluded.sira WHERE t.sira<>excluded.sira RETURNING t.person_id`)).rows)changed.add(r.person_id);
 if(changed.size)await c.query('UPDATE person SET guncelleme=now() WHERE id=ANY($1::uuid[])',[[...changed]]);
 return {records:plan.publications.length,links:plan.links.length,skipped:plan.skipped,inserted:upserted.filter(r=>r.inserted).length,updated:updatedIds.length,removed,peopleChanged:changed.size};
}

/** Keep the server semantic evidence in sync with the same successful publication transaction. */
async function syncEvidence(c,ids){
 await c.query(`CREATE TEMP TABLE incoming_evidence ON COMMIT DROP AS
  SELECT DISTINCT ON (pp.person_id,encode(sha256(convert_to(pub.baslik,'UTF8')),'hex'))
   pp.person_id,pub.baslik AS title,pub.yil AS year,coalesce(pub.avesis_url,p.avesis_url) AS source_url,
   encode(sha256(convert_to(pub.baslik,'UTF8')),'hex') AS digest
  FROM person_publication pp JOIN publication pub ON pub.id=pp.publication_id JOIN person p ON p.id=pp.person_id
  WHERE pp.person_id=ANY($1::uuid[]) AND pp.kaynak='avesis' AND p.aktif AND length(pub.baslik) BETWEEN 5 AND 2000
   AND coalesce(pub.avesis_url,p.avesis_url) LIKE 'https://avesis.aybu.edu.tr/%'
  ORDER BY pp.person_id,encode(sha256(convert_to(pub.baslik,'UTF8')),'hex'),pub.yil DESC NULLS LAST,pp.sira`,[ids]);
 const removed=(await c.query(`DELETE FROM research_evidence e WHERE e.person_id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM incoming_evidence n WHERE n.person_id=e.person_id AND n.digest=e.digest)`,[ids])).rowCount;
 const updated=(await c.query(`INSERT INTO research_evidence AS e(person_id,title,year,source_url,digest) SELECT person_id,title,year,source_url,digest FROM incoming_evidence
  ON CONFLICT(person_id,digest) DO UPDATE SET title=excluded.title,year=excluded.year,source_url=excluded.source_url
  WHERE (e.title,e.year,e.source_url) IS DISTINCT FROM (excluded.title,excluded.year,excluded.source_url)`)).rowCount;
 return {updated,removed};
}
