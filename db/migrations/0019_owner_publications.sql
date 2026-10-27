-- migrate:up
-- Keep source records intact; the owner's visibility choice wins after every source refresh.
ALTER TABLE publication DROP CONSTRAINT publication_kaynak_check;
ALTER TABLE publication ADD CONSTRAINT publication_kaynak_check CHECK(kaynak IN ('avesis','openalex','kullanici'));
CREATE TABLE person_publication_choice(
 person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
 publication_id uuid NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
 gorunur boolean NOT NULL,
 guncelleme timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(person_id,publication_id)
);
CREATE VIEW person_publication_effective AS
 SELECT pp.person_id,pp.publication_id,pp.kaynak,pp.sira FROM person_publication pp
 LEFT JOIN person_publication_choice c USING(person_id,publication_id) WHERE c.gorunur IS DISTINCT FROM false
 UNION ALL
 SELECT c.person_id,c.publication_id,'kullanici'::text,0 FROM person_publication_choice c WHERE c.gorunur
 AND NOT EXISTS(SELECT 1 FROM person_publication pp WHERE pp.person_id=c.person_id AND pp.publication_id=c.publication_id);
CREATE FUNCTION yarenler_yayinlarim(p_oturum uuid) RETURNS jsonb
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
CREATE FUNCTION yarenler_yayin_sec(p_oturum uuid,p_yayin uuid,p_gorunur boolean) RETURNS void
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
CREATE FUNCTION yarenler_yayin_ekle(p_oturum uuid,p_baslik text,p_yil int,p_tur text,p_doi text,p_dergi text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kisi uuid; yayin uuid;
BEGIN
 SELECT s.person_id INTO kisi FROM orcid_session s JOIN person p ON p.id=s.person_id AND p.sahiplenildi AND p.orcid=s.orcid AND p.aktif WHERE s.id=p_oturum AND s.bitis>now();
 IF kisi IS NULL OR yarenler_platform_yasagi(kisi,NULL) IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='yayin_oturum';END IF;
 IF char_length(btrim(coalesce(p_baslik,''))) NOT BETWEEN 5 AND 2000 OR (p_yil IS NOT NULL AND p_yil NOT BETWEEN 1900 AND 2100)
 OR p_tur IS NULL OR p_tur NOT IN ('makale','bildiri','kitap','kitap_bolumu','diger') OR char_length(coalesce(p_dergi,''))>300
 OR (p_doi IS NOT NULL AND (char_length(p_doi)>300 OR p_doi !~ '^10\.[0-9]{4,9}/[^[:space:]]+$')) THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='yayin_gecersiz';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('yayin:'||kisi::text));
 IF (SELECT count(*) FROM person_publication_choice WHERE person_id=kisi AND guncelleme>now()-interval '1 day')>=100 THEN RAISE EXCEPTION USING ERRCODE='YA033',MESSAGE='yayin_sinir';END IF;
 SELECT id INTO yayin FROM publication WHERE (p_doi IS NOT NULL AND lower(doi)=lower(p_doi)) OR (kaynak='kullanici' AND lower(baslik)=lower(btrim(p_baslik)) AND yil IS NOT DISTINCT FROM p_yil) ORDER BY (doi IS NOT NULL) DESC LIMIT 1;
 IF yayin IS NULL THEN
  INSERT INTO publication(anahtar,kaynak,baslik,yil,tur,doi,kaynak_adi) VALUES(coalesce('doi:'||lower(p_doi),'kullanici:'||uuidv7()::text),'kullanici',btrim(p_baslik),p_yil,p_tur,p_doi,nullif(btrim(p_dergi),'')) ON CONFLICT(doi) DO UPDATE SET doi=excluded.doi RETURNING id INTO yayin;
 END IF;
 INSERT INTO person_publication_choice(person_id,publication_id,gorunur) VALUES(kisi,yayin,true)
 ON CONFLICT(person_id,publication_id) DO UPDATE SET gorunur=true,guncelleme=now();
 UPDATE person SET guncelleme=now() WHERE id=kisi;
 RETURN yayin;
END $$;
REVOKE ALL ON FUNCTION yarenler_yayinlarim(uuid),yarenler_yayin_sec(uuid,uuid,boolean),yarenler_yayin_ekle(uuid,text,int,text,text,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN
  GRANT EXECUTE ON FUNCTION yarenler_yayinlarim(uuid),yarenler_yayin_sec(uuid,uuid,boolean),yarenler_yayin_ekle(uuid,text,int,text,text,text) TO yarenler_auth;
  GRANT SELECT ON person_publication_effective TO yarenler_auth;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_web') THEN GRANT SELECT ON person_publication_effective TO yarenler_web;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_indexer') THEN GRANT SELECT ON person_publication_effective,publication TO yarenler_indexer;END IF;
END $$;
-- migrate:down
DROP FUNCTION yarenler_yayinlarim(uuid),yarenler_yayin_sec(uuid,uuid,boolean),yarenler_yayin_ekle(uuid,text,int,text,text,text);
DROP VIEW person_publication_effective;
DROP TABLE person_publication_choice;
-- Preserve owner-created publication metadata on rollback.
