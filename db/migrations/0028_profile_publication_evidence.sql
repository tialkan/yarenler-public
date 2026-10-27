-- migrate:up
-- Public evidence follows effective (owner-visible) publications. No inferred authorship by name.
CREATE VIEW publication_topic_path AS
 WITH RECURSIVE path(topic_id,node_id,area_id,duzey,parent_id,visited) AS (
  SELECT a.id,a.id,coalesce(a.kanonik_id,a.id),a.duzey,a.ust_id,ARRAY[a.id]
  FROM research_area a WHERE a.sema='openalex'
  UNION ALL
  SELECT p.topic_id,a.id,coalesce(a.kanonik_id,a.id),a.duzey,a.ust_id,p.visited||a.id
  FROM path p JOIN research_area a ON a.id=p.parent_id
  WHERE a.sema='openalex' AND NOT a.id=ANY(p.visited) AND cardinality(p.visited)<8
 ) SELECT DISTINCT topic_id,area_id,duzey FROM path;
CREATE VIEW person_publication_scope AS
 SELECT DISTINCT pp.person_id,pp.publication_id,t.area_id,t.duzey
 FROM person_publication_effective pp JOIN person p ON p.id=pp.person_id AND p.aktif
 JOIN publication w ON w.id=pp.publication_id
 JOIN publication_topic_path t ON t.topic_id=ANY(w.konu_alanlari);
CREATE VIEW person_field_publication AS
 SELECT s.person_id,s.area_id,s.publication_id,'openalex'::text basis
 FROM person_publication_scope s JOIN person_matching_area ma ON ma.person_id=s.person_id AND ma.area_id=s.area_id AND NOT ma.interest
 UNION
 SELECT s.person_id,coalesce(a.kanonik_id,a.id),pp.publication_id,'pilot'::text
 FROM research_area_suggestion s JOIN research_area a ON a.id=s.area_id
 JOIN person p ON p.id=s.person_id AND p.aktif
 JOIN person_matching_area ma ON ma.person_id=s.person_id AND ma.area_id=coalesce(a.kanonik_id,a.id) AND NOT ma.interest
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.evidence->'titles')='array' THEN s.evidence->'titles' ELSE '[]'::jsonb END) title
 JOIN person_publication_effective pp ON pp.person_id=s.person_id
 JOIN publication w ON w.id=pp.publication_id AND (
  (length(title->>'title')>=5 AND yarenler_katla(w.baslik)=yarenler_katla(title->>'title'))
  OR (w.avesis_url IS NOT NULL AND w.avesis_url=title->>'source_url'))
 WHERE s.status<>'dismissed' AND (s.status='accepted' OR s.applied_automatically);
CREATE INDEX person_publication_choice_publication_idx ON person_publication_choice(publication_id) WHERE gorunur;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_web') THEN
  GRANT SELECT ON publication_topic_path,person_publication_scope,person_field_publication TO yarenler_web;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN
  GRANT SELECT ON publication_topic_path,person_publication_scope,person_field_publication TO yarenler_auth;
 END IF;
END $$;
-- migrate:down
DROP INDEX person_publication_choice_publication_idx;
DROP VIEW person_field_publication,person_publication_scope,publication_topic_path;
