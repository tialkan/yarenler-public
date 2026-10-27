import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

test('optimized publication view preserves source priority, deduplication and owner visibility',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const c=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await c.connect();
 try{await c.query('BEGIN');
  const sql=`WITH original AS (
   SELECT DISTINCT ON (person_id,publication_id) person_id,publication_id,kaynak,sira FROM (
    SELECT person_id,publication_id,kaynak,sira,0 priority FROM person_publication
    UNION ALL SELECT a.person_id,t.publication_id,'trdizin'::text,2147483647,1 FROM trdizin_authorship a JOIN trdizin_publication t USING(source_id)
   ) r ORDER BY person_id,publication_id,priority,sira
  ), differences AS (
   (SELECT * FROM original EXCEPT ALL SELECT * FROM person_publication_all)
   UNION ALL (SELECT * FROM person_publication_all EXCEPT ALL SELECT * FROM original)
  ) SELECT count(*)::int AS n FROM differences`;
  const r=await c.query({name:'publication_view_parity',text:sql});assert.equal(r.rows[0].n,0);
  const q=await c.query({name:'publication_effective_owner_visibility',text:`SELECT count(*)::int AS n FROM person_publication_effective e JOIN person_publication_choice c USING(person_id,publication_id) WHERE NOT c.gorunur`});assert.equal(q.rows[0].n,0);
  await c.query('SET LOCAL ROLE yarenler_web');const restricted=await c.query({name:'restricted_effective_lookup',text:'SELECT count(*)::int AS n FROM person_publication_effective WHERE person_id=$1::uuid',values:['00000000-0000-0000-0000-000000000000']});assert.equal(restricted.rows[0].n,0);
 }finally{await c.query('ROLLBACK');await c.end();}
});
