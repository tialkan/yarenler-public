import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

test('restricted authentication role can register an independent researcher and use the institution catalog', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
 const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
 try{
  await client.query('BEGIN');await client.query('SET LOCAL ROLE yarenler_auth');
  const query=(name,text,values)=>client.query({name,text,values});
  const orcid='9999-9999-9999-9999';
  await query('reg_session',"INSERT INTO orcid_session(orcid,gorunen_ad,belirtec_ozeti,bitis) VALUES($1::text,$2::text,decode($3::text,'hex'),now()+interval '1 hour')",[orcid,'Test Researcher','ab'.repeat(32)]);
  const person=await query('reg_person',"INSERT INTO person(kisa_kimlik,institution_id,kurum_beyan,ad,soyad,gorunen_ad,unvan,unvan_kaynagi,kaynak,kvkk_onay,kvkk_metin_surumu) VALUES($1::text,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,'kullanici','orcid_kayit',now(),$8::text) RETURNING id",['testreg001',null,'Bağımsız araştırmacı','Test','Researcher','Test Researcher',null,'1.5']);
  const id=person.rows[0].id;
  await query('reg_claim','UPDATE person SET orcid=$1::text,sahiplenildi=true,sahiplenme_tarihi=now(),guncelleme=now() WHERE id=$2::uuid',[orcid,id]);
  await query('reg_evidence','INSERT INTO person_identifier_resolution(person_id,orcid,source_url,evidence) VALUES($1::uuid,$2::text,$3::text,$4::jsonb) ON CONFLICT DO NOTHING',[id,orcid,`https://pub.orcid.org/v3.0/${orcid}/person`,{}]);
  await query('reg_review','INSERT INTO profile_field_review(person_id) VALUES($1::uuid) ON CONFLICT DO NOTHING',[id]);
  await query('reg_session_update','UPDATE orcid_session SET person_id=$1::uuid WHERE orcid=$2::text',[id,orcid]);
  const result=await query('reg_verify','SELECT institution_id,kurum_beyan,aktif FROM person WHERE id=$1::uuid',[id]);
  assert.equal(result.rows[0].institution_id,null);assert.equal(result.rows[0].kurum_beyan,'Bağımsız araştırmacı');assert.equal(result.rows[0].aktif,true);
  const institution=await query('reg_institution',"INSERT INTO institution(kisa_ad,ad,kaynak,kanit) VALUES($1::text,$2::text,'kullanici',jsonb_build_object('denetim','ai','kimlik_dogrulandi',false)) RETURNING id::text",['testinstitution001','Örnek Araştırma Merkezi']);
  const found=await query('reg_institution_find','SELECT id::text FROM institution WHERE yarenler_katla(ad)=yarenler_katla($1::text)', ['Örnek Araştırma Merkezi']);assert.equal(found.rows[0].id,institution.rows[0].id);
 }finally{await client.query('ROLLBACK');await client.end();}
});
