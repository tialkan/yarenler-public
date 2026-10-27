-- migrate:up
-- Preserve AVESİS/OpenAlex priority over TR Dizin while allowing person filters to
-- reach the source indexes. The previous DISTINCT ON sorted the complete corpus.
CREATE OR REPLACE VIEW person_publication_all AS
 SELECT pp.person_id,pp.publication_id,pp.kaynak,pp.sira FROM person_publication pp
 UNION ALL
 SELECT DISTINCT a.person_id,t.publication_id,'trdizin'::text,2147483647
 FROM trdizin_authorship a JOIN trdizin_publication t USING(source_id)
 WHERE NOT EXISTS (SELECT 1 FROM person_publication pp WHERE pp.person_id=a.person_id AND pp.publication_id=t.publication_id);
-- Expand the typically short topic array first, allowing a hash join to the
-- topic hierarchy instead of repeatedly comparing every publication to it.
CREATE OR REPLACE VIEW person_publication_scope AS
 SELECT DISTINCT pp.person_id,pp.publication_id,t.area_id,t.duzey
 FROM person_publication_effective pp JOIN person p ON p.id=pp.person_id AND p.aktif
 JOIN publication w ON w.id=pp.publication_id
 CROSS JOIN LATERAL unnest(w.konu_alanlari) AS topic(id)
 JOIN publication_topic_path t ON t.topic_id=topic.id;
-- migrate:down
CREATE OR REPLACE VIEW person_publication_scope AS
 SELECT DISTINCT pp.person_id,pp.publication_id,t.area_id,t.duzey
 FROM person_publication_effective pp JOIN person p ON p.id=pp.person_id AND p.aktif
 JOIN publication w ON w.id=pp.publication_id
 JOIN publication_topic_path t ON t.topic_id=ANY(w.konu_alanlari);
CREATE OR REPLACE VIEW person_publication_all AS
 SELECT DISTINCT ON (person_id,publication_id) person_id,publication_id,kaynak,sira FROM (
 SELECT person_id,publication_id,kaynak,sira,0 priority FROM person_publication
 UNION ALL
 SELECT a.person_id,t.publication_id,'trdizin'::text,2147483647,1 FROM trdizin_authorship a JOIN trdizin_publication t USING(source_id)
 ) r ORDER BY person_id,publication_id,priority,sira;
