-- Göç 0014: yönetici paneli işlevleri. Doğrudan alan ekleme ve ad çakışması, düzenleme (adres değişimi,
-- eski adres, eski adın eş anlamlı olması, grup üyelerinin alanda kalması), birleştirme (kullanıcı alanı
-- taşınır ve silinir, katalog alanı kalıcı olarak bağlanır ve kanonikleştirmeden sonra da bağlı kalır),
-- silme kuralları, duyuru kaldırma/geri alma/uzatma, profil gizleme, kısıtlama (alan ekleme ve duyuru),
-- onay işareti, başlık düzeni, sahiplenme talebi (onay: ORCID bağlanır, kanıt 'yonetici'; ret; çakışmalar).
-- Her şey geri alınır.
BEGIN;
DO $$
DECLARE inst uuid := uuidv7(); p1 uuid := uuidv7(); p2 uuid := uuidv7(); p3 uuid := uuidv7();
        kat_a uuid := uuidv7(); kat_a2 uuid := uuidv7(); kat_b uuid := uuidv7(); kul uuid := uuidv7();
        yon uuid; j jsonb; hata text; d uuid; ann uuid; talep uuid; talep2 uuid; talep3 uuid; eski_slug text; p4 uuid := uuidv7();
BEGIN
    INSERT INTO institution(id, kisa_ad, ad, ulke) VALUES (inst, 'ci-yonetici', 'Test', 'TR');
    INSERT INTO person(id, kisa_kimlik, institution_id, ad, soyad, gorunen_ad) VALUES
        (p1, 'ciyon01', inst, 'A', 'B', 'A B'), (p2, 'ciyon02', inst, 'C', 'D', 'C D'), (p3, 'ciyon03', inst, 'E', 'F', 'E F');
    -- İki kaynakta aynı kavram (avesis + wos) ve ayrı bir katalog alanı.
    INSERT INTO research_area(id, ad_tr, normalize_ad, sema, onayli) VALUES
        (kat_a, 'Deneme Doku Mühendisliği', yarenler_katla('Deneme Doku Mühendisliği'), 'avesis', true),
        (kat_a2, 'Deneme Doku Mühendisliği', yarenler_katla('Deneme Doku Mühendisliği'), 'wos', true),
        (kat_b, 'Deneme Biyomalzemeler', yarenler_katla('Deneme Biyomalzemeler'), 'avesis', true);
    INSERT INTO research_area(id, ad_tr, normalize_ad, sema, onayli, kaynak, ekleyen_person_id, ai_denetim)
    VALUES (kul, 'Deneme Biyo Malzeme Bilimi', yarenler_katla('Deneme Biyo Malzeme Bilimi'), 'yarenler', false, 'kullanici', p1, 'denetlenmedi');
    INSERT INTO person_research_area(person_id, area_id, kaynak) VALUES
        (p1, kat_a, 'avesis'), (p2, kat_a2, 'avesis'), (p1, kul, 'kullanici'), (p3, kul, 'kullanici'), (p3, kat_b, 'avesis');
    PERFORM yarenler_alan_kanoniklestir();
    IF (SELECT kanonik_id FROM research_area WHERE id = kat_a2) IS DISTINCT FROM kat_a THEN RAISE EXCEPTION 'hazırlık: kat_a2 kat_a''ya bağlı değil'; END IF;

    -- Doğrudan ekleme: kaynak yonetici, onaylı, adresli; aynı ad ikinci kez eklenmez (YA011).
    j := yarenler_yonetici_alan_ekle('Deneme  Yeni Alan ', 'Test New Field', ARRAY['Deneme Yeni Konu']);
    yon := (j->'sonra'->>'id')::uuid;
    PERFORM 1 FROM research_area WHERE id = yon AND kaynak = 'yonetici' AND sema = 'yarenler' AND onayli AND ai_denetim IS NULL
        AND ad_tr = 'Deneme Yeni Alan' AND ad_en = 'Test New Field' AND ad_en_kaynak = 'yonetici' AND slug = 'deneme-yeni-alan';
    IF NOT FOUND THEN RAISE EXCEPTION 'yönetici alanı hatalı: %', j; END IF;
    IF yarenler_alan_birebir('deneme yeni konu') IS DISTINCT FROM yon THEN RAISE EXCEPTION 'eş anlamlı eklenmedi'; END IF;
    BEGIN PERFORM yarenler_yonetici_alan_ekle('deneme doku MÜHENDİSLİĞİ', NULL, NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA011' THEN hata := 'YA011'; END;
    IF hata IS DISTINCT FROM 'YA011' THEN RAISE EXCEPTION 'var olan ad yeniden eklendi'; END IF;
    BEGIN PERFORM yarenler_yonetici_alan_ekle(' ', NULL, NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA017' THEN hata := 'YA017'; END;
    IF hata IS DISTINCT FROM 'YA017' THEN RAISE EXCEPTION 'boş ad kabul edildi'; END IF;

    -- Katalog alanını yeniden adlandırma: adres değişir, eski adres kalır, eski ad eş anlamlı olur,
    -- wos satırı (eski anahtar) yeni adla da bu alanda kalır, içe aktarma eşleşmesi (normalize_ad) korunur.
    SELECT slug INTO eski_slug FROM research_area WHERE id = kat_a;
    j := yarenler_yonetici_alan_duzenle(kat_a, 'Deneme Doku Mühendisliği ve Rejeneratif Tıp', 'Test Tissue Engineering', ARRAY['Deneme Rejeneratif Tıp']);
    IF (SELECT slug FROM research_area WHERE id = kat_a) <> 'deneme-doku-muhendisligi-ve-rejeneratif-tip' THEN RAISE EXCEPTION 'adres değişmedi: %', j; END IF;
    IF NOT EXISTS (SELECT 1 FROM research_area_eski_adres WHERE slug = eski_slug AND area_id = kat_a) THEN RAISE EXCEPTION 'eski adres yazılmadı'; END IF;
    IF yarenler_alan_birebir('Deneme Doku Mühendisliği') IS DISTINCT FROM kat_a THEN RAISE EXCEPTION 'eski ad eş anlamlı olmadı'; END IF;
    IF (SELECT kanonik_id FROM research_area WHERE id = kat_a2) IS DISTINCT FROM kat_a THEN RAISE EXCEPTION 'grup üyesi alandan ayrıldı'; END IF;
    IF (SELECT normalize_ad FROM research_area WHERE id = kat_a) <> yarenler_katla('Deneme Doku Mühendisliği') THEN RAISE EXCEPTION 'katalog normalize_ad değişti'; END IF;
    PERFORM yarenler_alan_kanoniklestir();
    IF (SELECT kanonik_id FROM research_area WHERE id = kat_a2) IS DISTINCT FROM kat_a THEN RAISE EXCEPTION 'kanonikleştirme üyeyi ayırdı'; END IF;
    IF (j->'once'->>'ad_tr') <> 'Deneme Doku Mühendisliği' OR (j->'sonra'->>'ad_tr') <> 'Deneme Doku Mühendisliği ve Rejeneratif Tıp' THEN RAISE EXCEPTION 'önce/sonra özeti hatalı: %', j; END IF;
    -- Başka bir alanın adına çevirme reddedilir.
    BEGIN PERFORM yarenler_yonetici_alan_duzenle(kat_a, 'Deneme Biyomalzemeler', NULL, NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA011' THEN hata := 'YA011'; END;
    IF hata IS DISTINCT FROM 'YA011' THEN RAISE EXCEPTION 'çakışan ad kabul edildi'; END IF;
    -- Kanonik olmayan satır düzenlenmez.
    BEGIN PERFORM yarenler_yonetici_alan_duzenle(kat_a2, 'X Y', NULL, NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA010' THEN hata := 'YA010'; END;
    IF hata IS DISTINCT FROM 'YA010' THEN RAISE EXCEPTION 'kanonik olmayan satır düzenlendi'; END IF;

    -- Kullanıcı alanını katalog alanına birleştirme: bağlar taşınır, satır silinir, adı eş anlamlı olur, adresi 308.
    SELECT slug INTO eski_slug FROM research_area WHERE id = kul;
    j := yarenler_yonetici_alan_birlestir(kul, kat_b);
    IF EXISTS (SELECT 1 FROM research_area WHERE id = kul) THEN RAISE EXCEPTION 'kullanıcı alanı silinmedi'; END IF;
    IF NOT EXISTS (SELECT 1 FROM person_research_area WHERE person_id = p1 AND area_id = kat_b AND kaynak = 'kullanici') THEN RAISE EXCEPTION 'bağ taşınmadı'; END IF;
    IF (SELECT count(*) FROM person_matching_area WHERE area_id = kat_b) <> 2 THEN RAISE EXCEPTION 'hedef kişi sayısı hatalı'; END IF;
    IF yarenler_alan_birebir('Deneme Biyo Malzeme Bilimi') IS DISTINCT FROM kat_b THEN RAISE EXCEPTION 'birleşen ad eş anlamlı olmadı'; END IF;
    IF eski_slug IS NOT NULL AND NOT EXISTS (SELECT 1 FROM research_area_eski_adres WHERE slug = eski_slug AND area_id = kat_b) THEN RAISE EXCEPTION 'birleşen adres yönlenmiyor'; END IF;
    IF (j->>'kisi_sayisi')::int <> 2 THEN RAISE EXCEPTION 'kişi sayısı: %', j; END IF;

    -- Katalog alanını birleştirme: satırlar kalır, kalıcı bağ; kanonikleştirme tekrarında da hedefte kalır.
    j := yarenler_yonetici_alan_birlestir(kat_a, yon);
    IF (SELECT yonetici_hedef_id FROM research_area WHERE id = kat_a) IS DISTINCT FROM yon THEN RAISE EXCEPTION 'katalog bağlanmadı'; END IF;
    IF (SELECT kanonik_id FROM research_area WHERE id = kat_a) IS DISTINCT FROM yon OR (SELECT kanonik_id FROM research_area WHERE id = kat_a2) IS DISTINCT FROM yon THEN RAISE EXCEPTION 'katalog grubu hedefe geçmedi'; END IF;
    PERFORM yarenler_alan_kanoniklestir();
    IF (SELECT kanonik_id FROM research_area WHERE id = kat_a2) IS DISTINCT FROM yon THEN RAISE EXCEPTION 'birleştirme kalıcı değil'; END IF;
    IF NOT EXISTS (SELECT 1 FROM person_matching_area WHERE person_id = p2 AND area_id = yon) THEN RAISE EXCEPTION 'kişi hedef alanda görünmüyor'; END IF;
    -- Aynı alanı kendine birleştirme reddedilir.
    BEGIN PERFORM yarenler_yonetici_alan_birlestir(kat_a2, yon); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA013' THEN hata := 'YA013'; END;
    IF hata IS DISTINCT FROM 'YA013' THEN RAISE EXCEPTION 'aynı alana birleştirme kabul edildi'; END IF;

    -- Silme: katalog silinmez (YA012); başka alanlar bağlıysa silinmez (YA014); bağsız yönetici alanı silinir.
    BEGIN PERFORM yarenler_yonetici_alan_sil(kat_b); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA012' THEN hata := 'YA012'; END;
    IF hata IS DISTINCT FROM 'YA012' THEN RAISE EXCEPTION 'katalog alanı silindi'; END IF;
    BEGIN PERFORM yarenler_yonetici_alan_sil(yon); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA014' THEN hata := 'YA014'; END;
    IF hata IS DISTINCT FROM 'YA014' THEN RAISE EXCEPTION 'bağlı alanları olan alan silindi'; END IF;
    j := yarenler_yonetici_alan_ekle('Deneme Silinecek Alan', NULL, NULL);
    d := (j->'sonra'->>'id')::uuid;
    INSERT INTO person_research_area(person_id, area_id, kaynak) VALUES (p2, d, 'kullanici');
    j := yarenler_yonetici_alan_sil(d);
    IF EXISTS (SELECT 1 FROM research_area WHERE id = d) OR EXISTS (SELECT 1 FROM person_research_area WHERE area_id = d) THEN RAISE EXCEPTION 'silme tamamlanmadı'; END IF;
    IF (j->>'kisi_sayisi')::int <> 1 THEN RAISE EXCEPTION 'silmede kişi sayısı: %', j; END IF;

    -- Duyuru: kaldır, geri al, uzat (en çok 14 hafta), sahibinin kaldırdığı geri alınamaz.
    INSERT INTO announcement(sahip_id, ham_metin, yayin_metni, sure_hafta, bitis)
    VALUES (p1, 'Deneme duyuru metni yirmi karakter', 'Deneme duyuru metni yirmi karakter', 2, now() + interval '2 weeks') RETURNING id INTO ann;
    j := yarenler_yonetici_duyuru(ann, 'kaldir');
    IF (SELECT durum FROM announcement WHERE id = ann) <> 'kaldirildi' OR NOT (SELECT yonetici_kaldirdi FROM announcement WHERE id = ann) THEN RAISE EXCEPTION 'duyuru kaldırılmadı'; END IF;
    j := yarenler_yonetici_duyuru(ann, 'geri_al');
    IF (SELECT durum FROM announcement WHERE id = ann) <> 'yayinda' THEN RAISE EXCEPTION 'duyuru geri alınmadı'; END IF;
    j := yarenler_yonetici_duyuru(ann, 'uzat', 14);
    IF (SELECT sure_hafta FROM announcement WHERE id = ann) <> 14 THEN RAISE EXCEPTION 'süre uzatılmadı'; END IF;
    BEGIN PERFORM yarenler_yonetici_duyuru(ann, 'uzat', 15); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA015' THEN hata := 'YA015'; END;
    IF hata IS DISTINCT FROM 'YA015' THEN RAISE EXCEPTION '14 haftayı aşan süre kabul edildi'; END IF;
    UPDATE announcement SET durum = 'kaldirildi' WHERE id = ann;
    BEGIN PERFORM yarenler_yonetici_duyuru(ann, 'geri_al'); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA015' THEN hata := 'YA015'; END;
    IF hata IS DISTINCT FROM 'YA015' THEN RAISE EXCEPTION 'sahibinin kaldırdığı duyuru geri alındı'; END IF;

    -- Profil: gizle, göster; sahibinin kaldırdığı profil yönetici tarafından açılmaz.
    j := yarenler_yonetici_profil(p2, true);
    PERFORM 1 FROM person WHERE id = p2 AND NOT aktif AND yonetici_gizledi AND kaldirma_tarihi IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'profil gizlenmedi'; END IF;
    j := yarenler_yonetici_profil(p2, false);
    PERFORM 1 FROM person WHERE id = p2 AND aktif AND NOT yonetici_gizledi AND kaldirma_tarihi IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'profil gösterilmedi'; END IF;
    UPDATE person SET aktif = false, kaldirma_tarihi = now() WHERE id = p3;
    BEGIN PERFORM yarenler_yonetici_profil(p3, false); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA016' THEN hata := 'YA016'; END;
    IF hata IS DISTINCT FROM 'YA016' THEN RAISE EXCEPTION 'sahibinin kaldırdığı profil açıldı'; END IF;

    -- Kısıtlama: sebep zorunlu; alan ekleme işlevi YA004, duyuru eklemesi YA005 verir; kaldırınca serbest.
    BEGIN PERFORM yarenler_yonetici_kisitla(p1, true, true, 'x'); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA017' THEN hata := 'YA017'; END;
    IF hata IS DISTINCT FROM 'YA017' THEN RAISE EXCEPTION 'sebepsiz kısıtlama kabul edildi'; END IF;
    j := yarenler_yonetici_kisitla(p1, true, true, 'Tekrarlanan anlamsız alan eklemesi');
    IF NOT yarenler_kisitli(p1, 'alan') OR NOT yarenler_kisitli(p1, 'duyuru') OR yarenler_kisitli(p2, 'alan') THEN RAISE EXCEPTION 'kısıt okunmuyor'; END IF;
    INSERT INTO alan_denetimi(person_id, girdi, hedef, durum, karar, duzeltilmis_ad) VALUES (p1, 'deneme kisitli', 'alan', 'denetlenmedi', 'yeni', 'Deneme Kısıtlı') RETURNING id INTO d;
    BEGIN PERFORM yarenler_alan_ekle(d, p1, 'yeni', NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA004' THEN hata := 'YA004'; END;
    IF hata IS DISTINCT FROM 'YA004' THEN RAISE EXCEPTION 'kısıtlı kişi alan ekledi'; END IF;
    BEGIN INSERT INTO announcement(sahip_id, ham_metin, yayin_metni, sure_hafta, bitis)
          VALUES (p1, 'Deneme duyuru metni yirmi karakter', 'Deneme duyuru metni yirmi karakter', 1, now() + interval '1 week'); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA005' THEN hata := 'YA005'; END;
    IF hata IS DISTINCT FROM 'YA005' THEN RAISE EXCEPTION 'kısıtlı kişi duyuru yayımladı'; END IF;
    j := yarenler_yonetici_kisitla(p1, true, false, 'Yalnız alan ekleme kapalı');
    DELETE FROM duyuru_gunluk_yayin WHERE person_id = p1;   -- 0016: günde bir duyuru; deneme için günün kaydı silinir
    INSERT INTO announcement(sahip_id, ham_metin, yayin_metni, sure_hafta, bitis)
    VALUES (p1, 'Deneme duyuru metni yirmi karakter', 'Deneme duyuru metni yirmi karakter', 1, now() + interval '1 week');
    j := yarenler_yonetici_kisitla(p1, false, false, NULL);
    IF EXISTS (SELECT 1 FROM kisi_kisitlamasi WHERE person_id = p1) OR (j->'once'->>'alan_ekleme')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'kısıt kaldırılmadı: %', j; END IF;

    -- Başlık düzeni: bağlaçlar küçük harf (0010), boşluklar sadeleşir.
    j := yarenler_yonetici_alan_ekle('Deneme Ağız,  Diş Ve Çene Bilimi', 'Test Mouth And Jaw', NULL);
    IF j->'sonra'->>'ad_tr' IS DISTINCT FROM 'Deneme Ağız, Diş ve Çene Bilimi' THEN RAISE EXCEPTION 'başlık düzeni uygulanmadı: %', j; END IF;
    IF (SELECT ad_en FROM research_area WHERE id = (j->'sonra'->>'id')::uuid) IS DISTINCT FROM 'Test Mouth and Jaw' THEN RAISE EXCEPTION 'İngilizce başlık düzeni uygulanmadı'; END IF;

    -- Onay işareti: kullanıcı alanında açılır ve kapanır; katalog alanında reddedilir.
    INSERT INTO research_area(id, ad_tr, normalize_ad, sema, onayli, kaynak, ekleyen_person_id, ai_denetim)
    VALUES (uuidv7(), 'Deneme Onay Alanı', yarenler_katla('Deneme Onay Alanı'), 'yarenler', false, 'kullanici', p1, 'denetlendi')
    RETURNING id INTO d;
    j := yarenler_yonetici_alan_onay(d, true);
    IF NOT (SELECT onayli FROM research_area WHERE id = d) OR (j->'once'->>'onayli')::boolean THEN RAISE EXCEPTION 'onay işaretlenmedi: %', j; END IF;
    j := yarenler_yonetici_alan_onay(d, false);
    IF (SELECT onayli FROM research_area WHERE id = d) THEN RAISE EXCEPTION 'onay kaldırılmadı'; END IF;
    BEGIN PERFORM yarenler_yonetici_alan_onay(kat_b, false); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA017' THEN hata := 'YA017'; END;
    IF hata IS DISTINCT FROM 'YA017' THEN RAISE EXCEPTION 'katalog alanının onayı değişti'; END IF;

    -- Sahiplenme talebi: not, onay (ORCID bağlanır, profil sahiplenilir, kanıt 'yonetici', diğer açık talepler
    -- reddedilir, açık oturum profile bağlanır), işlenmiş talep yeniden işlenmez, çakışan ORCID bağlanmaz, ret.
    INSERT INTO profil_sahiplenme_talebi(orcid, person_id, neden) VALUES ('0000-0000-0000-1100', p1, 'ad_kurum') RETURNING id INTO talep;
    INSERT INTO profil_sahiplenme_talebi(orcid, person_id, neden) VALUES ('0000-0000-0000-1100', p2, 'ad_kurum') RETURNING id INTO talep2;
    INSERT INTO orcid_session(orcid, gorunen_ad, person_id, belirtec_ozeti, bitis)
    VALUES ('0000-0000-0000-1100', 'A B', NULL, decode(repeat('ab', 32), 'hex'), now() + interval '1 day');
    j := yarenler_yonetici_talep(talep, 'not', ' Kurum e-postasıyla teyit istendi ');
    PERFORM 1 FROM profil_sahiplenme_talebi WHERE id = talep AND durum = 'acik' AND islenme IS NULL AND yonetici_notu = 'Kurum e-postasıyla teyit istendi';
    IF NOT FOUND THEN RAISE EXCEPTION 'talep notu yazılmadı'; END IF;
    j := yarenler_yonetici_talep(talep, 'onayla', 'Teyit edildi');
    PERFORM 1 FROM person WHERE id = p1 AND orcid = '0000-0000-0000-1100' AND sahiplenildi AND sahiplenme_tarihi IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORCID profile bağlanmadı: %', j; END IF;
    PERFORM 1 FROM person_identifier_resolution WHERE person_id = p1 AND orcid = '0000-0000-0000-1100' AND evidence->>'kaynak' = 'yonetici';
    IF NOT FOUND THEN RAISE EXCEPTION 'kanıt yazılmadı'; END IF;
    PERFORM 1 FROM profil_sahiplenme_talebi WHERE id = talep AND durum = 'onaylandi' AND islenme IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'talep onaylanmadı'; END IF;
    PERFORM 1 FROM profil_sahiplenme_talebi WHERE id = talep2 AND durum = 'reddedildi';
    IF NOT FOUND THEN RAISE EXCEPTION 'aynı ORCID için diğer talep reddedilmedi'; END IF;
    PERFORM 1 FROM orcid_session WHERE orcid = '0000-0000-0000-1100' AND person_id = p1;
    IF NOT FOUND THEN RAISE EXCEPTION 'açık oturum profile bağlanmadı'; END IF;
    IF j->'sonra'->>'kanit' IS DISTINCT FROM 'yonetici' THEN RAISE EXCEPTION 'işlem özetinde kanıt yok: %', j; END IF;
    BEGIN PERFORM yarenler_yonetici_talep(talep, 'reddet', NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA019' THEN hata := 'YA019'; END;
    IF hata IS DISTINCT FROM 'YA019' THEN RAISE EXCEPTION 'işlenmiş talep yeniden işlendi'; END IF;
    -- Aynı ORCID başka profile bağlanamaz.
    INSERT INTO person(id, kisa_kimlik, institution_id, ad, soyad, gorunen_ad) VALUES (p4, 'ciyon04', inst, 'G', 'H', 'G H');
    INSERT INTO profil_sahiplenme_talebi(orcid, person_id, neden) VALUES ('0000-0000-0000-1100', p4, 'avesis_orcid') RETURNING id INTO talep3;
    BEGIN PERFORM yarenler_yonetici_talep(talep3, 'onayla', NULL); hata := NULL;
    EXCEPTION WHEN SQLSTATE 'YA020' THEN hata := SQLERRM; END;
    IF hata IS DISTINCT FROM 'orcid_kullaniliyor' THEN RAISE EXCEPTION 'çakışan ORCID bağlandı: %', hata; END IF;
    -- Ret: profil değişmez.
    j := yarenler_yonetici_talep(talep3, 'reddet', 'Farklı kişi');
    PERFORM 1 FROM profil_sahiplenme_talebi WHERE id = talep3 AND durum = 'reddedildi' AND yonetici_notu = 'Farklı kişi';
    IF NOT FOUND OR (SELECT orcid FROM person WHERE id = p4) IS NOT NULL THEN RAISE EXCEPTION 'ret hatalı'; END IF;
END $$;
ROLLBACK;
