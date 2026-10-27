-- migrate:up
ALTER TABLE announcement ADD COLUMN revizyon_tarihi timestamptz;
ALTER TABLE duyuru_denemesi ADD COLUMN revizyon_hedef uuid REFERENCES announcement(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION yarenler_duyuru_deneme_siniri() RETURNS integer LANGUAGE sql IMMUTABLE RETURN 2;
CREATE OR REPLACE FUNCTION yarenler_duyuru_durumu(p_person uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    RETURN jsonb_build_object(
        'platform', yarenler_platform_yasagi(p_person, NULL),
        'yasak', (SELECT jsonb_build_object('bitis', y.bitis, 'neden', y.neden, 'kategori', y.kategori)
                    FROM duyuru_yasagi y WHERE y.person_id = p_person AND y.bitis > now()),
        'kisitli', coalesce((SELECT k.duyuru FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false),
        'kisitli_alan', coalesce((SELECT k.alan_ekleme FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false),
        'hak_kullanildi', EXISTS (SELECT 1 FROM duyuru_gunluk_yayin g WHERE g.person_id = p_person AND g.gun = yarenler_bugun())
                       OR (SELECT count(*) >= yarenler_duyuru_deneme_siniri() FROM duyuru_denemesi d
                            WHERE d.person_id = p_person AND d.gun = yarenler_bugun() AND d.durum IN ('kabul', 'ret', 'agir_ihlal'))
                       OR EXISTS (SELECT 1 FROM duyuru_denemesi d WHERE d.person_id = p_person AND d.gun = yarenler_bugun()
                                    AND d.durum = 'baslatildi' AND d.olusturma > now() - interval '3 minutes'));

CREATE FUNCTION yarenler_duyuru_onceki_deneme(p_person uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT count(*)::int FROM duyuru_denemesi WHERE person_id=p_person AND gun=yarenler_bugun() AND durum IN ('kabul','ret','agir_ihlal')
$$;
CREATE FUNCTION yarenler_duyuru_revizyon_acik(p_person uuid,p_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM announcement a WHERE a.id=p_id AND a.sahip_id=p_person AND a.durum='yayinda' AND a.bitis>now() AND a.revizyon_tarihi IS NULL)
 AND NOT EXISTS(SELECT 1 FROM duyuru_denemesi d WHERE d.person_id=p_person AND d.revizyon_hedef=p_id AND d.durum IN ('kabul','ret','agir_ihlal'))
$$;
REVOKE ALL ON FUNCTION yarenler_duyuru_onceki_deneme(uuid),yarenler_duyuru_revizyon_acik(uuid,uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION yarenler_duyuru_rezervasyon(p_person uuid,p_hedef uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bitis timestamptz; v_platform jsonb; v_id uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('yarenler_duyuru:' || p_person::text, 0));
    v_platform := yarenler_platform_yasagi(p_person, NULL);
    IF v_platform IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'YA021', MESSAGE = 'platform_yasagi', DETAIL = coalesce(v_platform->>'bitis', '');
    END IF;
    SELECT bitis INTO v_bitis FROM duyuru_yasagi WHERE person_id = p_person AND bitis > now();
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA022', MESSAGE = 'duyuru_yasagi', DETAIL = yarenler_iso(v_bitis);
    END IF;
    IF coalesce((SELECT k.duyuru FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false) THEN
        RAISE EXCEPTION USING ERRCODE = 'YA005', MESSAGE = 'duyuru_kisitli';
    END IF;
    IF p_hedef IS NOT NULL AND NOT yarenler_duyuru_revizyon_acik(p_person,p_hedef) THEN
        RAISE EXCEPTION USING ERRCODE='YA023',MESSAGE='revizyon_kapali';
    END IF;
    IF p_hedef IS NULL AND EXISTS (SELECT 1 FROM duyuru_gunluk_yayin WHERE person_id = p_person AND gun = yarenler_bugun()) THEN
        RAISE EXCEPTION USING ERRCODE = 'YA023', MESSAGE = 'gunluk_sinir';
    END IF;
    -- Çökmüş süreçten kalan deneme hakkı tutmasın.
    UPDATE duyuru_denemesi SET durum = 'hata', sonuclanma = now()
     WHERE person_id = p_person AND durum = 'baslatildi' AND olusturma < now() - interval '3 minutes';
    IF (SELECT count(*) FROM duyuru_denemesi WHERE person_id = p_person AND gun = yarenler_bugun()
           AND durum IN ('kabul', 'ret', 'agir_ihlal')) >= yarenler_duyuru_deneme_siniri() THEN
        RAISE EXCEPTION USING ERRCODE = 'YA023', MESSAGE = 'gunluk_sinir';
    END IF;
    BEGIN
        INSERT INTO duyuru_denemesi (person_id, gun,revizyon_hedef) VALUES (p_person, yarenler_bugun(),p_hedef) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'YA023', MESSAGE = 'gunluk_sinir';
    END;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION yarenler_duyuru_deneme_baslat(p_person uuid) RETURNS uuid
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS 'SELECT yarenler_duyuru_rezervasyon(p_person,NULL)';
CREATE FUNCTION yarenler_duyuru_revize(p_deneme uuid,p_person uuid,p_metin text,p_kaynak jsonb,p_kavram text[]) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE hedef uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('yarenler_duyuru:'||p_person::text,0));
 SELECT revizyon_hedef INTO hedef FROM duyuru_denemesi WHERE id=p_deneme AND person_id=p_person AND durum='baslatildi';
 IF hedef IS NULL THEN RAISE EXCEPTION USING ERRCODE='YA025',MESSAGE='revizyon_deneme';END IF;
 UPDATE announcement SET yayin_metni=p_metin,kaynaklar=p_kaynak,anahtar_kelimeler=p_kavram,revizyon_tarihi=now(),guncelleme=now()
 WHERE id=hedef AND sahip_id=p_person AND revizyon_tarihi IS NULL AND durum='yayinda' AND bitis>now();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='YA023',MESSAGE='revizyon_kapali';END IF;
 RETURN hedef;
END $$;
REVOKE ALL ON FUNCTION yarenler_duyuru_rezervasyon(uuid,uuid),yarenler_duyuru_revize(uuid,uuid,text,jsonb,text[]) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN
 GRANT EXECUTE ON FUNCTION yarenler_duyuru_onceki_deneme(uuid),yarenler_duyuru_revizyon_acik(uuid,uuid),yarenler_duyuru_rezervasyon(uuid,uuid),yarenler_duyuru_revize(uuid,uuid,text,jsonb,text[]) TO yarenler_auth;
 END IF;
END $$;
-- migrate:down
DO $$ BEGIN IF EXISTS(SELECT 1 FROM announcement WHERE revizyon_tarihi IS NOT NULL) THEN RAISE EXCEPTION 'Revision history exists; use a forward migration.';END IF;END $$;
DROP FUNCTION yarenler_duyuru_revize(uuid,uuid,text,jsonb,text[]);
CREATE OR REPLACE FUNCTION yarenler_duyuru_durumu(p_person uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    RETURN jsonb_build_object(
        'platform', yarenler_platform_yasagi(p_person, NULL),
        'yasak', (SELECT jsonb_build_object('bitis', y.bitis, 'neden', y.neden, 'kategori', y.kategori)
                    FROM duyuru_yasagi y WHERE y.person_id = p_person AND y.bitis > now()),
        'kisitli', coalesce((SELECT k.duyuru FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false),
        'kisitli_alan', coalesce((SELECT k.alan_ekleme FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false),
        'hak_kullanildi', EXISTS (SELECT 1 FROM duyuru_gunluk_yayin g WHERE g.person_id = p_person AND g.gun = yarenler_bugun())
                       OR (SELECT count(*) >= yarenler_duyuru_deneme_siniri() FROM duyuru_denemesi d
                            WHERE d.person_id = p_person AND d.gun = yarenler_bugun() AND d.durum IN ('kabul', 'ret', 'agir_ihlal'))
                       OR EXISTS (SELECT 1 FROM duyuru_denemesi d WHERE d.person_id = p_person AND d.gun = yarenler_bugun()
                                    AND d.durum = 'baslatildi' AND d.olusturma > now() - interval '3 minutes'));

CREATE OR REPLACE FUNCTION yarenler_duyuru_deneme_baslat(p_person uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bitis timestamptz; v_platform jsonb; v_id uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('yarenler_duyuru:' || p_person::text, 0));
    v_platform := yarenler_platform_yasagi(p_person, NULL);
    IF v_platform IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'YA021', MESSAGE = 'platform_yasagi', DETAIL = coalesce(v_platform->>'bitis', '');
    END IF;
    SELECT bitis INTO v_bitis FROM duyuru_yasagi WHERE person_id = p_person AND bitis > now();
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA022', MESSAGE = 'duyuru_yasagi', DETAIL = yarenler_iso(v_bitis);
    END IF;
    IF coalesce((SELECT k.duyuru FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false) THEN
        RAISE EXCEPTION USING ERRCODE = 'YA005', MESSAGE = 'duyuru_kisitli';
    END IF;
    IF EXISTS (SELECT 1 FROM duyuru_gunluk_yayin WHERE person_id = p_person AND gun = yarenler_bugun()) THEN
        RAISE EXCEPTION USING ERRCODE = 'YA023', MESSAGE = 'gunluk_sinir';
    END IF;
    -- Çökmüş süreçten kalan deneme hakkı tutmasın.
    UPDATE duyuru_denemesi SET durum = 'hata', sonuclanma = now()
     WHERE person_id = p_person AND durum = 'baslatildi' AND olusturma < now() - interval '3 minutes';
    IF (SELECT count(*) FROM duyuru_denemesi WHERE person_id = p_person AND gun = yarenler_bugun()
           AND durum IN ('kabul', 'ret', 'agir_ihlal')) >= yarenler_duyuru_deneme_siniri() THEN
        RAISE EXCEPTION USING ERRCODE = 'YA023', MESSAGE = 'gunluk_sinir';
    END IF;
    BEGIN
        INSERT INTO duyuru_denemesi (person_id, gun) VALUES (p_person, yarenler_bugun()) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'YA023', MESSAGE = 'gunluk_sinir';
    END;
    RETURN v_id;
END $$;

DROP FUNCTION yarenler_duyuru_rezervasyon(uuid,uuid);
DROP FUNCTION IF EXISTS yarenler_duyuru_onceki_deneme(uuid),yarenler_duyuru_revizyon_acik(uuid,uuid);
ALTER TABLE duyuru_denemesi DROP COLUMN revizyon_hedef;
ALTER TABLE announcement DROP COLUMN revizyon_tarihi;
CREATE OR REPLACE FUNCTION yarenler_duyuru_deneme_siniri() RETURNS integer LANGUAGE sql IMMUTABLE RETURN 3;
