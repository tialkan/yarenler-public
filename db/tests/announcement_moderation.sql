-- Göç 0016: duyuru denetimi. Günde üç deneme ('hata' hakkı tüketmez, bekleyen deneme ikinciyi kapatır, çökmüş deneme
-- 3 dakikada düşer), günde bir yayın (silme hakkı açmaz), her ret ve ağır ihlal için ihlal kaydı (IP, User-Agent),
-- ağır ihlalde 7 gün yasak ve alan ekleme kapanması, yönetici duyuru yasağı (gerekçe zorunlu), kişi ve ORCID düzeyinde
-- süreli ya da süresiz platform yasağı, saklama temizliği. Eşzamanlılık apps/web/tests/announcement-limit-db.test.mjs'de.
-- Her şey geri alınır.
BEGIN;
DO $$
DECLARE inst uuid := uuidv7(); p1 uuid := uuidv7(); p2 uuid := uuidv7(); p3 uuid := uuidv7(); p4 uuid := uuidv7(); p5 uuid := uuidv7();
        d uuid; ann uuid; j jsonb; hata text; detay text; e uuid;
BEGIN
    INSERT INTO institution(id, kisa_ad, ad, ulke) VALUES (inst, 'ci-denetim', 'Test Üniversitesi', 'TR');
    INSERT INTO person(id, kisa_kimlik, institution_id, ad, soyad, gorunen_ad, orcid) VALUES
        (p1, 'cidnt01', inst, 'A', 'B', 'A B', '0000-0000-0000-1100'), (p2, 'cidnt02', inst, 'C', 'D', 'C D', '0000-0000-0000-108X'),
        (p3, 'cidnt03', inst, 'E', 'F', 'E F', '0000-0000-0000-1055'), (p4, 'cidnt04', inst, 'G', 'H', 'G H', '0000-0000-0000-116X'),
        (p5, 'cidnt05', inst, 'I', 'J', 'I J', NULL);

    -- 'hata' sayılmaz; ret bir deneme tüketir ve ihlal kaydı yazar; dördüncü deneme YA023.
    d := yarenler_duyuru_deneme_baslat(p1);
    IF NOT (yarenler_duyuru_durumu(p1)->>'hak_kullanildi')::boolean THEN RAISE EXCEPTION 'bekleyen deneme hakkı tutmuyor'; END IF;
    BEGIN PERFORM yarenler_duyuru_deneme_baslat(p1); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA023' THEN hata := 'YA023'; END;
    IF hata IS DISTINCT FROM 'YA023' THEN RAISE EXCEPTION 'bekleyen denemenin yanında ikinci deneme açıldı'; END IF;
    j := yarenler_duyuru_denetim_sonucu(d, p1, 'hata', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 7);
    IF (yarenler_duyuru_durumu(p1)->>'hak_kullanildi')::boolean THEN RAISE EXCEPTION 'hata hakkı tüketti'; END IF;
    d := yarenler_duyuru_deneme_baslat(p1);
    j := yarenler_duyuru_denetim_sonucu(d, p1, 'ret', 'akademik_degil', 'Akademik işbirliğiyle ilgili değil.', NULL, 'Satılık araba', 'm',
                                        '198.51.100.7'::inet, 'Firefox 131 · Linux', 7);
    IF j->'yasak' <> 'null'::jsonb OR j->>'ihlal' IS NULL THEN RAISE EXCEPTION 'ret sonucu: %', j; END IF;
    PERFORM 1 FROM icerik_ihlali WHERE id = (j->>'ihlal')::uuid AND karar = 'ret' AND kategori = 'akademik_degil' AND ip IS NULL
       AND user_agent IS NULL AND metin IS NULL AND kurum IS NULL AND orcid IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'ret ihlal kaydı eksik'; END IF;
    IF EXISTS (SELECT 1 FROM duyuru_yasagi WHERE person_id = p1) THEN RAISE EXCEPTION 'ret yasak verdi'; END IF;
    IF (yarenler_duyuru_durumu(p1)->>'hak_kullanildi')::boolean THEN RAISE EXCEPTION 'ilk ret günlük hakkı kapattı'; END IF;
    d := yarenler_duyuru_deneme_baslat(p1);
    j := yarenler_duyuru_denetim_sonucu(d, p1, 'ret', 'akademik_degil', 'İkinci ret.', NULL, 'Test metni', 'm', NULL, NULL, 7);

    IF NOT (yarenler_duyuru_durumu(p1)->>'hak_kullanildi')::boolean THEN RAISE EXCEPTION 'ikinci ret günlük hakkı kapatmadı'; END IF;
    BEGIN PERFORM yarenler_duyuru_deneme_baslat(p1); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA023' THEN hata := 'YA023'; END;
    IF hata IS DISTINCT FROM 'YA023' THEN RAISE EXCEPTION 'dördüncü deneme açıldı'; END IF;
    BEGIN PERFORM yarenler_duyuru_denetim_sonucu(d, p1, 'ret', 'akademik_degil', 'x', NULL, NULL, NULL, NULL, NULL, 7); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA025' THEN hata := 'YA025'; END;
    IF hata IS DISTINCT FROM 'YA025' THEN RAISE EXCEPTION 'sonuçlanmış deneme yeniden sonuçlandı'; END IF;

    -- Önceki günün üç reddi yeni günün hakkını kapatmaz.
    UPDATE duyuru_denemesi SET gun = yarenler_bugun() - 1 WHERE person_id = p1;
    IF (yarenler_duyuru_durumu(p1)->>'hak_kullanildi')::boolean THEN RAISE EXCEPTION 'önceki gün hakkı kapattı'; END IF;
    e := yarenler_duyuru_deneme_baslat(p1);
    j := yarenler_duyuru_denetim_sonucu(e, p1, 'hata', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 7);

    -- Çökmüş süreçten kalan 'baslatildi' 3 dakika sonra hakkı bırakır.
    d := yarenler_duyuru_deneme_baslat(p4);
    UPDATE duyuru_denemesi SET olusturma = now() - interval '4 minutes' WHERE id = d;
    e := yarenler_duyuru_deneme_baslat(p4);
    IF (SELECT durum FROM duyuru_denemesi WHERE id = d) <> 'hata' THEN RAISE EXCEPTION 'eski deneme hata sayılmadı'; END IF;
    j := yarenler_duyuru_denetim_sonucu(e, p4, 'hata', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 7);

    -- Kabul: duyuru ve deneme aynı işlemde; günde ikinci duyuru YA023; silmek hakkı açmaz.
    d := yarenler_duyuru_deneme_baslat(p2);
    INSERT INTO announcement(sahip_id, ham_metin, yayin_metni, sure_hafta, bitis)
    VALUES (p2, 'Deneme duyuru metni yirmi karakter', 'Deneme duyuru metni yirmi karakter', 1, now() + interval '1 week') RETURNING id INTO ann;
    j := yarenler_duyuru_denetim_sonucu(d, p2, 'kabul', NULL, NULL, ann, NULL, NULL, NULL, NULL, 7);
    IF EXISTS (SELECT 1 FROM icerik_ihlali WHERE person_id = p2) THEN RAISE EXCEPTION 'kabul ihlal kaydı yazdı'; END IF;
    BEGIN INSERT INTO announcement(sahip_id, ham_metin, yayin_metni, sure_hafta, bitis)
          VALUES (p2, 'İkinci deneme duyurusu yirmi karakter', 'İkinci deneme duyurusu yirmi karakter', 1, now() + interval '1 week'); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA023' THEN hata := 'YA023'; END;
    IF hata IS DISTINCT FROM 'YA023' THEN RAISE EXCEPTION 'günde ikinci duyuru eklendi'; END IF;
    UPDATE announcement SET durum = 'kaldirildi' WHERE id = ann;
    UPDATE duyuru_denemesi SET durum = 'hata' WHERE id = d;  -- deneme olmasa bile yayın satırı hakkı tutar
    BEGIN PERFORM yarenler_duyuru_deneme_baslat(p2); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA023' THEN hata := 'YA023'; END;
    IF hata IS DISTINCT FROM 'YA023' THEN RAISE EXCEPTION 'silinen duyuru günlük hakkı açtı'; END IF;
    BEGIN PERFORM yarenler_duyuru_denetim_sonucu(uuidv7(), p2, 'kabul', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 7); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA025' THEN hata := 'YA025'; END;
    IF hata IS DISTINCT FROM 'YA025' THEN RAISE EXCEPTION 'duyurusuz kabul geçti'; END IF;

    -- Ağır ihlal: ihlal kaydı, 7 gün yasak; deneme YA022 (bitiş ayrıntıda); alan ekleme YA004; duyuru eklemesi YA022.
    d := yarenler_duyuru_deneme_baslat(p3);
    j := yarenler_duyuru_denetim_sonucu(d, p3, 'agir_ihlal', 'hakaret', 'Hakaret içeriyor.', NULL, 'Ağır ihlal metni', 'anthropic/claude-haiku-5.5',
                                        '203.0.113.9'::inet, 'Chrome 130 · Windows', 7);
    IF j->'yasak'->>'neden' IS DISTINCT FROM 'agir_ihlal' THEN RAISE EXCEPTION 'ağır ihlal yasağı yok: %', j; END IF;
    PERFORM 1 FROM icerik_ihlali WHERE person_id = p3 AND karar = 'agir_ihlal' AND kategori = 'hakaret' AND ip = '203.0.113.9'::inet;
    IF NOT FOUND THEN RAISE EXCEPTION 'ağır ihlal kaydı eksik'; END IF;
    IF (SELECT bitis FROM duyuru_yasagi WHERE person_id = p3) NOT BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute' THEN RAISE EXCEPTION 'yasak 7 gün değil'; END IF;
    BEGIN PERFORM yarenler_duyuru_deneme_baslat(p3); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA022' THEN hata := 'YA022'; GET STACKED DIAGNOSTICS detay = PG_EXCEPTION_DETAIL; END;
    IF hata IS DISTINCT FROM 'YA022' OR detay !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$' THEN RAISE EXCEPTION 'yasaklı kişi deneme başlattı (%, %)', hata, detay; END IF;
    IF NOT yarenler_kisitli(p3, 'alan') OR NOT yarenler_kisitli(p3, 'duyuru') THEN RAISE EXCEPTION 'yasak alan eklemeyi kapatmıyor'; END IF;
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad) VALUES (p3, 'deneme yasakli', 'alan', 'denetlenmedi', 'yeni', 'Deneme Yasaklı') RETURNING id INTO e;
    BEGIN PERFORM yarenler_alan_ekle(e, p3, 'yeni', NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA004' THEN hata := 'YA004'; END;
    IF hata IS DISTINCT FROM 'YA004' THEN RAISE EXCEPTION 'yasaklı kişi alan ekledi'; END IF;
    BEGIN INSERT INTO announcement(sahip_id, ham_metin, yayin_metni, sure_hafta, bitis)
          VALUES (p3, 'Yasaklı kişinin duyurusu yirmi karakter', 'Yasaklı kişinin duyurusu yirmi karakter', 1, now() + interval '1 week'); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA022' THEN hata := 'YA022'; END;
    IF hata IS DISTINCT FROM 'YA022' THEN RAISE EXCEPTION 'yasaklı kişi duyuru ekledi'; END IF;

    -- Yönetici duyuru yasağı: gerekçe zorunlu; 'ver' süreyi ayarlar, 'kaldir' kaldırır.
    BEGIN PERFORM yarenler_yonetici_duyuru_yasagi(p3, 'kaldir', NULL, ''); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA027' THEN hata := 'YA027'; END;
    IF hata IS DISTINCT FROM 'YA027' THEN RAISE EXCEPTION 'gerekçesiz kaldırma geçti'; END IF;
    j := yarenler_yonetici_duyuru_yasagi(p3, 'ver', 2, 'İtiraz incelendi, süre kısaltıldı.');
    IF (j->'sonra'->>'bitis')::timestamptz > now() + interval '2 days 1 minute' OR j->'sonra'->>'neden' <> 'agir_ihlal' THEN RAISE EXCEPTION 'süre ayarlanmadı: %', j; END IF;
    j := yarenler_yonetici_duyuru_yasagi(p3, 'kaldir', NULL, 'Yanlış karar.');
    IF yarenler_kisitli(p3, 'duyuru') THEN RAISE EXCEPTION 'kaldırılan yasak sürüyor'; END IF;
    j := yarenler_yonetici_duyuru_yasagi(p4, 'ver', 5, 'Tekrarlanan reklam.');
    IF j->'sonra'->>'neden' <> 'yonetici' OR NOT yarenler_kisitli(p4, 'duyuru') THEN RAISE EXCEPTION 'yönetici yasağı açılmadı: %', j; END IF;
    BEGIN PERFORM yarenler_yonetici_duyuru_yasagi(p4, 'ver', 0, 'Geçersiz süre.'); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA027' THEN hata := 'YA027'; END;
    IF hata IS DISTINCT FROM 'YA027' THEN RAISE EXCEPTION '0 gün kabul edildi'; END IF;

    -- Platform yasağı kişiyle (süresiz, profil gizli): oturum silinir, duyuru kaldırılır, ORCID de kapanır.
    INSERT INTO orcid_session(belirtec_ozeti, orcid, gorunen_ad, person_id, bitis) VALUES (sha256('ci-oturum'::bytea), '0000-0000-0000-108X', 'C D', p2, now() + interval '1 day');
    UPDATE announcement SET durum = 'yayinda' WHERE id = ann;
    j := yarenler_yonetici_platform_yasagi(p2, NULL, true, NULL, 'Ağır ve tekrarlanan ihlal.', true);
    IF (j->'sonra'->>'kaldirilan_duyuru')::int <> 1 OR NOT (j->'sonra'->>'profil_gizlendi')::boolean OR j->>'orcid' <> '0000-0000-0000-108X' THEN RAISE EXCEPTION 'platform yasağı: %', j; END IF;
    IF EXISTS (SELECT 1 FROM orcid_session WHERE person_id = p2) THEN RAISE EXCEPTION 'oturum silinmedi'; END IF;
    IF (SELECT aktif FROM person WHERE id = p2) THEN RAISE EXCEPTION 'profil gizlenmedi'; END IF;
    IF NOT yarenler_orcid_yasakli('0000-0000-0000-108X') OR yarenler_platform_yasagi(p2, NULL) IS NULL THEN RAISE EXCEPTION 'yasak görünmüyor'; END IF;
    IF NOT yarenler_kisitli(p2, 'alan') THEN RAISE EXCEPTION 'platform yasağı alan eklemeyi kapatmıyor'; END IF;
    BEGIN PERFORM yarenler_yonetici_platform_yasagi(NULL, '0000-0000-0000-108X', true, NULL, 'İkinci kez.', false); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA027' THEN hata := 'YA027'; GET STACKED DIAGNOSTICS detay = MESSAGE_TEXT; END;
    IF hata IS DISTINCT FROM 'YA027' OR detay <> 'zaten_yasakli' THEN RAISE EXCEPTION 'aynı kişi iki kez yasaklandı'; END IF;
    BEGIN PERFORM yarenler_yonetici_platform_yasagi(p2, NULL, false, NULL, '', false); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA027' THEN hata := 'YA027'; END;
    IF hata IS DISTINCT FROM 'YA027' THEN RAISE EXCEPTION 'gerekçesiz platform kaldırma geçti'; END IF;
    j := yarenler_yonetici_platform_yasagi(NULL, '0000-0000-0000-108X', false, NULL, 'İtiraz kabul edildi.', false);
    IF NOT (SELECT aktif FROM person WHERE id = p2) OR yarenler_orcid_yasakli('0000-0000-0000-108X') THEN RAISE EXCEPTION 'platform yasağı kaldırılmadı'; END IF;

    -- Yalnız ORCID (profil yok): giriş ve kayıt kapanır.
    j := yarenler_yonetici_platform_yasagi(NULL, '0000-0000-0000-1143', true, 30, 'Sahte hesap.', false);
    IF NOT yarenler_orcid_yasakli('0000-0000-0000-1143') THEN RAISE EXCEPTION 'ORCID yasağı görünmüyor'; END IF;
    -- ORCID'siz profil yasağı, profil sonra bir ORCID'e bağlanınca o ORCID'i de kapatır.
    j := yarenler_yonetici_platform_yasagi(p5, NULL, true, 10, 'Profil üzerinden yasak.', false);
    UPDATE person SET orcid = '0000-0000-0000-1047' WHERE id = p5;
    IF NOT yarenler_orcid_yasakli('0000-0000-0000-1047') THEN RAISE EXCEPTION 'kişi yasağı ORCID ile görünmüyor'; END IF;
    -- Süresi geçmiş süreli yasak etkin değildir; yeniden yasaklanabilir.
    UPDATE platform_yasagi SET olusturma = now() - interval '20 days', bitis = now() - interval '1 day' WHERE person_id = p5;
    IF yarenler_platform_yasagi(p5, NULL) IS NOT NULL THEN RAISE EXCEPTION 'süresi geçmiş yasak sürüyor'; END IF;
    j := yarenler_yonetici_platform_yasagi(p5, NULL, true, NULL, 'Yeniden yasak.', false);
    IF yarenler_platform_yasagi(p5, NULL)->>'bitis' IS NOT NULL THEN RAISE EXCEPTION 'süresiz yasak bitiş taşıyor'; END IF;
    BEGIN PERFORM yarenler_duyuru_deneme_baslat(p5); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA021' THEN hata := 'YA021'; END;
    IF hata IS DISTINCT FROM 'YA021' THEN RAISE EXCEPTION 'platform yasaklı kişi deneme başlattı'; END IF;

    -- Saklama: 180 günden eski ihlal ve deneme silinir, yenisi kalır.
    UPDATE icerik_ihlali SET olusturma = now() - interval '181 days' WHERE person_id = p1;
    UPDATE duyuru_denemesi SET olusturma = now() - interval '181 days' WHERE person_id = p4;
    PERFORM yarenler_ihlal_temizle(180);
    IF EXISTS (SELECT 1 FROM icerik_ihlali WHERE person_id = p1) OR EXISTS (SELECT 1 FROM duyuru_denemesi WHERE person_id = p4) THEN RAISE EXCEPTION 'eski kayıt silinmedi'; END IF;
    IF NOT EXISTS (SELECT 1 FROM icerik_ihlali WHERE person_id = p3) THEN RAISE EXCEPTION 'yeni kayıt silindi'; END IF;
    RAISE NOTICE 'announcement_moderation: tamam';
END $$;
ROLLBACK;
