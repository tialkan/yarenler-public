/**
 * Daily announcement limit under concurrency, against a real PostgreSQL with migration 0016 (skipped without
 * TEST_DATABASE_URL, a table owner connection used for setup and cleanup). TEST_AUTH_DATABASE_URL, when set, runs
 * the calls as the restricted yarenler_auth role. CI: the db job sets both to the temporary database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const ownerUrl=process.env.TEST_DATABASE_URL,authUrl=process.env.TEST_AUTH_DATABASE_URL||ownerUrl;
const skip=ownerUrl?false:'TEST_DATABASE_URL yok';

test('two simultaneous attempts: exactly one starts, the other gets YA023; two simultaneous inserts: one announcement',{skip},async()=>{
 const owner=new pg.Pool({connectionString:ownerUrl,max:2}),auth=new pg.Pool({connectionString:authUrl,max:6});
 const tag='cicc'+Math.random().toString(36).slice(2,6);
 const inst=(await owner.query("INSERT INTO institution(kisa_ad,ad,ulke) VALUES($1,'Eşzamanlılık Üniversitesi','TR') RETURNING id",[tag])).rows[0].id;
 const people=(await owner.query("INSERT INTO person(kisa_kimlik,institution_id,ad,soyad,gorunen_ad) SELECT $1||g,$2::uuid,'E','Z','E Z' FROM generate_series(1,3) g RETURNING id",[tag.slice(0,9),inst])).rows.map(r=>r.id);
 try{
  // 1) Attempts: run many rounds so the calls really overlap.
  for(const person of people.slice(0,2)){
   const results=await Promise.allSettled(Array.from({length:5},()=>auth.query('SELECT yarenler_duyuru_deneme_baslat($1::uuid) AS id',[person])));
   const ok=results.filter(r=>r.status==='fulfilled'),refused=results.filter(r=>r.status==='rejected');
   assert.equal(ok.length,1,'tam bir deneme başlamalı');
   assert.ok(refused.every(r=>r.reason.code==='YA023'),refused.map(r=>r.reason.code).join(','));
   assert.equal((await owner.query("SELECT count(*)::int n FROM duyuru_denemesi WHERE person_id=$1::uuid AND durum<>'hata'",[person])).rows[0].n,1);
  }
  // An AI failure frees the attempt; then again only one of two simultaneous calls wins.
  const first=(await owner.query("SELECT id FROM duyuru_denemesi WHERE person_id=$1::uuid",[people[0]])).rows[0].id;
  await auth.query("SELECT yarenler_duyuru_denetim_sonucu($1::uuid,$2::uuid,'hata',NULL,NULL,NULL,NULL,NULL,NULL,NULL,7)",[first,people[0]]);
  const again=await Promise.allSettled([1,2].map(()=>auth.query('SELECT yarenler_duyuru_deneme_baslat($1::uuid) AS id',[people[0]])));
  assert.equal(again.filter(r=>r.status==='fulfilled').length,1);
  // After a rejection, concurrent retries still admit only one; three completed attempts exhaust the day.
  for(let round=0;round<2;round++){
   const active=(await owner.query("SELECT id FROM duyuru_denemesi WHERE person_id=$1::uuid AND durum='baslatildi'",[people[0]])).rows[0].id;
   await auth.query("SELECT yarenler_duyuru_denetim_sonucu($1::uuid,$2::uuid,'ret','akademik_degil','Test reddi',NULL,'Test metni','test',NULL,NULL,7)",[active,people[0]]);
   const gate=(await auth.query('SELECT yarenler_duyuru_durumu($1::uuid) AS d',[people[0]])).rows[0].d;
   assert.equal(gate.hak_kullanildi,round===1);
   const next=await Promise.allSettled(Array.from({length:5},()=>auth.query('SELECT yarenler_duyuru_deneme_baslat($1::uuid) AS id',[people[0]])));
   assert.equal(next.filter(r=>r.status==='fulfilled').length,round===1?0:1);
   assert.ok(next.filter(r=>r.status==='rejected').every(r=>r.reason.code==='YA023'));
  }
  // 2) Announcements: two simultaneous inserts for the same person, one wins (duyuru_gunluk_yayin).
  const insert=()=>auth.query("INSERT INTO announcement(sahip_id,ham_metin,yayin_metni,sure_hafta,bitis) VALUES($1::uuid,'Eşzamanlı duyuru metni yirmi karakter','Eşzamanlı duyuru metni yirmi karakter',1,now()+interval '1 week') RETURNING id",[people[2]]);
  const inserts=await Promise.allSettled([insert(),insert(),insert()]);
  assert.equal(inserts.filter(r=>r.status==='fulfilled').length,1,inserts.map(r=>r.reason?.code+' '+r.reason?.message).join(' | '));
  assert.ok(inserts.filter(r=>r.status==='rejected').every(r=>r.reason.code==='YA023'));
 }finally{
  await owner.query('DELETE FROM announcement WHERE sahip_id=ANY($1::uuid[])',[people]);
  await owner.query('DELETE FROM person WHERE id=ANY($1::uuid[])',[people]);
  await owner.query('DELETE FROM institution WHERE id=$1::uuid',[inst]);
  await Promise.all([owner.end(),auth.end()]);
 }
});
