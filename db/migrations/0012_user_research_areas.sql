-- migrate:up
-- Hocanın serbest metinle yeni çalışma alanı eklemesi (Profilim > Alan ekle).
--
-- Akış: önce veritabanı (kanonik anahtar birebir, trigram, varsa anlamsal yakınlık), birebir eşleşme yoksa
-- yapay zekâ yalnız yazım düzeltmesi ve en yakın 10 aday arasında anlamca aynı alan denetimi yapar.
-- "Katalogda yok", "çok dar" ya da "çok yeni" gerekçesiyle red yoktur. Yeni alan research_area'ya
-- kaynak='kullanici' olarak girer, kanonik anahtarı ve adresi (0011 kuralı) hemen üretilir, hocanın
-- profiline bağlanır ve herkese görünür. Ekleyen kişi, zaman ve denetim sonucu saklanır.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- research_area: kaynak, ekleyen ve denetim işareti
-- ---------------------------------------------------------------------------
ALTER TABLE research_area
    ADD COLUMN kaynak text NOT NULL DEFAULT 'katalog' CHECK (kaynak IN ('katalog', 'kullanici')),
    ADD COLUMN ekleyen_person_id uuid REFERENCES person(id) ON DELETE SET NULL,
    ADD COLUMN ai_denetim text CHECK (ai_denetim IN ('denetlendi', 'denetlenmedi')),
    ADD CONSTRAINT research_area_kullanici_alani CHECK (kaynak = 'katalog' OR (sema = 'yarenler' AND ai_denetim IS NOT NULL));
COMMENT ON COLUMN research_area.kaynak IS 'katalog: AVESİS, WoS, Scopus, OpenAlex içe aktarımı; kullanici: hocanın Profilim''den eklediği alan';
COMMENT ON COLUMN research_area.ai_denetim IS 'Yalnız kullanici alanlarında: denetlendi (yapay zekâ yazım ve eşleşme denetimi yaptı) ya da denetlenmedi (zaman aşımı/hata, yalnız yerel normalizasyon)';

-- Yapay zekânın "eminim" dediği İngilizce ad ayrıca işaretlenir.
ALTER TABLE research_area DROP CONSTRAINT research_area_ad_en_kaynak_check;
ALTER TABLE research_area ADD CONSTRAINT research_area_ad_en_kaynak_check CHECK (ad_en_kaynak IN ('avesis_sozluk', 'kaynak', 'yapay_zeka'));

-- Kanonik anahtar aramaları (yarenler_alan_anahtar, 0008) için ifade indeksleri.
CREATE INDEX research_area_anahtar_idx ON research_area (yarenler_alan_anahtar(coalesce(ad_tr, ad_en)));
CREATE INDEX research_area_anahtar_en_idx ON research_area (yarenler_alan_anahtar(ad_en)) WHERE ad_en IS NOT NULL;
CREATE INDEX research_area_synonym_anahtar_idx ON research_area_synonym (yarenler_alan_anahtar(ad));
-- Yarışta aynı anahtarla iki kullanıcı alanı oluşmaz (INSERT ... ON CONFLICT bu indeksi hedefler).
CREATE UNIQUE INDEX research_area_kullanici_anahtar_key ON research_area (yarenler_alan_anahtar(coalesce(ad_tr, ad_en))) WHERE kaynak = 'kullanici';
CREATE INDEX research_area_kullanici_idx ON research_area (olusturma DESC) WHERE kaynak = 'kullanici';

-- ---------------------------------------------------------------------------
-- Denetim kaydı: her "Alan ekle" denetimi ve sonucu (oran sınırı ve yapay zekâ önbelleği de buradan)
-- ---------------------------------------------------------------------------
CREATE TABLE alan_denetimi (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    person_id         uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    girdi             text NOT NULL CHECK (char_length(girdi) BETWEEN 2 AND 120),
    hedef             text NOT NULL CHECK (hedef IN ('alan', 'ilgi')),
    -- birebir: veritabanında kanonik anahtar eşleşmesi (yapay zekâ çağrılmadı)
    -- denetlendi: yapay zekâ denetimi şemaya uygun döndü
    -- denetlenmedi: yapay zekâ yok, zaman aşımı, hata ya da sınır; yalnız yerel normalizasyon
    durum             text NOT NULL CHECK (durum IN ('birebir', 'denetlendi', 'denetlenmedi')),
    karar             text NOT NULL CHECK (karar IN ('yeni', 'mevcut', 'gecersiz')),
    duzeltilmis_ad    text CHECK (char_length(duzeltilmis_ad) BETWEEN 2 AND 120),
    ad_en             text CHECK (char_length(ad_en) BETWEEN 2 AND 120),
    mevcut_alan_id    uuid REFERENCES research_area(id) ON DELETE SET NULL,
    kisa_gerekce      text CHECK (char_length(kisa_gerekce) <= 200),
    adaylar           uuid[] NOT NULL DEFAULT '{}',   -- gösterilen veritabanı adayları (kanonik kimlikler)
    model             text,
    hata              text CHECK (hata IN ('yapilandirma', 'butce', 'sinir', 'zaman_asimi', 'http', 'sema')),
    onbellek_anahtari text,
    secim             text CHECK (secim IN ('yeni', 'mevcut')),
    sonuc_alan_id     uuid REFERENCES research_area(id) ON DELETE SET NULL,
    yeni_alan         boolean NOT NULL DEFAULT false,
    olusturma         timestamptz NOT NULL DEFAULT now(),
    kullanildi        timestamptz,
    CHECK (karar <> 'yeni' OR duzeltilmis_ad IS NOT NULL)
);
CREATE INDEX alan_denetimi_kisi_idx ON alan_denetimi (person_id, olusturma DESC);
CREATE INDEX alan_denetimi_yeni_idx ON alan_denetimi (person_id, kullanildi) WHERE yeni_alan;
CREATE INDEX alan_denetimi_onbellek_idx ON alan_denetimi (onbellek_anahtari) WHERE durum = 'denetlendi';

-- ---------------------------------------------------------------------------
-- Anlamsal vektörler: alan vektörü ve "sonraki işlemde üret" işareti (infra/semantic/service.py)
-- ---------------------------------------------------------------------------
CREATE TABLE research_area_semantic (
    area_id      uuid PRIMARY KEY REFERENCES research_area(id) ON DELETE CASCADE,
    embedding    vector(384) NOT NULL,
    model        text NOT NULL,
    input_digest text NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE semantic_refresh_queue (
    sahip_turu text NOT NULL CHECK (sahip_turu IN ('person', 'area')),
    sahip_id   uuid NOT NULL,
    neden      text NOT NULL,
    olusturma  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sahip_turu, sahip_id)
);

-- ---------------------------------------------------------------------------
-- Birebir eşleşme: aynı kanonik anahtarı taşıyan alanın kanonik kimliği (Türkçe ad, İngilizce ad, eş anlamlı)
-- ---------------------------------------------------------------------------
CREATE FUNCTION yarenler_alan_birebir(p_ad text) RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    RETURN (
        SELECT coalesce(r.kanonik_id, r.id)
          FROM (SELECT a.id, 0 AS sira FROM research_area a
                 WHERE yarenler_alan_anahtar(coalesce(a.ad_tr, a.ad_en)) = yarenler_alan_anahtar(p_ad)
                UNION ALL
                SELECT a.id, 1 FROM research_area a
                 WHERE a.ad_en IS NOT NULL AND yarenler_alan_anahtar(a.ad_en) = yarenler_alan_anahtar(p_ad)
                UNION ALL
                SELECT s.area_id, 2 FROM research_area_synonym s
                 WHERE yarenler_alan_anahtar(s.ad) = yarenler_alan_anahtar(p_ad)) m
          JOIN research_area r ON r.id = m.id
         ORDER BY m.sira, (r.kanonik_id IS NULL) DESC, r.id
         LIMIT 1);

-- ---------------------------------------------------------------------------
-- Denetimi onaylanmış alanı ekler ve profile bağlar. Tek işlem, yarışa dayanıklı:
--   kişi kilidi (günlük 10 yeni alan sınırı) > anahtar kilidi > birebir arama > INSERT ... ON CONFLICT.
-- Hatalar: YA001 denetim geçersiz/süresi dolmuş, YA002 seçim geçersiz, YA003 günlük sınır.
-- SECURITY DEFINER: yarenler_auth research_area'ya doğrudan yazmaz, yalnız bu işlevi çalıştırır.
-- ---------------------------------------------------------------------------
CREATE FUNCTION yarenler_alan_ekle(p_denetim uuid, p_person uuid, p_secim text, p_alan uuid DEFAULT NULL)
    RETURNS TABLE (sonuc_id uuid, sonuc_ad text, sonuc_slug text, sonuc_yeni boolean)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    d alan_denetimi%ROWTYPE;
    v_hedef uuid;
    v_anahtar text;
    v_olustu boolean := false;
    v_taban text;
    v_aday text;
    v_sayi integer;
BEGIN
    IF p_secim IS NULL OR p_secim NOT IN ('yeni', 'mevcut') THEN
        RAISE EXCEPTION USING ERRCODE = 'YA002', MESSAGE = 'secim_gecersiz';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('yarenler_alan_kisi'), hashtext(p_person::text));
    SELECT * INTO d FROM alan_denetimi WHERE id = p_denetim AND person_id = p_person FOR UPDATE;
    IF NOT FOUND OR d.kullanildi IS NOT NULL OR d.olusturma < now() - interval '2 hours' OR d.karar = 'gecersiz' THEN
        RAISE EXCEPTION USING ERRCODE = 'YA001', MESSAGE = 'denetim_gecersiz';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM person WHERE id = p_person AND aktif) THEN
        RAISE EXCEPTION USING ERRCODE = 'YA001', MESSAGE = 'profil_yok';
    END IF;

    IF p_secim = 'mevcut' THEN
        IF p_alan IS NULL OR NOT (coalesce(p_alan = d.mevcut_alan_id, false) OR coalesce(p_alan = ANY (d.adaylar), false)) THEN
            RAISE EXCEPTION USING ERRCODE = 'YA002', MESSAGE = 'aday_gecersiz';
        END IF;
        SELECT coalesce(r.kanonik_id, r.id) INTO v_hedef FROM research_area r WHERE r.id = p_alan;
        IF v_hedef IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'YA002', MESSAGE = 'aday_gecersiz';
        END IF;
        -- Modelin eşleştirmesini hoca onayladı: yazdığı biçim o alanın eş anlamlısı olur, bir dahaki sefere
        -- veritabanı birebir bulur ve yapay zekâya gidilmez.
        IF d.durum = 'denetlendi' AND d.karar = 'mevcut' AND p_alan IS NOT DISTINCT FROM d.mevcut_alan_id AND yarenler_alan_birebir(d.girdi) IS NULL THEN
            INSERT INTO research_area_synonym (area_id, ad, normalize_ad, kaynak)
            VALUES (v_hedef, d.girdi, yarenler_katla(d.girdi), 'yapay_zeka')
            ON CONFLICT (normalize_ad, area_id) DO NOTHING;
        END IF;
    ELSE
        v_anahtar := yarenler_alan_anahtar(d.duzeltilmis_ad);
        IF v_anahtar IS NULL OR v_anahtar = '' THEN
            RAISE EXCEPTION USING ERRCODE = 'YA002', MESSAGE = 'ad_gecersiz';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtext('yarenler_alan_anahtar'), hashtext(v_anahtar));
        -- Düzeltilmiş ad (ya da bu arada eklenen alan) havuzda birebir varsa yeni satır açılmaz.
        v_hedef := yarenler_alan_birebir(d.duzeltilmis_ad);
        IF v_hedef IS NULL THEN
            SELECT count(*) INTO v_sayi FROM alan_denetimi
             WHERE person_id = p_person AND yeni_alan AND kullanildi > now() - interval '24 hours';
            IF v_sayi >= 10 THEN
                RAISE EXCEPTION USING ERRCODE = 'YA003', MESSAGE = 'gunluk_sinir';
            END IF;
            INSERT INTO research_area (ad_tr, ad_en, ad_en_kaynak, normalize_ad, sema, onayli, kaynak, ekleyen_person_id, ai_denetim)
            VALUES (d.duzeltilmis_ad, d.ad_en, CASE WHEN d.ad_en IS NOT NULL THEN 'yapay_zeka' END,
                    yarenler_katla(d.duzeltilmis_ad), 'yarenler', false, 'kullanici', p_person,
                    CASE WHEN d.durum = 'denetlendi' THEN 'denetlendi' ELSE 'denetlenmedi' END)
            ON CONFLICT (yarenler_alan_anahtar(coalesce(ad_tr, ad_en))) WHERE kaynak = 'kullanici' DO NOTHING
            RETURNING id INTO v_hedef;
            IF v_hedef IS NULL THEN
                SELECT r.id INTO v_hedef FROM research_area r
                 WHERE r.kaynak = 'kullanici' AND yarenler_alan_anahtar(coalesce(r.ad_tr, r.ad_en)) = v_anahtar;
            ELSE
                v_olustu := true;
                -- Adres: 0011 yarenler_alan_slug_ata kuralı, tek satır için.
                v_taban := coalesce(nullif(yarenler_slug(yarenler_alan_temiz(d.duzeltilmis_ad)), ''), 'alan');
                v_aday := v_taban;
                IF EXISTS (SELECT 1 FROM research_area x WHERE x.slug = v_aday) THEN
                    v_aday := v_taban || '-' || substr(md5(v_hedef::text), 1, 6);
                END IF;
                IF EXISTS (SELECT 1 FROM research_area x WHERE x.slug = v_aday) THEN
                    v_aday := v_taban || '-' || substr(md5(v_hedef::text), 1, 12);
                END IF;
                UPDATE research_area x SET slug = v_aday WHERE x.id = v_hedef;
                -- Hocanın yazdığı biçim, düzeltilmiş adla aynı anahtarı taşımıyorsa eş anlamlı olarak saklanır.
                IF d.durum = 'denetlendi' AND yarenler_alan_anahtar(d.girdi) IS DISTINCT FROM v_anahtar THEN
                    INSERT INTO research_area_synonym (area_id, ad, normalize_ad, kaynak)
                    VALUES (v_hedef, d.girdi, yarenler_katla(d.girdi), 'kullanici')
                    ON CONFLICT (normalize_ad, area_id) DO NOTHING;
                END IF;
                INSERT INTO semantic_refresh_queue (sahip_turu, sahip_id, neden)
                VALUES ('area', v_hedef, 'yeni_alan') ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END IF;

    IF d.hedef = 'alan' THEN
        INSERT INTO person_research_area (person_id, area_id, kaynak)
        SELECT p_person, v_hedef, 'kullanici'
         WHERE NOT EXISTS (SELECT 1 FROM person_research_area x JOIN research_area s ON s.id = x.area_id
                            WHERE x.person_id = p_person AND s.id <> v_hedef AND s.kanonik_id = v_hedef)
        ON CONFLICT (person_id, area_id) DO UPDATE SET kaynak = 'kullanici';
        -- Kişinin anlamsal profil vektörü beyan ettiği alanları da içerir; bir sonraki işlemde yenilenir.
        INSERT INTO semantic_refresh_queue (sahip_turu, sahip_id, neden)
        VALUES ('person', p_person, 'alan_eklendi') ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO person_collaboration_area (person_id, area_id)
        SELECT p_person, v_hedef
         WHERE NOT EXISTS (SELECT 1 FROM person_collaboration_area x JOIN research_area s ON s.id = x.area_id
                            WHERE x.person_id = p_person AND s.kanonik_id = v_hedef)
        ON CONFLICT DO NOTHING;
    END IF;
    -- Profil sahibinin kararı: pilot önerileri bu profile yeniden uygulanmaz (saveProfile ile aynı).
    INSERT INTO profile_field_review (person_id) VALUES (p_person) ON CONFLICT DO NOTHING;
    UPDATE person SET guncelleme = now() WHERE id = p_person;
    UPDATE alan_denetimi SET secim = p_secim, sonuc_alan_id = v_hedef, yeni_alan = v_olustu, kullanildi = now()
     WHERE id = d.id;

    RETURN QUERY
        SELECT r.id, yarenler_alan_temiz(coalesce(r.ad_tr, r.ad_en)), r.slug, v_olustu
          FROM research_area r WHERE r.id = v_hedef;
END $$;
REVOKE ALL ON FUNCTION yarenler_alan_ekle(uuid, uuid, text, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Yetkiler (roller yerelde ya da CI'da yoksa atlanır)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_auth') THEN
        GRANT SELECT ON research_area, research_area_synonym, person_research_area, person_collaboration_area TO yarenler_auth;
        GRANT SELECT, INSERT ON alan_denetimi TO yarenler_auth;
        GRANT SELECT, INSERT, UPDATE ON ai_call_log TO yarenler_auth;
        GRANT EXECUTE ON FUNCTION yarenler_alan_birebir(text) TO yarenler_auth;
        GRANT EXECUTE ON FUNCTION yarenler_alan_ekle(uuid, uuid, text, uuid) TO yarenler_auth;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_web') THEN
        GRANT EXECUTE ON FUNCTION yarenler_alan_birebir(text) TO yarenler_web;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_indexer') THEN
        GRANT SELECT ON research_area TO yarenler_indexer;
        GRANT SELECT, INSERT, UPDATE, DELETE ON research_area_semantic TO yarenler_indexer;
        GRANT SELECT, DELETE ON semantic_refresh_queue TO yarenler_indexer;
    END IF;
END $$;

-- migrate:down
DROP FUNCTION yarenler_alan_ekle(uuid, uuid, text, uuid);
DROP FUNCTION yarenler_alan_birebir(text);
DROP TABLE semantic_refresh_queue;
DROP TABLE research_area_semantic;
DROP TABLE alan_denetimi;
-- Kullanıcı alanları silinmez (profillere bağlı); sıradan 'yarenler' şemalı satır olarak kalır.
DROP INDEX research_area_kullanici_idx;
DROP INDEX research_area_kullanici_anahtar_key;
DROP INDEX research_area_synonym_anahtar_idx;
DROP INDEX research_area_anahtar_en_idx;
DROP INDEX research_area_anahtar_idx;
UPDATE research_area SET ad_en_kaynak = NULL WHERE ad_en_kaynak = 'yapay_zeka';
ALTER TABLE research_area DROP CONSTRAINT research_area_ad_en_kaynak_check;
ALTER TABLE research_area ADD CONSTRAINT research_area_ad_en_kaynak_check CHECK (ad_en_kaynak IN ('avesis_sozluk', 'kaynak'));
ALTER TABLE research_area
    DROP CONSTRAINT research_area_kullanici_alani,
    DROP COLUMN ai_denetim,
    DROP COLUMN ekleyen_person_id,
    DROP COLUMN kaynak;
