import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {FIELD_EVIDENCE_SQL,COAUTHOR_SQL,PROFILE_SCOPE_SQL} from '../src/server/profile-evidence-sql.ts';
test('actual evidence, shared-work and scope queries PREPARE/execute as limited runtime roles',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
 try{await db.query('BEGIN');await db.query('GRANT SELECT ON person,publication,person_publication_effective,research_area TO yarenler_web,yarenler_auth');
 const tag='pe'+Math.random().toString(36).slice(2,7),short=tag+'1';
 const inst=(await db.query("INSERT INTO institution(kisa_ad,ad,ulke) VALUES($1::text,'Test Üniversitesi','TR') RETURNING id",[tag])).rows[0].id;
 const people=(await db.query("INSERT INTO person(institution_id,kisa_kimlik,ad,soyad,gorunen_ad,aktif) SELECT $1::uuid,$2::text||g,'Test','Kişi','Test Kişi',g<>3 FROM generate_series(1,3)g RETURNING id,kisa_kimlik",[inst,tag])).rows;
 const owner=people.find(p=>p.kisa_kimlik===short),peer=people.find(p=>p.kisa_kimlik===tag+'2');
 const area=(await db.query("INSERT INTO research_area(ad_tr,normalize_ad,sema) VALUES($1::text,$1::text,'yarenler') RETURNING id",[tag])).rows[0].id;
 const topic=(await db.query("INSERT INTO research_area(ad_en,normalize_ad,sema,duzey,kanonik_id) VALUES($1::text,$1::text,'openalex',2,$2::uuid) RETURNING id",[tag+'topic',area])).rows[0].id;
 await db.query("INSERT INTO person_research_area(person_id,area_id,kaynak) VALUES($1::uuid,$2::uuid,'kullanici')",[owner.id,area]);
 const works=(await db.query("INSERT INTO publication(baslik,yil,konu_alanlari) SELECT 'Test yayın '||g,2020+g,$1::uuid[] FROM generate_series(1,3)g RETURNING id",[[topic]])).rows.map(w=>w.id);
 await db.query("INSERT INTO person_publication(person_id,publication_id,kaynak,sira) SELECT a,b,'avesis',0 FROM unnest($1::uuid[])a CROSS JOIN unnest($2::uuid[])b",[people.map(p=>p.id),works]);
 await db.query('INSERT INTO person_publication_choice VALUES($1::uuid,$2::uuid,false,now())',[owner.id,works[2]]);
 const pilot=(await db.query("INSERT INTO publication(baslik,yil) VALUES('Kurgusal pilot yayın',2018) RETURNING id")).rows[0].id;
 await db.query("INSERT INTO person_publication(person_id,publication_id,kaynak,sira) VALUES($1::uuid,$2::uuid,'avesis',0)",[owner.id,pilot]);
 await db.query("INSERT INTO research_area_suggestion(person_id,area_id,similarity,evidence,model,applied_automatically) VALUES($1::uuid,$2::uuid,0,jsonb_build_object('titles',jsonb_build_array(jsonb_build_object('title','Kurgusal pilot yayın'))),'test',true)",[owner.id,area]);
 for(const role of ['yarenler_web','yarenler_auth']){await db.query('SET LOCAL ROLE '+role);
 const evidence=await db.query({name:role+'_fields',text:FIELD_EVIDENCE_SQL,values:[short]});assert.equal(evidence.rows.length,3);assert.ok(evidence.rows.every(r=>r.supported===3&&r.area_id===area));assert.ok(evidence.rows.some(r=>r.basis==='pilot'&&r.baslik==='Kurgusal pilot yayın'));
 const reference=await db.query({name:role+'_fields_reference',text:`WITH k AS (SELECT id FROM person WHERE kisa_kimlik=$1::text AND aktif), evidence AS (SELECT e.area_id,e.publication_id,min(e.basis) basis FROM person_field_publication e JOIN k ON k.id=e.person_id GROUP BY e.area_id,e.publication_id), ranked AS (SELECT e.area_id,e.basis,w.id,w.baslik,w.yil,w.doi,w.openalex_id,w.avesis_url,(SELECT min(t.source_id) FROM trdizin_publication t WHERE t.publication_id=w.id) trdizin_id,row_number() OVER(PARTITION BY e.area_id ORDER BY w.yil DESC NULLS LAST,w.baslik,w.id) n,count(*) OVER(PARTITION BY e.area_id)::int supported FROM evidence e JOIN publication w ON w.id=e.publication_id) SELECT area_id::text,basis,supported,baslik,yil,doi,openalex_id,avesis_url,trdizin_id FROM ranked WHERE n<=3 ORDER BY area_id,n`,values:[short]});assert.deepEqual(evidence.rows,reference.rows);
 const shared=await db.query({name:role+'_shared',text:COAUTHOR_SQL,values:[short]});assert.deepEqual(shared.rows,[{id:peer.kisa_kimlik,count:2}]);
 const scopes=await db.query({name:role+'_scope',text:PROFILE_SCOPE_SQL,values:[]});assert.ok(scopes.rows.some(r=>r.id===short&&r.area_id===area));assert.ok(!scopes.rows.some(r=>r.id===tag+'3'));
 await db.query('RESET ROLE');}
 await db.query("UPDATE research_area_suggestion SET status='dismissed' WHERE person_id=$1::uuid AND area_id=$2::uuid",[owner.id,area]);
 await db.query('SET LOCAL ROLE yarenler_web');const dismissed=await db.query({name:'dismissed_pilot_fields',text:FIELD_EVIDENCE_SQL,values:[short]});assert.ok(dismissed.rows.every(r=>r.baslik!=='Kurgusal pilot yayın'&&r.supported===2));await db.query('RESET ROLE');
 }finally{await db.query('ROLLBACK');await db.end();}
});
