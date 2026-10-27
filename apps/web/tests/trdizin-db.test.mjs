import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {TRDIZIN_RECONCILE_SQL,TRDIZIN_CONFLICT_SQL} from '../scripts/publication-source-sql.mjs';
const APPLY='SELECT yarenler_trdizin_kaydet($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::smallint,$7::text,$8::jsonb,$9::jsonb) result';

test('TR Dizin restricted PREPARE, deduplication, owner choices and AVESIS refresh interoperability',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const c=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await c.connect();
 try{await c.query('BEGIN');
 const tag='td'+Math.random().toString(36).slice(2,8),orcid='0000-0000-0000-0001';
 const person=(await c.query("INSERT INTO person(kisa_kimlik,ad,soyad,gorunen_ad,orcid,sahiplenildi,sahiplenme_tarihi,kurum_beyan) VALUES($1::text,'TR','Dizin','TR Dizin',$2::text,true,now(),'Test Üniversitesi') RETURNING id",[tag,orcid])).rows[0].id;
 const peer=(await c.query("INSERT INTO person(kisa_kimlik,ad,soyad,gorunen_ad,orcid,kurum_beyan) VALUES($1::text,'TR','Peer','TR Peer','0000-0000-0000-001X','Test Üniversitesi') RETURNING id",[tag+'p'])).rows[0].id;
 const session=(await c.query("INSERT INTO orcid_session(person_id,orcid,gorunen_ad,belirtec_ozeti,bitis) VALUES($1::uuid,$2::text,'TR Dizin',sha256(convert_to($3::text,'UTF8')),now()+interval '1 day') RETURNING id",[person,orcid,tag])).rows[0].id;
 const source=String(Date.now()),baseDoi='10.9999/'+tag;
 async function ingest(id=source,title='Kaynak yayın başlığı',doi=baseDoi,p=person,oc=orcid){
  await c.query('SET LOCAL ROLE yarenler_maintenance');
  const row=(await c.query({name:'trdizin_restricted_apply',text:APPLY,values:[p,oc,'777',id,title,2026,doi,JSON.stringify([title]),JSON.stringify(['Sosyoloji'])]})).rows[0].result;
  await c.query('RESET ROLE');return row;
 }
 let result=await ingest();assert.equal(result.status,'created');const publication=result.publication_id;
 assert.equal((await ingest()).status,'unchanged');
 assert.equal((await c.query('SELECT count(*)::int n FROM publication WHERE id=$1::uuid',[publication])).rows[0].n,1);
 // Owner sees the imported work and can remove/restore it using existing auth actions.
 await c.query('SET LOCAL ROLE yarenler_auth');
 let mine=(await c.query({name:'trdizin_owner_list',text:'SELECT yarenler_yayinlarim($1::uuid) works',values:[session]})).rows[0].works;
 assert.equal(mine.length,1);
 await c.query({name:'trdizin_owner_visibility',text:'SELECT yarenler_yayin_sec($1::uuid,$2::uuid,$3::boolean)',values:[session,publication,false]});
 await c.query('RESET ROLE');
 assert.equal((await ingest()).status,'unchanged');
 assert.equal((await c.query('SELECT count(*)::int n FROM person_publication_effective WHERE person_id=$1::uuid AND publication_id=$2::uuid',[person,publication])).rows[0].n,0);
 // A second source ID for the same DOI neither duplicates the work nor restores visibility.
 assert.equal((await ingest(source+'1')).publication_id,publication);
 assert.equal((await c.query('SELECT count(*)::int n FROM person_publication_effective WHERE person_id=$1::uuid',[person])).rows[0].n,0);
 await c.query('SET LOCAL ROLE yarenler_auth');
 await c.query({name:'trdizin_owner_visibility',text:'SELECT yarenler_yayin_sec($1::uuid,$2::uuid,$3::boolean)',values:[session,publication,true]});
 await c.query('RESET ROLE');
 assert.equal((await c.query('SELECT count(*)::int n FROM person_publication_effective WHERE person_id=$1::uuid',[person])).rows[0].n,1);
 assert.equal((await ingest(source+'2','Başka dilde başlık',baseDoi,peer,'0000-0000-0000-001X')).publication_id,publication);
 // Repeated source metadata cannot overwrite publication title, type, or an owner's manual record.
 await ingest(source,'Güncellenmiş kaynak başlığı');
 assert.equal((await c.query('SELECT baslik FROM publication WHERE id=$1::uuid',[publication])).rows[0].baslik,'Kaynak yayın başlığı');
 assert.equal((await ingest(source+'3','Kaynak yayın başlığı',null)).status,'title_review');
 const manual=(await c.query("SELECT yarenler_yayin_ekle($1::uuid,'Hocanın kendi yayın metni',2026,'kitap','10.9999/'||$2::text,'Yayınevi') id",[session,tag+'manual'])).rows[0].id;
 const linked=await ingest(source+'4','Kaynağın farklı metni','10.9999/'+tag+'manual');assert.equal(linked.publication_id,manual);
 assert.equal((await c.query('SELECT baslik,tur,kaynak FROM publication WHERE id=$1::uuid',[manual])).rows[0].baslik,'Hocanın kendi yayın metni');
 assert.equal((await ingest(source,'Conflict DOI','10.9999/'+tag+'manual')).status,'identifier_conflict');
 assert.equal((await ingest(source,'Wrong identity',baseDoi,person,'0000-0000-0000-001X')).status,'identity_changed');
 // Refresh removes AVESIS source links only; TR Dizin source evidence remains independent.
 await c.query("INSERT INTO person_publication(person_id,publication_id,kaynak,sira) VALUES($1::uuid,$2::uuid,'avesis',0)",[person,publication]);
 await c.query('DELETE FROM person_publication WHERE person_id=$1::uuid',[person]);
 assert.equal((await c.query('SELECT count(*)::int n FROM person_publication_effective WHERE person_id=$1::uuid AND publication_id=$2::uuid',[person,publication])).rows[0].n,1);
 // Later DOI-bearing AVESIS imports reuse the TR Dizin stable publication key.
 await c.query('CREATE TEMP TABLE yayin_kayit(anahtar text PRIMARY KEY,baslik text,yil smallint,tur text,doi text,openalex_id text,kaynak_adi text,avesis_yayin_id uuid,avesis_url text) ON COMMIT DROP');
 await c.query('CREATE TEMP TABLE yayin_bag(person_id uuid,anahtar text,sira int,PRIMARY KEY(person_id,anahtar)) ON COMMIT DROP');
 await c.query("INSERT INTO yayin_kayit(anahtar,baslik,doi) VALUES($1::text,'AVESIS refresh',$2::text)",['doi:'+baseDoi,baseDoi]);
 await c.query('INSERT INTO yayin_bag VALUES($1::uuid,$2::text,0)',[person,'doi:'+baseDoi]);
 assert.equal((await c.query({name:'trdizin_conflict_check',text:TRDIZIN_CONFLICT_SQL,values:[]})).rows[0].conflicts,0);
 for(let i=0;i<TRDIZIN_RECONCILE_SQL.length;i++)await c.query(i===0?TRDIZIN_RECONCILE_SQL[i]:{name:'trdizin_reconcile_'+i,text:TRDIZIN_RECONCILE_SQL[i],values:[]});
 assert.equal((await c.query('SELECT anahtar FROM yayin_kayit')).rows[0].anahtar,'trdizin:'+source);
 assert.equal((await c.query('SELECT anahtar FROM yayin_bag')).rows[0].anahtar,'trdizin:'+source);
 // Runtime role can query the new metadata but cannot mutate publications/choices or ingest.
 await c.query('SET LOCAL ROLE yarenler_web');
 const publicRows=await c.query({name:'trdizin_web_metadata',text:'SELECT source_id FROM trdizin_publication WHERE publication_id=$1::uuid',values:[publication]});assert.equal(publicRows.rows.length,3);
 const permissions=(await c.query("SELECT has_function_privilege(current_user,'yarenler_trdizin_kaydet(uuid,text,text,text,text,smallint,text,jsonb,jsonb)','EXECUTE') ingest,has_table_privilege(current_user,'person_publication_choice','UPDATE') edit")).rows[0];assert.equal(permissions.ingest,false);assert.equal(permissions.edit,false);
 await c.query('RESET ROLE');
 const maint=(await c.query("SELECT has_table_privilege('yarenler_maintenance','publication','UPDATE') write,has_table_privilege('yarenler_maintenance','person_publication_choice','UPDATE') edit")).rows[0];assert.equal(maint.write,false);assert.equal(maint.edit,false);
 }finally{await c.query('ROLLBACK');await c.end();}
});
