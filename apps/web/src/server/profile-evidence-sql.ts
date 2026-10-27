export const FIELD_EVIDENCE_SQL=`WITH k AS MATERIALIZED (SELECT id FROM person WHERE kisa_kimlik=$1::text AND aktif),
 evidence AS (SELECT e.area_id,e.publication_id,min(e.basis) basis FROM k CROSS JOIN LATERAL (SELECT area_id,publication_id,basis FROM person_field_publication WHERE person_id=k.id OFFSET 0) e GROUP BY e.area_id,e.publication_id),
 ranked AS (SELECT e.area_id,e.basis,w.id,w.baslik,w.yil,w.doi,w.openalex_id,w.avesis_url,(SELECT min(t.source_id) FROM trdizin_publication t WHERE t.publication_id=w.id) trdizin_id,
  row_number() OVER(PARTITION BY e.area_id ORDER BY w.yil DESC NULLS LAST,w.baslik,w.id) n,
  count(*) OVER(PARTITION BY e.area_id)::int supported FROM evidence e JOIN publication w ON w.id=e.publication_id)
 SELECT area_id::text,basis,supported,baslik,yil,doi,openalex_id,avesis_url,trdizin_id FROM ranked WHERE n<=3 ORDER BY area_id,n`;
export const COAUTHOR_SQL=`WITH k AS (SELECT id FROM person WHERE kisa_kimlik=$1::text AND aktif),
 mine AS (SELECT pp.publication_id FROM person_publication_effective pp JOIN k ON k.id=pp.person_id)
 SELECT p.kisa_kimlik id,count(DISTINCT peer.publication_id)::int count FROM mine
 JOIN person_publication_effective peer USING(publication_id) JOIN person p ON p.id=peer.person_id AND p.aktif
 WHERE NOT EXISTS(SELECT 1 FROM k WHERE k.id=p.id) GROUP BY p.kisa_kimlik`;
export const PROFILE_SCOPE_SQL=`SELECT p.kisa_kimlik id,s.area_id::text area_id,
 coalesce(a.ad_tr,a.ad_en) name,max(s.duzey)::int level
 FROM person_publication_scope s JOIN person p ON p.id=s.person_id AND p.aktif JOIN research_area a ON a.id=s.area_id
 WHERE s.duzey IN (1,2) GROUP BY p.kisa_kimlik,s.area_id,a.ad_tr,a.ad_en`;
