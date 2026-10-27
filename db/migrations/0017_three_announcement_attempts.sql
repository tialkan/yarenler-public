-- Günde bir yayın, en çok üç sonuçlanmış deneme. Teknik hata sayılmaz.
-- Kişi kilidi sayacı sıraya alır; benzersiz dizin yalnız aynı gün bekleyen ikinci isteği engeller.
-- 0016 değiştirilmez: daha önce uygulanmış veritabanları da ileri göçle güncellenir.
-- migrate:up
CREATE FUNCTION yarenler_duyuru_deneme_siniri() RETURNS integer
    LANGUAGE sql IMMUTABLE RETURN 3;
DROP INDEX duyuru_denemesi_gunluk;
CREATE UNIQUE INDEX duyuru_denemesi_gunluk ON duyuru_denemesi (person_id, gun) WHERE durum = 'baslatildi';

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
-- migrate:down
-- Tek deneme kuralına dönüş, bir günde birden çok sonuç varsa veri silmeden yapılamaz.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM duyuru_denemesi WHERE durum <> 'hata' GROUP BY person_id, gun HAVING count(*) > 1) THEN
        RAISE EXCEPTION '0017 geri alınamaz: aynı günde birden çok deneme var; kayıtları silmeden ileri düzeltme uygulayın.';
    END IF;
END $$;
DROP INDEX duyuru_denemesi_gunluk;
CREATE UNIQUE INDEX duyuru_denemesi_gunluk ON duyuru_denemesi (person_id, gun) WHERE durum <> 'hata';
CREATE OR REPLACE FUNCTION yarenler_duyuru_durumu(p_person uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    RETURN jsonb_build_object(
        'platform', yarenler_platform_yasagi(p_person, NULL),
        'yasak', (SELECT jsonb_build_object('bitis', y.bitis, 'neden', y.neden, 'kategori', y.kategori)
                    FROM duyuru_yasagi y WHERE y.person_id = p_person AND y.bitis > now()),
        'kisitli', coalesce((SELECT k.duyuru FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false),
        'kisitli_alan', coalesce((SELECT k.alan_ekleme FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false),
        'hak_kullanildi', EXISTS (SELECT 1 FROM duyuru_gunluk_yayin g WHERE g.person_id = p_person AND g.gun = yarenler_bugun())
                       OR EXISTS (SELECT 1 FROM duyuru_denemesi d WHERE d.person_id = p_person AND d.gun = yarenler_bugun()
                                     AND (d.durum IN ('kabul', 'ret', 'agir_ihlal')
                                          OR (d.durum = 'baslatildi' AND d.olusturma > now() - interval '3 minutes'))));
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
    BEGIN
        INSERT INTO duyuru_denemesi (person_id, gun) VALUES (p_person, yarenler_bugun()) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'YA023', MESSAGE = 'gunluk_sinir';
    END;
    RETURN v_id;
END $$;
DROP FUNCTION yarenler_duyuru_deneme_siniri();
