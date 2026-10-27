-- migrate:up
-- Source identities are separate from owner choices and from replaceable AVESIS source links.
ALTER TABLE publication DROP CONSTRAINT publication_kaynak_check;
ALTER TABLE publication ADD CONSTRAINT publication_kaynak_check CHECK(kaynak IN ('avesis','openalex','kullanici','trdizin'));
CREATE TABLE trdizin_publication(
 source_id text PRIMARY KEY CHECK(source_id ~ '^[0-9]{1,20}$'),
 publication_id uuid NOT NULL REFERENCES publication(id) ON DELETE RESTRICT,
 doi text,
 titles jsonb NOT NULL CHECK(jsonb_typeof(titles)='array'),
 subjects jsonb NOT NULL CHECK(jsonb_typeof(subjects)='array'),
 source_year smallint CHECK(source_year BETWEEN 1900 AND 2100),
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trdizin_publication_publication_idx ON trdizin_publication(publication_id);
CREATE INDEX trdizin_publication_doi_idx ON trdizin_publication(doi) WHERE doi IS NOT NULL;
CREATE TABLE trdizin_authorship(
 person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
 source_id text NOT NULL REFERENCES trdizin_publication(source_id) ON DELETE CASCADE,
 author_id text NOT NULL CHECK(author_id ~ '^[0-9]{1,20}$'),
 verified_orcid text NOT NULL,
 PRIMARY KEY(person_id,source_id)
);
CREATE VIEW person_publication_all AS
 SELECT DISTINCT ON (person_id,publication_id) person_id,publication_id,kaynak,sira FROM (
 SELECT person_id,publication_id,kaynak,sira,0 priority FROM person_publication
 UNION ALL
 SELECT a.person_id,t.publication_id,'trdizin'::text,2147483647,1 FROM trdizin_authorship a JOIN trdizin_publication t USING(source_id)
 ) r ORDER BY person_id,publication_id,priority,sira;
CREATE OR REPLACE VIEW person_publication_effective AS
 SELECT pp.person_id,pp.publication_id,pp.kaynak,pp.sira FROM person_publication_all pp
 LEFT JOIN person_publication_choice c USING(person_id,publication_id) WHERE c.gorunur IS DISTINCT FROM false
 UNION ALL
 SELECT c.person_id,c.publication_id,'kullanici'::text,0 FROM person_publication_choice c WHERE c.gorunur
 AND NOT EXISTS(SELECT 1 FROM person_publication_all pp WHERE pp.person_id=c.person_id AND pp.publication_id=c.publication_id);
CREATE TRIGGER trdizin_publication_refresh AFTER INSERT OR UPDATE OR DELETE ON trdizin_authorship
 FOR EACH ROW EXECUTE FUNCTION yarenler_yayin_yenileme_isareti();
CREATE INDEX publication_doi_fold_idx ON publication(lower(doi)) WHERE doi IS NOT NULL;
CREATE FUNCTION yarenler_trdizin_kaydet(p_person uuid,p_orcid text,p_author text,p_source text,p_title text,p_year smallint,p_doi text,p_titles jsonb,p_subjects jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target uuid; candidates uuid[]; mapped uuid; link_changed boolean:=false; created boolean:=false;
BEGIN
 IF p_orcid IS NULL OR p_orcid !~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'
 OR p_author IS NULL OR p_author !~ '^[0-9]{1,20}$' OR p_source IS NULL OR p_source !~ '^[0-9]{1,20}$'
 OR length(coalesce(p_title,'')) NOT BETWEEN 1 AND 2000 OR (p_year IS NOT NULL AND p_year NOT BETWEEN 1900 AND 2100)
 OR (p_doi IS NOT NULL AND (length(p_doi)>300 OR p_doi !~ '^10\.[0-9]{4,9}/[^[:space:]]+$' OR p_doi<>lower(p_doi)))
 OR p_titles IS NULL OR jsonb_typeof(p_titles)<>'array' OR jsonb_array_length(p_titles) NOT BETWEEN 1 AND 10
 OR p_subjects IS NULL OR jsonb_typeof(p_subjects)<>'array' OR jsonb_array_length(p_subjects)>100
 OR pg_column_size(p_titles)>30000 OR pg_column_size(p_subjects)>30000
 THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='trdizin_gecersiz';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_titles) t WHERE jsonb_typeof(t)<>'string' OR length(t#>>'{}') NOT BETWEEN 1 AND 2000)
 OR NOT p_titles @> jsonb_build_array(p_title)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_subjects) t WHERE jsonb_typeof(t)<>'string' OR length(t#>>'{}') NOT BETWEEN 1 AND 300)
 THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='trdizin_gecersiz';END IF;
 -- Same lock as AVESIS import; source-identity resolution and insertion are atomic.
 PERFORM pg_advisory_xact_lock(hashtext('yarenler_import'));
 PERFORM 1 FROM person WHERE id=p_person AND orcid=p_orcid AND aktif AND NOT yonetici_gizledi FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','identity_changed');END IF;
 SELECT publication_id INTO mapped FROM trdizin_publication WHERE source_id=p_source;
 SELECT array_agg(DISTINCT id) INTO candidates FROM (SELECT id FROM publication WHERE lower(doi)=p_doi UNION SELECT publication_id AS id FROM trdizin_publication WHERE doi=p_doi) matches;
 IF cardinality(candidates)>1 OR (mapped IS NOT NULL AND candidates IS NOT NULL AND NOT mapped=ANY(candidates))
 OR (mapped IS NOT NULL AND p_doi IS NOT NULL AND (EXISTS(SELECT 1 FROM publication WHERE id=mapped AND doi IS NOT NULL AND lower(doi)<>p_doi) OR EXISTS(SELECT 1 FROM trdizin_publication WHERE source_id=p_source AND doi IS NOT NULL AND doi<>p_doi)))
 THEN RETURN jsonb_build_object('status','identifier_conflict');END IF;
 target:=coalesce(mapped,candidates[1]);
 IF target IS NULL THEN
  -- A title overlap is not an identity. Defer it instead of manufacturing a duplicate or a merge.
  IF EXISTS(SELECT 1 FROM publication w WHERE EXISTS(
    SELECT 1 FROM person_publication_all pp WHERE pp.person_id=p_person AND pp.publication_id=w.id
    UNION ALL SELECT 1 FROM person_publication_choice c WHERE c.person_id=p_person AND c.publication_id=w.id)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_titles) t WHERE yarenler_katla(w.baslik)=yarenler_katla(t)))
  THEN RETURN jsonb_build_object('status','title_review');END IF;
  INSERT INTO publication(anahtar,kaynak,baslik,yil,tur,doi)
   VALUES('trdizin:'||p_source,'trdizin',p_title,p_year,'makale',p_doi) RETURNING id INTO target;
  created:=true;
 END IF;
 -- Never replace the publication's existing title, year, type, DOI or owner choices.
 INSERT INTO trdizin_publication(source_id,publication_id,doi,titles,subjects,source_year)
 VALUES(p_source,target,p_doi,p_titles,p_subjects,p_year)
 ON CONFLICT(source_id) DO UPDATE SET doi=excluded.doi,titles=excluded.titles,subjects=excluded.subjects,source_year=excluded.source_year,observed_at=now()
 WHERE (trdizin_publication.doi,trdizin_publication.titles,trdizin_publication.subjects,trdizin_publication.source_year)
 IS DISTINCT FROM (excluded.doi,excluded.titles,excluded.subjects,excluded.source_year);
 INSERT INTO trdizin_authorship(person_id,source_id,author_id,verified_orcid) VALUES(p_person,p_source,p_author,p_orcid)
 ON CONFLICT(person_id,source_id) DO UPDATE SET author_id=excluded.author_id,verified_orcid=excluded.verified_orcid
 WHERE (trdizin_authorship.author_id,trdizin_authorship.verified_orcid) IS DISTINCT FROM (excluded.author_id,excluded.verified_orcid);
 link_changed:=FOUND;
 IF link_changed THEN UPDATE person SET guncelleme=now() WHERE id=p_person;END IF;
 RETURN jsonb_build_object('status',CASE WHEN created THEN 'created' WHEN link_changed THEN 'linked' ELSE 'unchanged' END,'publication_id',target);
END $$;
REVOKE ALL ON FUNCTION yarenler_trdizin_kaydet(uuid,text,text,text,text,smallint,text,jsonb,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION yarenler_yayinlarim(p_oturum uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.yil DESC NULLS LAST,r.baslik),'[]'::jsonb) FROM (
 SELECT p.id,p.baslik,p.yil,p.tur,p.doi,p.kaynak_adi,coalesce(c.gorunur,true) gorunur
 FROM orcid_session s JOIN person_publication_all pp ON pp.person_id=s.person_id JOIN publication p ON p.id=pp.publication_id
 LEFT JOIN person_publication_choice c ON c.person_id=s.person_id AND c.publication_id=p.id
 WHERE s.id=p_oturum AND s.bitis>now()
 UNION ALL
 SELECT p.id,p.baslik,p.yil,p.tur,p.doi,p.kaynak_adi,c.gorunur
 FROM orcid_session s JOIN person_publication_choice c ON c.person_id=s.person_id JOIN publication p ON p.id=c.publication_id
 WHERE s.id=p_oturum AND s.bitis>now() AND NOT EXISTS(SELECT 1 FROM person_publication_all pp WHERE pp.person_id=s.person_id AND pp.publication_id=p.id)
 )r
$$;
CREATE OR REPLACE FUNCTION yarenler_yayin_sec(p_oturum uuid,p_yayin uuid,p_gorunur boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kisi uuid;
BEGIN
 SELECT s.person_id INTO kisi FROM orcid_session s JOIN person p ON p.id=s.person_id AND p.sahiplenildi AND p.orcid=s.orcid AND p.aktif WHERE s.id=p_oturum AND s.bitis>now();
 IF kisi IS NULL OR yarenler_platform_yasagi(kisi,NULL) IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='yayin_oturum';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('yayin:'||kisi::text));
 IF NOT EXISTS(SELECT 1 FROM person_publication_all WHERE person_id=kisi AND publication_id=p_yayin)
 AND NOT EXISTS(SELECT 1 FROM person_publication_choice WHERE person_id=kisi AND publication_id=p_yayin) THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='yayin_sahibi';END IF;
 INSERT INTO person_publication_choice(person_id,publication_id,gorunur) VALUES(kisi,p_yayin,p_gorunur)
 ON CONFLICT(person_id,publication_id) DO UPDATE SET gorunur=excluded.gorunur,guncelleme=now();
 UPDATE person SET guncelleme=now() WHERE id=kisi;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_maintenance') THEN
  GRANT SELECT(id,orcid,aktif,yonetici_gizledi) ON person TO yarenler_maintenance;
  GRANT EXECUTE ON FUNCTION yarenler_trdizin_kaydet(uuid,text,text,text,text,smallint,text,jsonb,jsonb) TO yarenler_maintenance;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_web') THEN GRANT SELECT ON trdizin_publication TO yarenler_web;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN GRANT SELECT ON person_publication_all,trdizin_publication TO yarenler_auth;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_indexer') THEN GRANT SELECT ON person_publication_all TO yarenler_indexer;END IF;
END $$;
-- migrate:down
CREATE OR REPLACE FUNCTION yarenler_yayinlarim(p_oturum uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.yil DESC NULLS LAST,r.baslik),'[]'::jsonb) FROM (
 SELECT p.id,p.baslik,p.yil,p.tur,p.doi,p.kaynak_adi,coalesce(c.gorunur,true) gorunur
 FROM orcid_session s JOIN person_publication pp ON pp.person_id=s.person_id JOIN publication p ON p.id=pp.publication_id
 LEFT JOIN person_publication_choice c ON c.person_id=s.person_id AND c.publication_id=p.id
 WHERE s.id=p_oturum AND s.bitis>now()
 UNION ALL
 SELECT p.id,p.baslik,p.yil,p.tur,p.doi,p.kaynak_adi,c.gorunur
 FROM orcid_session s JOIN person_publication_choice c ON c.person_id=s.person_id JOIN publication p ON p.id=c.publication_id
 WHERE s.id=p_oturum AND s.bitis>now() AND NOT EXISTS(SELECT 1 FROM person_publication pp WHERE pp.person_id=s.person_id AND pp.publication_id=p.id)
 )r
$$;
CREATE OR REPLACE FUNCTION yarenler_yayin_sec(p_oturum uuid,p_yayin uuid,p_gorunur boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kisi uuid;
BEGIN
 SELECT s.person_id INTO kisi FROM orcid_session s JOIN person p ON p.id=s.person_id AND p.sahiplenildi AND p.orcid=s.orcid AND p.aktif WHERE s.id=p_oturum AND s.bitis>now();
 IF kisi IS NULL OR yarenler_platform_yasagi(kisi,NULL) IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='yayin_oturum';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('yayin:'||kisi::text));
 IF NOT EXISTS(SELECT 1 FROM person_publication WHERE person_id=kisi AND publication_id=p_yayin)
 AND NOT EXISTS(SELECT 1 FROM person_publication_choice WHERE person_id=kisi AND publication_id=p_yayin) THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='yayin_sahibi';END IF;
 INSERT INTO person_publication_choice(person_id,publication_id,gorunur) VALUES(kisi,p_yayin,p_gorunur)
 ON CONFLICT(person_id,publication_id) DO UPDATE SET gorunur=excluded.gorunur,guncelleme=now();
 UPDATE person SET guncelleme=now() WHERE id=kisi;
END $$;
CREATE OR REPLACE VIEW person_publication_effective AS
 SELECT pp.person_id,pp.publication_id,pp.kaynak,pp.sira FROM person_publication pp
 LEFT JOIN person_publication_choice c USING(person_id,publication_id) WHERE c.gorunur IS DISTINCT FROM false
 UNION ALL
 SELECT c.person_id,c.publication_id,'kullanici'::text,0 FROM person_publication_choice c WHERE c.gorunur
 AND NOT EXISTS(SELECT 1 FROM person_publication pp WHERE pp.person_id=c.person_id AND pp.publication_id=c.publication_id);
DROP VIEW person_publication_all;
DROP FUNCTION yarenler_trdizin_kaydet(uuid,text,text,text,text,smallint,text,jsonb,jsonb);
DROP TABLE trdizin_authorship,trdizin_publication;
DROP INDEX publication_doi_fold_idx;
-- Keep imported publications on rollback; do not erase research or owner choices.
