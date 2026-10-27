-- Göç 0012: hocanın serbest metinle eklediği alan. Yeni satır (kaynak, adres, ekleyen, denetim işareti),
-- profile bağlama, aynı anahtarın ikinci kez satır açmaması, eş anlamlı ile birebir bulma, model eşleşmesinin
-- eş anlamlıya dönüşmesi, aday dışı seçim, tek kullanımlık denetim, günlük 10 yeni alan sınırı, ilgi alanı,
-- adres çakışması. Her şey geri alınır.
BEGIN;
DO $$
DECLARE inst uuid := uuidv7(); p1 uuid := uuidv7(); p2 uuid := uuidv7(); katalog uuid := uuidv7();
        d uuid; r record; yeni_id uuid; n integer; hata text;
BEGIN
    INSERT INTO institution(id, kisa_ad, ad, ulke) VALUES (inst, 'ci-alan-test', 'Test', 'TR');
    INSERT INTO person(id, kisa_kimlik, institution_id, ad, soyad, gorunen_ad) VALUES
        (p1, 'cialan01', inst, 'A', 'B', 'A B'), (p2, 'cialan02', inst, 'C', 'D', 'C D');
    INSERT INTO research_area(id, ad_tr, ad_en, normalize_ad, sema, onayli)
    VALUES (katalog, 'Deneme Hücre Biyolojisi', 'Test Cell Biology', yarenler_katla('Deneme Hücre Biyolojisi'), 'avesis', true);
    PERFORM yarenler_alan_kanoniklestir();

    -- Birebir: Türkçe ad, kelime sırası, büyük harf ve İngilizce ad aynı kanonik alana gider.
    IF yarenler_alan_birebir('biyolojisi deneme HÜCRE') IS DISTINCT FROM katalog THEN RAISE EXCEPTION 'birebir: kelime sırası'; END IF;
    IF yarenler_alan_birebir('test cell biology') IS DISTINCT FROM katalog THEN RAISE EXCEPTION 'birebir: İngilizce ad'; END IF;
    IF yarenler_alan_birebir('Deneme Kuantum Biyolojisi') IS NOT NULL THEN RAISE EXCEPTION 'birebir: olmayan alan bulundu'; END IF;
    IF (SELECT kaynak FROM research_area WHERE id = katalog) <> 'katalog' THEN RAISE EXCEPTION 'katalog satırının kaynağı katalog olmalı'; END IF;

    -- Yeni alan: model yazımı düzeltti, karar yeni.
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad, ad_en, adaylar, model)
    VALUES (p1, 'deneme kuantum biyolojsi', 'alan', 'denetlendi', 'yeni', 'Deneme Kuantum Biyolojisi', 'Test Quantum Biology', ARRAY[katalog], 'test') RETURNING id INTO d;
    SELECT * INTO r FROM yarenler_alan_ekle(d, p1, 'yeni', NULL);
    yeni_id := r.sonuc_id;
    IF NOT r.sonuc_yeni OR r.sonuc_ad <> 'Deneme Kuantum Biyolojisi' OR r.sonuc_slug <> 'deneme-kuantum-biyolojisi' THEN RAISE EXCEPTION 'yeni alan sonucu: %', r; END IF;
    PERFORM 1 FROM research_area WHERE id = yeni_id AND kaynak = 'kullanici' AND sema = 'yarenler' AND ekleyen_person_id = p1
        AND ai_denetim = 'denetlendi' AND NOT onayli AND kanonik_id IS NULL AND ad_en = 'Test Quantum Biology' AND ad_en_kaynak = 'yapay_zeka'
        AND normalize_ad = yarenler_katla('Deneme Kuantum Biyolojisi');
    IF NOT FOUND THEN RAISE EXCEPTION 'yeni alan satırı eksik ya da hatalı'; END IF;
    IF NOT EXISTS (SELECT 1 FROM person_research_area WHERE person_id = p1 AND area_id = yeni_id AND kaynak = 'kullanici') THEN RAISE EXCEPTION 'profile bağlanmadı'; END IF;
    IF NOT EXISTS (SELECT 1 FROM person_matching_area WHERE person_id = p1 AND area_id = yeni_id AND NOT interest) THEN RAISE EXCEPTION 'eşleştirme görünümünde yok'; END IF;
    IF NOT EXISTS (SELECT 1 FROM alan_denetimi WHERE id = d AND yeni_alan AND secim = 'yeni' AND sonuc_alan_id = yeni_id AND kullanildi IS NOT NULL) THEN RAISE EXCEPTION 'denetim kaydı güncellenmedi'; END IF;
    IF (SELECT count(*) FROM semantic_refresh_queue WHERE (sahip_turu, sahip_id) IN (('area', yeni_id), ('person', p1))) <> 2 THEN RAISE EXCEPTION 'anlamsal vektör işareti yok'; END IF;
    IF NOT EXISTS (SELECT 1 FROM profile_field_review WHERE person_id = p1) THEN RAISE EXCEPTION 'profil incelemesi işaretlenmedi'; END IF;
    -- Hocanın yazdığı hatalı biçim eş anlamlı oldu: bir dahaki sefere yapay zekâya gidilmez.
    IF yarenler_alan_birebir('Deneme Kuantum Biyolojsi') IS DISTINCT FROM yeni_id THEN RAISE EXCEPTION 'girdi eş anlamlı olmadı'; END IF;
    IF yarenler_alan_birebir('test quantum biology') IS DISTINCT FROM yeni_id THEN RAISE EXCEPTION 'İngilizce ad birebir bulunmuyor'; END IF;

    -- Denetim tek kullanımlıktır.
    BEGIN PERFORM yarenler_alan_ekle(d, p1, 'yeni', NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA001' THEN hata := 'YA001'; END;
    IF hata IS DISTINCT FROM 'YA001' THEN RAISE EXCEPTION 'denetim ikinci kez kullanıldı'; END IF;
    -- Başkasının denetimi kullanılamaz.
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad) VALUES (p1, 'x alanı', 'alan', 'denetlenmedi', 'yeni', 'X Alanı') RETURNING id INTO d;
    BEGIN PERFORM yarenler_alan_ekle(d, p2, 'yeni', NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA001' THEN hata := 'YA001'; END;
    IF hata IS DISTINCT FROM 'YA001' THEN RAISE EXCEPTION 'başkasının denetimi kullanıldı'; END IF;

    -- İkinci hoca aynı anahtarı başka biçimde ekler: yeni satır açılmaz, mevcut alan bağlanır.
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad)
    VALUES (p2, 'BİYOLOJİSİ kuantum deneme', 'alan', 'denetlenmedi', 'yeni', 'Biyolojisi Kuantum Deneme') RETURNING id INTO d;
    SELECT * INTO r FROM yarenler_alan_ekle(d, p2, 'yeni', NULL);
    IF r.sonuc_id IS DISTINCT FROM yeni_id OR r.sonuc_yeni THEN RAISE EXCEPTION 'aynı anahtar ikinci satır açtı: %', r; END IF;
    IF (SELECT count(*) FROM research_area WHERE kaynak = 'kullanici' AND yarenler_alan_anahtar(coalesce(ad_tr, ad_en)) = yarenler_alan_anahtar('Deneme Kuantum Biyolojisi')) <> 1 THEN RAISE EXCEPTION 'çift kullanıcı alanı'; END IF;
    IF NOT EXISTS (SELECT 1 FROM person_research_area WHERE person_id = p2 AND area_id = yeni_id) THEN RAISE EXCEPTION 'ikinci hocaya bağlanmadı'; END IF;

    -- Benzersiz indeks: aynı anahtarla doğrudan ikinci kullanıcı satırı reddedilir.
    BEGIN
        INSERT INTO research_area(ad_tr, normalize_ad, sema, kaynak, ai_denetim) VALUES ('Kuantum Biyolojisi Deneme', yarenler_katla('Kuantum Biyolojisi Deneme'), 'yarenler', 'kullanici', 'denetlenmedi');
        hata := NULL;
    EXCEPTION WHEN unique_violation THEN hata := 'unique';
    END;
    IF hata IS DISTINCT FROM 'unique' THEN RAISE EXCEPTION 'aynı anahtarla ikinci kullanıcı alanı açıldı'; END IF;

    -- Model "mevcut" dedi ve hoca onayladı: girdi o alanın eş anlamlısı olur.
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad, mevcut_alan_id, adaylar)
    VALUES (p2, 'Deneme Sitoloji', 'ilgi', 'denetlendi', 'mevcut', 'Deneme Sitoloji', katalog, ARRAY[katalog, yeni_id]) RETURNING id INTO d;
    SELECT * INTO r FROM yarenler_alan_ekle(d, p2, 'mevcut', katalog);
    IF r.sonuc_id IS DISTINCT FROM katalog OR r.sonuc_yeni THEN RAISE EXCEPTION 'mevcut seçimi: %', r; END IF;
    IF yarenler_alan_birebir('deneme sitoloji') IS DISTINCT FROM katalog THEN RAISE EXCEPTION 'model eşleşmesi eş anlamlıya yazılmadı'; END IF;
    IF NOT EXISTS (SELECT 1 FROM person_collaboration_area WHERE person_id = p2 AND area_id = katalog) THEN RAISE EXCEPTION 'ilgi alanına bağlanmadı'; END IF;
    IF EXISTS (SELECT 1 FROM person_research_area WHERE person_id = p2 AND area_id = katalog) THEN RAISE EXCEPTION 'ilgi uzmanlık olarak bağlandı'; END IF;

    -- Gösterilmemiş bir alan seçilemez.
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad, adaylar)
    VALUES (p1, 'deneme y', 'alan', 'denetlendi', 'yeni', 'Deneme Y', ARRAY[katalog]) RETURNING id INTO d;
    BEGIN PERFORM yarenler_alan_ekle(d, p1, 'mevcut', yeni_id); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA002' THEN hata := 'YA002'; END;
    IF hata IS DISTINCT FROM 'YA002' THEN RAISE EXCEPTION 'aday dışı alan bağlandı'; END IF;

    -- Adres çakışması: aynı taban adres başka satırdaysa kısa özet eklenir.
    UPDATE research_area SET slug = 'deneme-plazma-fizigi' WHERE id = katalog;
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad)
    VALUES (p1, 'deneme plazma fiziği', 'alan', 'denetlenmedi', 'yeni', 'Deneme Plazma Fiziği') RETURNING id INTO d;
    SELECT * INTO r FROM yarenler_alan_ekle(d, p1, 'yeni', NULL);
    IF r.sonuc_slug !~ '^deneme-plazma-fizigi-[0-9a-f]{6}$' THEN RAISE EXCEPTION 'adres çakışması: %', r.sonuc_slug; END IF;
    IF (SELECT ai_denetim FROM research_area WHERE id = r.sonuc_id) <> 'denetlenmedi' THEN RAISE EXCEPTION 'denetlenmedi işareti yok'; END IF;
    -- Denetlenmeyen girdi eş anlamlı olarak yazılmaz.
    IF EXISTS (SELECT 1 FROM research_area_synonym WHERE area_id = r.sonuc_id) THEN RAISE EXCEPTION 'denetlenmeyen girdi eş anlamlı oldu'; END IF;

    -- Günlük sınır: p1 bugün 2 yeni alan ekledi; 8 tane daha eklenebilir, 11. reddedilir.
    FOR n IN 1..8 LOOP
        INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad)
        VALUES (p1, 'deneme sınır ' || n, 'alan', 'denetlenmedi', 'yeni', 'Deneme Sınır Alanı ' || chr(64 + n)) RETURNING id INTO d;
        SELECT * INTO r FROM yarenler_alan_ekle(d, p1, 'yeni', NULL);
        IF NOT r.sonuc_yeni THEN RAISE EXCEPTION 'sınır altı ekleme yeni değil: %', n; END IF;
    END LOOP;
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad)
    VALUES (p1, 'deneme sınır 11', 'alan', 'denetlenmedi', 'yeni', 'Deneme Sınır Alanı Z') RETURNING id INTO d;
    BEGIN PERFORM yarenler_alan_ekle(d, p1, 'yeni', NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA003' THEN hata := 'YA003'; END;
    IF hata IS DISTINCT FROM 'YA003' THEN RAISE EXCEPTION 'günlük 10 yeni alan sınırı çalışmadı'; END IF;
    -- Sınır yalnız yeni alanlar için: mevcut alan bağlamak serbest.
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad, mevcut_alan_id, adaylar)
    VALUES (p1, 'Deneme Hücre Biyolojisi', 'alan', 'birebir', 'mevcut', NULL, katalog, ARRAY[katalog]) RETURNING id INTO d;
    SELECT * INTO r FROM yarenler_alan_ekle(d, p1, 'mevcut', katalog);
    IF r.sonuc_id IS DISTINCT FROM katalog THEN RAISE EXCEPTION 'sınırdayken mevcut alan bağlanamadı'; END IF;

    -- Kanonikleştirme kullanıcı alanlarını korur (tekrar çalıştırma adresi ve satırı değiştirmez).
    PERFORM yarenler_alan_kanoniklestir();
    IF (SELECT slug FROM research_area WHERE id = yeni_id) <> 'deneme-kuantum-biyolojisi' OR (SELECT kanonik_id FROM research_area WHERE id = yeni_id) IS NOT NULL THEN
        RAISE EXCEPTION 'kanonikleştirme kullanıcı alanını değiştirdi';
    END IF;
END $$;
ROLLBACK;
