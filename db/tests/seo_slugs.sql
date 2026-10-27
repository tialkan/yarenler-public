-- Göç 0011 bütünlüğü: Türkçe slug, birim çakışması, alan adresinin kanonik değişiminde korunması,
-- sözlükten İngilizce ad. Her şey geri alınır.
BEGIN;
DO $$
DECLARE inst uuid := uuidv7(); fak uuid := uuidv7(); b1 uuid := uuidv7(); b2 uuid := uuidv7();
        p1 uuid := uuidv7(); p2 uuid := uuidv7(); p3 uuid := uuidv7();
        a1 uuid := uuidv7(); a2 uuid := uuidv7(); s text;
BEGIN
    IF yarenler_slug('Ağız, Diş ve Çene Cerrahisi') <> 'agiz-dis-ve-cene-cerrahisi' THEN RAISE EXCEPTION 'slug: %', yarenler_slug('Ağız, Diş ve Çene Cerrahisi'); END IF;
    IF yarenler_slug('IŞIK İŞLEME Üçgen Öğün') <> 'isik-isleme-ucgen-ogun' THEN RAISE EXCEPTION 'slug büyük harf: %', yarenler_slug('IŞIK İŞLEME Üçgen Öğün'); END IF;
    IF yarenler_slug('çok uzun bir başlık deneme', 12) <> 'cok-uzun-bir' THEN RAISE EXCEPTION 'slug kesme: %', yarenler_slug('çok uzun bir başlık deneme', 12); END IF;

    INSERT INTO institution(id, kisa_ad, ad, ulke) VALUES (inst, 'ci-slug-test', 'Test', 'TR');
    INSERT INTO unit(id, institution_id, tur, ad_tr, slug) VALUES (fak, inst, 'fakulte', 'Test Fakültesi Özel', yarenler_birim_slug_yeni('Test Fakültesi Özel'));
    INSERT INTO unit(id, institution_id, ust_id, tur, ad_tr, slug) VALUES (b1, inst, fak, 'bolum', 'Şehir Planlama Özel', yarenler_birim_slug_yeni('Şehir Planlama Özel'));
    INSERT INTO unit(id, institution_id, ust_id, tur, ad_tr, slug) VALUES (b2, inst, b1, 'anabilim_dali', 'Şehir Planlama Özel', yarenler_birim_slug_yeni('Şehir Planlama Özel'));
    IF (SELECT slug FROM unit WHERE id = b1) <> 'sehir-planlama-ozel' OR (SELECT slug FROM unit WHERE id = b2) <> 'sehir-planlama-ozel-2' THEN
        RAISE EXCEPTION 'birim çakışması -2 olmalı';
    END IF;

    INSERT INTO person(id, kisa_kimlik, institution_id, ad, soyad, gorunen_ad) VALUES
        (p1, 'cislug01', inst, 'A', 'B', 'A B'), (p2, 'cislug02', inst, 'C', 'D', 'C D'), (p3, 'cislug03', inst, 'E', 'F', 'E F');
    INSERT INTO research_area(id, ad_tr, normalize_ad, sema) VALUES (a1, 'Özel Deneme Toksikolojisi', yarenler_katla('Özel Deneme Toksikolojisi'), 'avesis');
    INSERT INTO person_research_area(person_id, area_id, kaynak) VALUES (p1, a1, 'avesis');
    INSERT INTO alan_ad_sozlugu(sema, anahtar, ad_tr, ad_en) VALUES ('avesis', yarenler_alan_anahtar('Özel Deneme Toksikolojisi'), 'Özel Deneme Toksikolojisi', 'Special Test Toxicology');
    PERFORM yarenler_alan_kanoniklestir();
    SELECT slug INTO s FROM research_area WHERE id = a1;
    IF s <> 'ozel-deneme-toksikolojisi' THEN RAISE EXCEPTION 'alan slug: %', s; END IF;
    IF (SELECT ad_en FROM research_area WHERE id = a1) <> 'Special Test Toxicology' THEN RAISE EXCEPTION 'sözlükten İngilizce ad gelmedi'; END IF;

    -- Aynı kavram başka sınıflamadan daha çok kişiyle gelir: kanonik satır değişir, adres korunur.
    INSERT INTO research_area(id, ad_tr, normalize_ad, sema) VALUES (a2, 'Deneme Toksikolojisi Özel', yarenler_katla('Deneme Toksikolojisi Özel'), 'wos');
    INSERT INTO person_research_area(person_id, area_id, kaynak) VALUES (p2, a2, 'avesis'), (p3, a2, 'avesis');
    PERFORM yarenler_alan_kanoniklestir();
    IF (SELECT kanonik_id FROM research_area WHERE id = a1) IS DISTINCT FROM a2 THEN RAISE EXCEPTION 'kanonik değişmedi'; END IF;
    IF (SELECT slug FROM research_area WHERE id = a2) IS DISTINCT FROM s THEN RAISE EXCEPTION 'adres yeni kanonik satıra taşınmadı'; END IF;
    IF (SELECT slug FROM research_area WHERE id = a1) IS NOT NULL THEN RAISE EXCEPTION 'eski satırda adres kaldı'; END IF;
    IF (SELECT ad_en FROM research_area WHERE id = a2) <> 'Special Test Toxicology' THEN RAISE EXCEPTION 'kanonik satır İngilizce adı devralmadı'; END IF;

    -- Tekrar çalıştırmak adresleri değiştirmez.
    PERFORM yarenler_alan_kanoniklestir();
    IF (SELECT slug FROM research_area WHERE id = a2) IS DISTINCT FROM s THEN RAISE EXCEPTION 'tekrar çalıştırma adresi değiştirdi'; END IF;

    -- Duyuru kısa kimliği varsayılandan gelir.
    INSERT INTO announcement(sahip_id, ham_metin, yayin_metni, sure_hafta, bitis)
    VALUES (p1, 'Deneme duyurusu metni yirmi karakterden uzun.', 'Deneme duyurusu metni yirmi karakterden uzun.', 1, now() + interval '7 days');
    IF NOT EXISTS (SELECT 1 FROM announcement WHERE sahip_id = p1 AND kisa_kimlik ~ '^[0-9a-f]{10}$') THEN RAISE EXCEPTION 'duyuru kısa kimliği yok'; END IF;
END $$;
ROLLBACK;
