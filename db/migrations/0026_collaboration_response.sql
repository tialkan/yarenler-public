-- migrate:up
CREATE TABLE announcement_skill(announcement_id uuid NOT NULL REFERENCES announcement(id) ON DELETE CASCADE,area_id uuid NOT NULL REFERENCES research_area(id) ON DELETE CASCADE,PRIMARY KEY(announcement_id,area_id));
CREATE TABLE announcement_interest_usage(person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,gun date NOT NULL,adet int NOT NULL CHECK(adet BETWEEN 1 AND 20),PRIMARY KEY(person_id,gun));
CREATE TABLE announcement_interest(announcement_id uuid NOT NULL REFERENCES announcement(id) ON DELETE CASCADE,person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,olusturma timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(announcement_id,person_id));
CREATE FUNCTION yarenler_duyuru_yetkinlik(p_oturum uuid,p_duyuru uuid,p_alan uuid[]) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kisi uuid;
BEGIN
 SELECT s.person_id INTO kisi FROM orcid_session s JOIN person p ON p.id=s.person_id AND p.aktif AND p.sahiplenildi AND p.orcid=s.orcid WHERE s.id=p_oturum AND s.bitis>now();
 IF kisi IS NULL OR yarenler_platform_yasagi(kisi,NULL) IS NOT NULL OR NOT EXISTS(SELECT 1 FROM announcement WHERE id=p_duyuru AND sahip_id=kisi AND durum='yayinda' AND bitis>now()) THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='yetkinlik_yetki';END IF;
 IF coalesce(cardinality(p_alan),0)>3 OR EXISTS(SELECT 1 FROM unnest(p_alan) x WHERE NOT EXISTS(SELECT 1 FROM research_area WHERE id=x)) THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='yetkinlik_gecersiz';END IF;
 DELETE FROM announcement_skill WHERE announcement_id=p_duyuru;
 INSERT INTO announcement_skill SELECT p_duyuru,coalesce(a.kanonik_id,a.id) FROM research_area a WHERE a.id=ANY(p_alan) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION yarenler_duyuru_ilgi_durumu(p_oturum uuid,p_kisa text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('active',EXISTS(SELECT 1 FROM announcement_interest i WHERE i.announcement_id=a.id AND i.person_id=s.person_id),'owner',a.sahip_id=s.person_id)
 FROM orcid_session s JOIN person p ON p.id=s.person_id AND p.aktif AND p.sahiplenildi AND p.orcid=s.orcid JOIN announcement a ON a.kisa_kimlik=p_kisa AND a.durum='yayinda' AND a.bitis>now() JOIN person owner ON owner.id=a.sahip_id AND owner.aktif
 WHERE s.id=p_oturum AND s.bitis>now() AND yarenler_platform_yasagi(s.person_id,s.orcid) IS NULL
$$;
CREATE FUNCTION yarenler_duyuru_ilgi(p_oturum uuid,p_kisa text,p_aktif boolean) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kisi uuid;duyuru uuid;
BEGIN
 SELECT s.person_id INTO kisi FROM orcid_session s JOIN person p ON p.id=s.person_id AND p.aktif AND p.sahiplenildi AND p.orcid=s.orcid WHERE s.id=p_oturum AND s.bitis>now();
 IF kisi IS NULL OR yarenler_platform_yasagi(kisi,NULL) IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='ilgi_oturum';END IF;
 SELECT a.id INTO duyuru FROM announcement a JOIN person owner ON owner.id=a.sahip_id AND owner.aktif WHERE a.kisa_kimlik=p_kisa AND a.durum='yayinda' AND a.bitis>now() AND a.sahip_id<>kisi;
 IF duyuru IS NULL OR p_aktif IS NULL THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='ilgi_duyuru';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('ilgi:'||kisi::text));
 IF p_aktif THEN
  IF NOT EXISTS(SELECT 1 FROM announcement_interest WHERE announcement_id=duyuru AND person_id=kisi) THEN
   IF coalesce((SELECT adet FROM announcement_interest_usage WHERE person_id=kisi AND gun=yarenler_bugun()),0)>=20 THEN RAISE EXCEPTION USING ERRCODE='YA033',MESSAGE='ilgi_sinir';END IF;
   INSERT INTO announcement_interest_usage VALUES(kisi,yarenler_bugun(),1) ON CONFLICT(person_id,gun) DO UPDATE SET adet=announcement_interest_usage.adet+1;
  END IF;
  INSERT INTO announcement_interest VALUES(duyuru,kisi,now()) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM announcement_interest WHERE announcement_id=duyuru AND person_id=kisi;
 END IF;
 RETURN p_aktif;
END $$;
CREATE FUNCTION yarenler_duyuru_ilgilenenler(p_oturum uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM (
 SELECT a.id announcement_id,p.kisa_kimlik person_short,p.gorunen_ad name,i.olusturma
 FROM orcid_session s JOIN person owner ON owner.id=s.person_id AND owner.aktif AND owner.sahiplenildi AND owner.orcid=s.orcid JOIN announcement a ON a.sahip_id=s.person_id AND a.durum='yayinda' AND a.bitis>now() JOIN announcement_interest i ON i.announcement_id=a.id JOIN person p ON p.id=i.person_id AND p.aktif
 WHERE s.id=p_oturum AND s.bitis>now() AND yarenler_platform_yasagi(s.person_id,s.orcid) IS NULL ORDER BY i.olusturma DESC LIMIT 100
 )r
$$;
CREATE FUNCTION yarenler_ilgi_temizle() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n int;
BEGIN DELETE FROM announcement_interest_usage WHERE gun<yarenler_bugun()-2;DELETE FROM announcement_interest i USING announcement a WHERE a.id=i.announcement_id AND (a.durum<>'yayinda' OR a.bitis<=now());GET DIAGNOSTICS n=ROW_COUNT;RETURN n;END $$;
REVOKE ALL ON FUNCTION yarenler_duyuru_yetkinlik(uuid,uuid,uuid[]),yarenler_duyuru_ilgi_durumu(uuid,text),yarenler_duyuru_ilgi(uuid,text,boolean),yarenler_duyuru_ilgilenenler(uuid),yarenler_ilgi_temizle() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_web') THEN GRANT SELECT ON announcement_skill TO yarenler_web;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN GRANT SELECT ON announcement_skill TO yarenler_auth;GRANT EXECUTE ON FUNCTION yarenler_duyuru_yetkinlik(uuid,uuid,uuid[]),yarenler_duyuru_ilgi_durumu(uuid,text),yarenler_duyuru_ilgi(uuid,text,boolean),yarenler_duyuru_ilgilenenler(uuid) TO yarenler_auth;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_maintenance') THEN GRANT EXECUTE ON FUNCTION yarenler_ilgi_temizle() TO yarenler_maintenance;END IF;
END $$;
CREATE OR REPLACE FUNCTION yarenler_duyuru_revize(p_deneme uuid,p_person uuid,p_metin text,p_kaynak jsonb,p_kavram text[]) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE hedef uuid;
BEGIN
 IF yarenler_platform_yasagi(p_person,NULL) IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='YA021',MESSAGE='platform_yasagi';END IF;
 IF EXISTS(SELECT 1 FROM duyuru_yasagi WHERE person_id=p_person AND bitis>now()) THEN RAISE EXCEPTION USING ERRCODE='YA022',MESSAGE='duyuru_yasagi';END IF;
 IF coalesce((SELECT duyuru FROM kisi_kisitlamasi WHERE person_id=p_person),false) THEN RAISE EXCEPTION USING ERRCODE='YA005',MESSAGE='duyuru_kisitli';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('yarenler_duyuru:'||p_person::text,0));
 SELECT revizyon_hedef INTO hedef FROM duyuru_denemesi WHERE id=p_deneme AND person_id=p_person AND durum='baslatildi';
 IF hedef IS NULL THEN RAISE EXCEPTION USING ERRCODE='YA025',MESSAGE='revizyon_deneme';END IF;
 UPDATE announcement SET yayin_metni=p_metin,kaynaklar=p_kaynak,anahtar_kelimeler=p_kavram,revizyon_tarihi=now(),guncelleme=now()
 WHERE id=hedef AND sahip_id=p_person AND revizyon_tarihi IS NULL AND durum='yayinda' AND bitis>now();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='YA023',MESSAGE='revizyon_kapali';END IF;
 RETURN hedef;
END $$;
-- migrate:down
DROP FUNCTION yarenler_duyuru_yetkinlik(uuid,uuid,uuid[]),yarenler_duyuru_ilgi_durumu(uuid,text),yarenler_duyuru_ilgi(uuid,text,boolean),yarenler_duyuru_ilgilenenler(uuid),yarenler_ilgi_temizle();
DROP TABLE announcement_interest,announcement_interest_usage,announcement_skill;
