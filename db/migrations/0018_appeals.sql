-- migrate:up
-- Private human review. Auth can only use session-scoped functions; web has no access.
CREATE FUNCTION yarenler_itiraz_surumu() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
CREATE TABLE itiraz (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
 ihlal_id uuid, -- opaque reference retained after the 180-day violation cleanup; ownership checked on creation
 tur text NOT NULL CHECK(tur IN ('duyuru','alan','profil')),
 mesaj text NOT NULL CHECK(char_length(mesaj) BETWEEN 20 AND 3000),
 durum text NOT NULL DEFAULT 'acik' CHECK(durum IN ('acik','kabul','ret')),
 yanit text CHECK(char_length(yanit) BETWEEN 10 AND 2000),
 olusturma timestamptz NOT NULL DEFAULT now(),
 sonuclanma timestamptz,
 CHECK((durum='acik' AND yanit IS NULL AND sonuclanma IS NULL) OR (durum<>'acik' AND yanit IS NOT NULL AND sonuclanma IS NOT NULL))
);
CREATE UNIQUE INDEX itiraz_acik_tek ON itiraz(person_id,tur,ihlal_id) NULLS NOT DISTINCT WHERE durum='acik';
CREATE INDEX itiraz_tarih_idx ON itiraz(olusturma DESC);
CREATE FUNCTION yarenler_itiraz_ac(p_oturum uuid,p_ihlal uuid,p_tur text,p_mesaj text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kisi uuid; sonuc uuid;
BEGIN
 SELECT person_id INTO kisi FROM orcid_session WHERE id=p_oturum AND bitis>now();
 IF kisi IS NULL THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='itiraz_oturum';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('itiraz:'||kisi::text));
 IF p_tur NOT IN ('duyuru','alan','profil') OR p_tur IS NULL OR char_length(btrim(coalesce(p_mesaj,''))) NOT BETWEEN 20 AND 3000 THEN
  RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='itiraz_gecersiz';END IF;
 IF p_ihlal IS NOT NULL AND (p_tur<>'duyuru' OR NOT EXISTS(SELECT 1 FROM icerik_ihlali WHERE id=p_ihlal AND person_id=kisi)) THEN
  RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='itiraz_gecersiz';END IF;
 IF EXISTS(SELECT 1 FROM itiraz WHERE person_id=kisi AND tur=p_tur AND ihlal_id IS NOT DISTINCT FROM p_ihlal AND durum='acik') THEN
  RAISE EXCEPTION USING ERRCODE='YA032',MESSAGE='itiraz_acik';END IF;
 IF (SELECT count(*) FROM itiraz WHERE person_id=kisi AND olusturma>now()-interval '1 day')>=3 THEN
  RAISE EXCEPTION USING ERRCODE='YA033',MESSAGE='itiraz_sinir';END IF;
 INSERT INTO itiraz(person_id,ihlal_id,tur,mesaj) VALUES(kisi,p_ihlal,p_tur,btrim(p_mesaj)) RETURNING id INTO sonuc;
 RETURN sonuc;
END $$;
CREATE FUNCTION yarenler_itirazlarim(p_oturum uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH kisi AS(SELECT person_id FROM orcid_session WHERE id=p_oturum AND bitis>now())
 SELECT jsonb_build_object(
 'itirazlar',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.olusturma DESC) FROM (SELECT id,tur,mesaj,durum,yanit,olusturma,sonuclanma FROM itiraz WHERE person_id=(SELECT person_id FROM kisi) ORDER BY olusturma DESC LIMIT 30)i),'[]'::jsonb),
 'kararlar',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.olusturma DESC) FROM (SELECT id,karar,kategori,gerekce,olusturma FROM icerik_ihlali WHERE person_id=(SELECT person_id FROM kisi) ORDER BY olusturma DESC LIMIT 20)v),'[]'::jsonb))
$$;
CREATE FUNCTION yarenler_itiraz_sonuclandir(p_id uuid,p_karar text,p_yanit text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE onceki itiraz; sonraki itiraz;
BEGIN
 IF p_karar IS NULL OR p_karar NOT IN ('kabul','ret') OR char_length(btrim(coalesce(p_yanit,''))) NOT BETWEEN 10 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='itiraz_gecersiz';END IF;
 SELECT * INTO onceki FROM itiraz WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR onceki.durum<>'acik' THEN RAISE EXCEPTION USING ERRCODE='YA034',MESSAGE='itiraz_kapali';END IF;
 UPDATE itiraz SET durum=p_karar,yanit=btrim(p_yanit),sonuclanma=now() WHERE id=p_id RETURNING * INTO sonraki;
 -- No automatic publication, lifting of unrelated bans or reset of the daily allowance.
 -- The reviewer applies any necessary correction through the existing audited panel actions first.
 RETURN jsonb_build_object('once',jsonb_build_object('durum',onceki.durum),'sonra',jsonb_build_object('durum',sonraki.durum,'yanit',sonraki.yanit),'person_id',sonraki.person_id);
END $$;
CREATE FUNCTION yarenler_itiraz_temizle() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN DELETE FROM itiraz WHERE sonuclanma<now()-interval '180 days';GET DIAGNOSTICS n=ROW_COUNT;RETURN n;END $$;
REVOKE ALL ON FUNCTION yarenler_itiraz_ac(uuid,uuid,text,text),yarenler_itirazlarim(uuid),yarenler_itiraz_sonuclandir(uuid,text,text),yarenler_itiraz_temizle() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN
  GRANT EXECUTE ON FUNCTION yarenler_itiraz_ac(uuid,uuid,text,text),yarenler_itirazlarim(uuid) TO yarenler_auth;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_admin') THEN
  GRANT SELECT ON itiraz TO yarenler_admin;
  GRANT EXECUTE ON FUNCTION yarenler_itiraz_sonuclandir(uuid,text,text) TO yarenler_admin;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_maintenance') THEN
  GRANT EXECUTE ON FUNCTION yarenler_itiraz_temizle() TO yarenler_maintenance;
 END IF;
END $$;
-- migrate:down
DROP FUNCTION yarenler_itiraz_surumu(),yarenler_itiraz_temizle(),yarenler_itiraz_sonuclandir(uuid,text,text),yarenler_itirazlarim(uuid),yarenler_itiraz_ac(uuid,uuid,text,text);
DROP TABLE itiraz;
