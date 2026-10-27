-- migrate:up
-- Yönetici paneli (/yonetici).
--
-- Panel ayrı ve kısıtlı bir rolle (yarenler_admin, ADMIN_DATABASE_URL) çalışır. Rol çekirdek tablolara
-- doğrudan yazmaz: okuma yetkisi, kendi oturum ve giriş denemesi tabloları, işlem kaydına yalnız ekleme
-- ve aşağıdaki SECURITY DEFINER işlevleri. Kurallar (ör. "katalog alanı silinmez", "en fazla 14 hafta")
-- işlevlerin içinde, veritabanında uygulanır. Rol yoksa göç onu NOLOGIN olarak açmayı dener; açamazsa
-- uyarı yazar, rol sonradan açılınca infra/admin/grants.sql aynı yetkileri verir.
--
-- Alan birleştirme kalıcıdır: katalog satırları silinmez (içe aktarma onları yeniden bulur), yonetici_hedef_id
-- ile hedefe bağlanır ve yarenler_alan_kanoniklestir() her çalışmada bu bağı uygular. Kullanıcı ve yönetici
-- alanlarında bağlar hedefe taşınır, satır silinir, eski adres research_area_eski_adres ile 308 olur.

-- ---------------------------------------------------------------------------
-- research_area: 'yonetici' kaynağı, kalıcı yönetici birleştirmesi, eski adresler
-- ---------------------------------------------------------------------------
ALTER TABLE research_area DROP CONSTRAINT research_area_kaynak_check;
ALTER TABLE research_area ADD CONSTRAINT research_area_kaynak_check CHECK (kaynak IN ('katalog', 'kullanici', 'yonetici'));
ALTER TABLE research_area DROP CONSTRAINT research_area_kullanici_alani;
ALTER TABLE research_area ADD CONSTRAINT research_area_kullanici_alani
    CHECK (kaynak = 'katalog' OR (sema = 'yarenler' AND (kaynak = 'yonetici' OR ai_denetim IS NOT NULL)));
ALTER TABLE research_area DROP CONSTRAINT research_area_ad_en_kaynak_check;
ALTER TABLE research_area ADD CONSTRAINT research_area_ad_en_kaynak_check
    CHECK (ad_en_kaynak IN ('avesis_sozluk', 'kaynak', 'yapay_zeka', 'yonetici'));
ALTER TABLE research_area
    ADD COLUMN yonetici_hedef_id uuid REFERENCES research_area(id) ON DELETE SET NULL,
    ADD CONSTRAINT research_area_yonetici_hedef_kendisi_degil CHECK (yonetici_hedef_id IS DISTINCT FROM id);
COMMENT ON COLUMN research_area.kaynak IS 'katalog: AVESİS, WoS, Scopus, OpenAlex içe aktarımı; kullanici: hocanın Profilim''den eklediği alan; yonetici: panelden doğrudan eklenen alan';
COMMENT ON COLUMN research_area.yonetici_hedef_id IS 'Yönetici birleştirmesi: bu satırın kavramı hedef alana katıldı (yarenler_alan_kanoniklestir uygular)';
CREATE INDEX research_area_yonetici_hedef_idx ON research_area (yonetici_hedef_id) WHERE yonetici_hedef_id IS NOT NULL;
CREATE INDEX research_area_yonetici_idx ON research_area (olusturma DESC) WHERE kaynak = 'yonetici';

-- Adı değişen ya da birleşen alanın eski adresi (findArea 308 ile kanonik adrese yönlendirir).
CREATE TABLE research_area_eski_adres (
    slug       text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
    area_id    uuid NOT NULL REFERENCES research_area(id) ON DELETE CASCADE,
    olusturma  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_area_eski_adres_alan_idx ON research_area_eski_adres (area_id);

-- ---------------------------------------------------------------------------
-- Duyuru, profil, sahiplenme talebi: yönetici işaretleri
-- ---------------------------------------------------------------------------
ALTER TABLE announcement ADD COLUMN yonetici_kaldirdi boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN announcement.yonetici_kaldirdi IS 'Duyuruyu yönetici kaldırdı; yalnız bu durumda yönetici geri alabilir';
ALTER TABLE person ADD COLUMN yonetici_gizledi boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN person.yonetici_gizledi IS 'Profili yönetici gizledi; sahibi kendi başına yeniden açamaz';
ALTER TABLE profil_sahiplenme_talebi
    ADD COLUMN islenme timestamptz,
    ADD COLUMN yonetici_notu text CHECK (char_length(yonetici_notu) <= 1000);

-- ---------------------------------------------------------------------------
-- Kullanıcı kısıtlaması: yeni alan ekleme ve duyuru yayımlama
-- ---------------------------------------------------------------------------
CREATE TABLE kisi_kisitlamasi (
    person_id    uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
    alan_ekleme  boolean NOT NULL DEFAULT false,
    duyuru       boolean NOT NULL DEFAULT false,
    sebep        text NOT NULL CHECK (char_length(sebep) BETWEEN 3 AND 500),
    olusturma    timestamptz NOT NULL DEFAULT now(),
    guncelleme   timestamptz NOT NULL DEFAULT now(),
    CHECK (alan_ekleme OR duyuru)
);

CREATE FUNCTION yarenler_kisitli(p_person uuid, p_tur text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    RETURN coalesce((SELECT CASE p_tur WHEN 'alan' THEN k.alan_ekleme WHEN 'duyuru' THEN k.duyuru END
                       FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false);
REVOKE ALL ON FUNCTION yarenler_kisitli(uuid, text) FROM PUBLIC;

-- Duyuru yayımlama kısıtı veritabanında da uygulanır (YA005).
CREATE FUNCTION yarenler_duyuru_kisitlama() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF yarenler_kisitli(NEW.sahip_id, 'duyuru') THEN
        RAISE EXCEPTION USING ERRCODE = 'YA005', MESSAGE = 'duyuru_kisitli';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER announcement_kisitlama BEFORE INSERT ON announcement
    FOR EACH ROW EXECUTE FUNCTION yarenler_duyuru_kisitlama();

-- Alan ekleme kısıtı (YA004): 0012 işlevinin aynısı, profil denetiminden sonra kısıt denetimi eklendi.
CREATE OR REPLACE FUNCTION yarenler_alan_ekle(p_denetim uuid, p_person uuid, p_secim text, p_alan uuid DEFAULT NULL)
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
    IF yarenler_kisitli(p_person, 'alan') THEN
        RAISE EXCEPTION USING ERRCODE = 'YA004', MESSAGE = 'alan_kisitli';
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
-- Panel oturumu, giriş denemeleri ve işlem kaydı
-- ---------------------------------------------------------------------------
CREATE TABLE yonetici_oturum (
    belirtec_ozeti  bytea PRIMARY KEY CHECK (length(belirtec_ozeti) = 32),   -- sha256(belirteç); belirteç saklanmaz
    kullanici       text NOT NULL CHECK (char_length(kullanici) BETWEEN 1 AND 64),
    parmak_izi      text NOT NULL CHECK (parmak_izi ~ '^[0-9a-f]{64}$'),     -- kullanıcı adı ve şifre özetinden; özet değişince oturum geçersiz
    ip_ozeti        text CHECK (ip_ozeti ~ '^[0-9a-f]{64}$'),
    olusturma       timestamptz NOT NULL DEFAULT now(),
    son_kullanim    timestamptz NOT NULL DEFAULT now(),
    bitis           timestamptz NOT NULL,                                     -- olusturma + 8 saat (mutlak)
    CHECK (bitis > olusturma AND bitis <= olusturma + interval '8 hours')
);
CREATE INDEX yonetici_oturum_bitis_idx ON yonetici_oturum (bitis);

-- IP ve kullanıcı adı başına hatalı deneme sayacı (anahtar HMAC özetidir; ham IP ve ad saklanmaz).
CREATE TABLE yonetici_giris_denemesi (
    anahtar      text PRIMARY KEY CHECK (anahtar ~ '^(ip|kullanici):[0-9a-f]{64}$'),
    hata_sayisi  integer NOT NULL DEFAULT 0 CHECK (hata_sayisi >= 0),
    son_hata     timestamptz,
    kilit_bitis  timestamptz,
    kilit_sayisi integer NOT NULL DEFAULT 0 CHECK (kilit_sayisi >= 0)          -- art arda kilitler; her kilit öncekinin iki katı sürer
);

CREATE TABLE yonetici_islem (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zaman      timestamptz NOT NULL DEFAULT now(),
    kullanici  text NOT NULL CHECK (char_length(kullanici) BETWEEN 1 AND 64),
    islem      text NOT NULL CHECK (islem ~ '^[a-z_]{3,40}$'),
    hedef_tur  text NOT NULL CHECK (hedef_tur ~ '^[a-z_]{2,30}$'),
    hedef_id   text CHECK (char_length(hedef_id) <= 100),
    hedef_ad   text CHECK (char_length(hedef_ad) <= 300),
    once       jsonb,
    sonra      jsonb,
    ip_ozeti   text CHECK (ip_ozeti ~ '^[0-9a-f]{64}$')
);
CREATE INDEX yonetici_islem_zaman_idx ON yonetici_islem (zaman DESC);

-- ---------------------------------------------------------------------------
-- Kanonikleştirme: anahtar grupları + kalıcı yönetici birleştirmeleri
--   1. Aynı anahtarı taşıyan satırlar bir grup, en çok kişiye bağlı satır grubun kökü (0008 kuralı).
--   2. Grubun bir satırında yonetici_hedef_id varsa (önce kök satır) grup, hedefin grubuna katılır.
--      Zincirler izlenir (en fazla 10 adım); çevrimi birleştirme işlevi engeller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION yarenler_alan_kanoniklestir() RETURNS integer
    LANGUAGE plpgsql AS $$
DECLARE degisen integer;
BEGIN
    WITH RECURSIVE aday AS (
        SELECT a.id, a.yonetici_hedef_id,
               yarenler_alan_anahtar(coalesce(a.ad_tr, a.ad_en)) AS anahtar,
               (SELECT count(*) FROM person_research_area pa WHERE pa.area_id = a.id) AS kisi,
               array_position(ARRAY['avesis','scopus','wos','openalex','yarenler']::alan_semasi[], a.sema) AS sira
          FROM research_area a
    ), grup AS (
        SELECT id, yonetici_hedef_id,
               first_value(id) OVER (PARTITION BY anahtar ORDER BY kisi DESC, sira, id) AS kok
          FROM aday WHERE anahtar IS NOT NULL
    ), grup_hedef AS (
        SELECT DISTINCT ON (kok) kok, yonetici_hedef_id AS hedef
          FROM grup WHERE yonetici_hedef_id IS NOT NULL
         ORDER BY kok, (id = kok) DESC, id
    ), zincir AS (
        SELECT k.kok AS bas, k.kok, 0 AS derinlik FROM (SELECT DISTINCT kok FROM grup) k
        UNION ALL
        SELECT z.bas, t.kok, z.derinlik + 1
          FROM zincir z
          JOIN grup_hedef h ON h.kok = z.kok
          JOIN grup t ON t.id = h.hedef
         WHERE z.derinlik < 10 AND t.kok <> z.kok
    ), son AS (
        SELECT DISTINCT ON (bas) bas, kok FROM zincir ORDER BY bas, derinlik DESC
    ), secim AS (
        SELECT g.id, s.kok AS kanonik FROM grup g JOIN son s ON s.bas = g.kok
    ), guncel AS (
        UPDATE research_area a
           SET kanonik_id = CASE WHEN s.kanonik = a.id THEN NULL ELSE s.kanonik END,
               guncelleme = now()
          FROM secim s
         WHERE s.id = a.id AND a.kanonik_id IS DISTINCT FROM CASE WHEN s.kanonik = a.id THEN NULL ELSE s.kanonik END
        RETURNING a.id
    )
    SELECT count(*) INTO degisen FROM guncel;

    INSERT INTO research_area_synonym (area_id, ad, dil, normalize_ad, kaynak)
    SELECT DISTINCT ON (a.kanonik_id, yarenler_katla(n.ad)) a.kanonik_id, n.ad, n.dil, yarenler_katla(n.ad), 'sema'
      FROM research_area a
      CROSS JOIN LATERAL (VALUES (a.ad_tr, 'tr'), (a.ad_en, 'en')) AS n(ad, dil)
     WHERE a.kanonik_id IS NOT NULL AND n.ad IS NOT NULL
    ON CONFLICT (normalize_ad, area_id) DO NOTHING;

    PERFORM yarenler_alan_ingilizce_doldur();
    PERFORM yarenler_alan_slug_ata();
    RETURN degisen;
END $$;

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------
-- Panelden gelen ad: boşluklar sadeleşir, boşsa NULL, 2-120 karakter, kontrol karakteri yok (YA017),
-- başlık düzeni (0010: bağlaçlar küçük harf) uygulanır.
CREATE FUNCTION yarenler_yonetici_ad(p_ad text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text := btrim(regexp_replace(coalesce(p_ad, ''), '\s+', ' ', 'g'));
BEGIN
    IF v = '' THEN RETURN NULL; END IF;
    IF char_length(v) < 2 OR char_length(v) > 120 OR v ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'ad_gecersiz';
    END IF;
    RETURN yarenler_baslik_duzeni(v);
END $$;

-- Yeni ya da değişen ad için adres: sade biçim, çakışmada kısa kimlik eki (0011 kuralı).
CREATE FUNCTION yarenler_alan_slug_yeni(p_ad text, p_id uuid) RETURNS text
    LANGUAGE plpgsql STABLE AS $$
DECLARE v_taban text := coalesce(nullif(yarenler_slug(yarenler_alan_temiz(p_ad)), ''), 'alan'); v_aday text := v_taban;
BEGIN
    IF EXISTS (SELECT 1 FROM research_area x WHERE x.slug = v_aday AND x.id <> p_id) THEN
        v_aday := v_taban || '-' || substr(md5(p_id::text), 1, 6);
    END IF;
    IF EXISTS (SELECT 1 FROM research_area x WHERE x.slug = v_aday AND x.id <> p_id) THEN
        v_aday := v_taban || '-' || substr(md5(p_id::text), 1, 12);
    END IF;
    RETURN v_aday;
END $$;

-- İşlem kaydı ve önizleme için alan özeti (kişi sayısı: uzmanlık ve işbirliği ilgisi, kanonik üzerinden).
CREATE FUNCTION yarenler_yonetici_alan_ozet(p_alan uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    RETURN (SELECT jsonb_build_object(
                'id', a.id, 'ad_tr', a.ad_tr, 'ad_en', a.ad_en, 'slug', a.slug, 'kaynak', a.kaynak,
                'kanonik_id', a.kanonik_id,
                'es_anlamlilar', coalesce((SELECT jsonb_agg(s.ad ORDER BY s.ad) FROM research_area_synonym s
                                            WHERE s.area_id = a.id AND s.kaynak <> 'sema'), '[]'::jsonb),
                'kisi', (SELECT count(DISTINCT ma.person_id) FROM person_matching_area ma
                          WHERE ma.area_id = coalesce(a.kanonik_id, a.id)))
              FROM research_area a WHERE a.id = p_alan);

-- Eş anlamlıları panelden gelen listeyle değiştirir ('sema' kaynaklılar kanonikleştirmede yeniden üretildiği
-- için dokunulmaz). p_es NULL ise değişiklik yok. En çok 50 ad.
CREATE FUNCTION yarenler_yonetici_es_anlamlilar(p_alan uuid, p_es text[]) RETURNS void
    LANGUAGE plpgsql AS $$
DECLARE v_adlar text[];
BEGIN
    IF p_es IS NULL THEN RETURN; END IF;
    SELECT coalesce(array_agg(DISTINCT yarenler_yonetici_ad(x)) FILTER (WHERE yarenler_yonetici_ad(x) IS NOT NULL), '{}')
      INTO v_adlar FROM unnest(p_es) AS x;
    IF cardinality(v_adlar) > 50 THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'es_anlamli_cok';
    END IF;
    DELETE FROM research_area_synonym s
     WHERE s.area_id = p_alan AND s.kaynak <> 'sema'
       AND s.normalize_ad <> ALL (ARRAY(SELECT yarenler_katla(x) FROM unnest(v_adlar) AS x));
    INSERT INTO research_area_synonym (area_id, ad, normalize_ad, kaynak)
    SELECT p_alan, x, yarenler_katla(x), 'editor' FROM unnest(v_adlar) AS x
    ON CONFLICT (normalize_ad, area_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- Yönetici işlemleri (SECURITY DEFINER; yalnız yarenler_admin çalıştırır)
-- Hata kodları: YA010 alan yok, YA011 ad başka alanda var (DETAIL: o alanın kimliği), YA012 katalog alanı
-- silinmez, YA013 birleştirme geçersiz, YA014 başka alanlar bu alana bağlı, YA015 duyuru işlemi geçersiz,
-- YA016 profil işlemi geçersiz, YA017 girdi geçersiz, YA018 talep yok, YA019 talep işlenmiş,
-- YA020 talep profile bağlanamaz.
-- ---------------------------------------------------------------------------

-- AI olmadan doğrudan yeni alan (kaynak='yonetici').
CREATE FUNCTION yarenler_yonetici_alan_ekle(p_ad_tr text, p_ad_en text, p_es text[] DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ad text := yarenler_yonetici_ad(p_ad_tr); v_en text := yarenler_yonetici_ad(p_ad_en);
        v_anahtar text; v_var uuid; v_id uuid; v_slug text;
BEGIN
    IF v_ad IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'ad_gecersiz';
    END IF;
    v_anahtar := yarenler_alan_anahtar(v_ad);
    IF v_anahtar IS NULL OR v_anahtar = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'ad_gecersiz';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('yarenler_alan_anahtar'), hashtext(v_anahtar));
    v_var := coalesce(yarenler_alan_birebir(v_ad), CASE WHEN v_en IS NOT NULL THEN yarenler_alan_birebir(v_en) END);
    IF v_var IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'YA011', MESSAGE = 'ad_cakisiyor', DETAIL = v_var::text;
    END IF;
    INSERT INTO research_area (ad_tr, ad_en, ad_en_kaynak, normalize_ad, sema, onayli, kaynak)
    VALUES (v_ad, v_en, CASE WHEN v_en IS NOT NULL THEN 'yonetici' END, yarenler_katla(v_ad), 'yarenler', true, 'yonetici')
    RETURNING id INTO v_id;
    v_slug := yarenler_alan_slug_yeni(v_ad, v_id);
    DELETE FROM research_area_eski_adres WHERE slug = v_slug;
    UPDATE research_area SET slug = v_slug WHERE id = v_id;
    PERFORM yarenler_yonetici_es_anlamlilar(v_id, p_es);
    INSERT INTO semantic_refresh_queue (sahip_turu, sahip_id, neden) VALUES ('area', v_id, 'yonetici_alan')
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('sonra', yarenler_yonetici_alan_ozet(v_id));
END $$;

-- Türkçe ad, İngilizce ad ve eş anlamlılar. Yalnız kanonik satır düzenlenir. Ad değişince:
--   eski ad eş anlamlı olur; grubun diğer kaynak satırları yeni adla da bu alanda kalır (yonetici_hedef_id);
--   adres tabanı değiştiyse yeni adres üretilir, eskisi research_area_eski_adres'e yazılır (308).
-- Katalog satırının normalize_ad değeri korunur: içe aktarma satırı bununla bulur (yeni ad eş anlamlı olarak eklenir).
CREATE FUNCTION yarenler_yonetici_alan_duzenle(p_alan uuid, p_ad_tr text, p_ad_en text, p_es text[] DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r research_area%ROWTYPE; v_ad text := yarenler_yonetici_ad(p_ad_tr); v_en text := yarenler_yonetici_ad(p_ad_en);
        v_yeni text; v_eski_anahtar text; v_yeni_anahtar text; v_var uuid; v_once jsonb; v_slug text;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('yarenler_alan_yonetim'));
    SELECT * INTO r FROM research_area WHERE id = p_alan FOR UPDATE;
    IF NOT FOUND OR r.kanonik_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'YA010', MESSAGE = 'alan_yok';
    END IF;
    v_yeni := coalesce(v_ad, v_en);
    v_yeni_anahtar := yarenler_alan_anahtar(v_yeni);
    IF v_yeni IS NULL OR v_yeni_anahtar IS NULL OR v_yeni_anahtar = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'ad_gecersiz';
    END IF;
    v_once := yarenler_yonetici_alan_ozet(p_alan);
    v_eski_anahtar := yarenler_alan_anahtar(coalesce(r.ad_tr, r.ad_en));
    IF v_yeni_anahtar IS DISTINCT FROM v_eski_anahtar THEN
        PERFORM pg_advisory_xact_lock(hashtext('yarenler_alan_anahtar'), hashtext(v_yeni_anahtar));
    END IF;
    v_var := yarenler_alan_birebir(v_yeni);
    IF v_var IS NOT NULL AND v_var <> p_alan THEN
        RAISE EXCEPTION USING ERRCODE = 'YA011', MESSAGE = 'ad_cakisiyor', DETAIL = v_var::text;
    END IF;
    IF v_en IS NOT NULL AND v_en IS DISTINCT FROM r.ad_en THEN
        v_var := yarenler_alan_birebir(v_en);
        IF v_var IS NOT NULL AND v_var <> p_alan THEN
            RAISE EXCEPTION USING ERRCODE = 'YA011', MESSAGE = 'ad_cakisiyor', DETAIL = v_var::text;
        END IF;
    END IF;
    IF v_yeni_anahtar IS DISTINCT FROM v_eski_anahtar THEN
        UPDATE research_area SET yonetici_hedef_id = p_alan
         WHERE kanonik_id = p_alan AND yonetici_hedef_id IS NULL;
    END IF;

    UPDATE research_area
       SET ad_tr = v_ad, ad_en = v_en,
           ad_en_kaynak = CASE WHEN v_en IS NULL THEN NULL WHEN v_en IS DISTINCT FROM r.ad_en THEN 'yonetici' ELSE r.ad_en_kaynak END,
           normalize_ad = CASE WHEN r.kaynak = 'katalog' THEN r.normalize_ad ELSE yarenler_katla(v_yeni) END,
           guncelleme = now()
     WHERE id = p_alan;

    IF r.slug IS NOT NULL AND coalesce(nullif(yarenler_slug(yarenler_alan_temiz(v_yeni)), ''), 'alan')
            <> coalesce(nullif(yarenler_slug(yarenler_alan_temiz(coalesce(r.ad_tr, r.ad_en))), ''), 'alan') THEN
        v_slug := yarenler_alan_slug_yeni(v_yeni, p_alan);
        IF v_slug <> r.slug THEN
            INSERT INTO research_area_eski_adres (slug, area_id) VALUES (r.slug, p_alan)
            ON CONFLICT (slug) DO UPDATE SET area_id = excluded.area_id;
            DELETE FROM research_area_eski_adres WHERE slug = v_slug;
            UPDATE research_area SET slug = v_slug WHERE id = p_alan;
        END IF;
    END IF;

    PERFORM yarenler_yonetici_es_anlamlilar(p_alan, p_es);
    IF v_yeni_anahtar IS DISTINCT FROM v_eski_anahtar THEN
        INSERT INTO research_area_synonym (area_id, ad, normalize_ad, kaynak)
        SELECT p_alan, n, yarenler_katla(n), 'editor' FROM (VALUES (r.ad_tr), (r.ad_en)) AS v(n)
         WHERE n IS NOT NULL AND n IS DISTINCT FROM v_ad AND n IS DISTINCT FROM v_en
        ON CONFLICT (normalize_ad, area_id) DO NOTHING;
    END IF;
    IF r.kaynak = 'katalog' AND yarenler_katla(v_yeni) <> r.normalize_ad THEN
        INSERT INTO research_area_synonym (area_id, ad, normalize_ad, kaynak)
        VALUES (p_alan, v_yeni, yarenler_katla(v_yeni), 'editor')
        ON CONFLICT (normalize_ad, area_id) DO NOTHING;
    END IF;
    INSERT INTO semantic_refresh_queue (sahip_turu, sahip_id, neden) VALUES ('area', p_alan, 'yonetici_duzenleme')
    ON CONFLICT DO NOTHING;
    PERFORM yarenler_alan_kanoniklestir();
    RETURN jsonb_build_object('once', v_once, 'sonra', yarenler_yonetici_alan_ozet(p_alan),
                              'eski_slug', r.slug, 'yeni_slug', (SELECT slug FROM research_area WHERE id = p_alan));
END $$;

-- Bir alanı başka bir alana katar. Kaynak ve hedef kanonik karşılıklarına çevrilir.
CREATE FUNCTION yarenler_yonetici_alan_birlestir(p_kaynak uuid, p_hedef uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s uuid; v_t uuid; v_once jsonb; v_hedef_once jsonb; v_kisiler uuid[]; v_slug text; m record;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('yarenler_alan_yonetim'));
    SELECT coalesce(kanonik_id, id) INTO v_s FROM research_area WHERE id = p_kaynak;
    SELECT coalesce(kanonik_id, id) INTO v_t FROM research_area WHERE id = p_hedef;
    IF v_s IS NULL OR v_t IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'YA010', MESSAGE = 'alan_yok';
    END IF;
    IF v_s = v_t THEN
        RAISE EXCEPTION USING ERRCODE = 'YA013', MESSAGE = 'ayni_alan';
    END IF;
    PERFORM 1 FROM research_area WHERE id IN (v_s, v_t) OR kanonik_id = v_s ORDER BY id FOR UPDATE;
    v_once := yarenler_yonetici_alan_ozet(v_s);
    v_hedef_once := yarenler_yonetici_alan_ozet(v_t);
    SELECT slug INTO v_slug FROM research_area WHERE id = v_s;
    v_kisiler := ARRAY(SELECT pa.person_id FROM person_research_area pa JOIN research_area a ON a.id = pa.area_id
                        WHERE a.id = v_s OR a.kanonik_id = v_s
                       UNION
                       SELECT ca.person_id FROM person_collaboration_area ca JOIN research_area a ON a.id = ca.area_id
                        WHERE a.id = v_s OR a.kanonik_id = v_s);

    -- Katalog satırları kalır ve kalıcı olarak hedefe bağlanır.
    UPDATE research_area SET yonetici_hedef_id = v_t, guncelleme = now()
     WHERE (id = v_s OR kanonik_id = v_s) AND kaynak = 'katalog';
    -- Kullanıcı ve yönetici satırları: bağlar ve adlar hedefe taşınır, satır silinir, adresi 308 olur.
    FOR m IN SELECT id, ad_tr, ad_en, slug FROM research_area
              WHERE (id = v_s OR kanonik_id = v_s) AND kaynak <> 'katalog' LOOP
        INSERT INTO person_research_area (person_id, area_id, kaynak)
        SELECT person_id, v_t, kaynak FROM person_research_area WHERE area_id = m.id
        ON CONFLICT (person_id, area_id) DO NOTHING;
        INSERT INTO person_collaboration_area (person_id, area_id)
        SELECT person_id, v_t FROM person_collaboration_area WHERE area_id = m.id
        ON CONFLICT DO NOTHING;
        INSERT INTO announcement_area (announcement_id, area_id)
        SELECT announcement_id, v_t FROM announcement_area WHERE area_id = m.id
        ON CONFLICT DO NOTHING;
        INSERT INTO research_area_synonym (area_id, ad, normalize_ad, kaynak)
        SELECT v_t, n.ad, yarenler_katla(n.ad), 'editor'
          FROM (SELECT m.ad_tr AS ad UNION SELECT m.ad_en UNION SELECT s.ad FROM research_area_synonym s WHERE s.area_id = m.id) n
         WHERE n.ad IS NOT NULL
        ON CONFLICT (normalize_ad, area_id) DO NOTHING;
        UPDATE research_area_eski_adres SET area_id = v_t WHERE area_id = m.id;
        IF m.slug IS NOT NULL THEN
            INSERT INTO research_area_eski_adres (slug, area_id) VALUES (m.slug, v_t)
            ON CONFLICT (slug) DO UPDATE SET area_id = excluded.area_id;
        END IF;
        UPDATE research_area SET yonetici_hedef_id = v_t WHERE yonetici_hedef_id = m.id AND id <> v_t;
        DELETE FROM research_area WHERE id = m.id;
    END LOOP;

    UPDATE person SET guncelleme = now() WHERE id = ANY (v_kisiler);
    INSERT INTO semantic_refresh_queue (sahip_turu, sahip_id, neden)
    SELECT 'person', x, 'alan_birlesti' FROM unnest(v_kisiler) AS x
    ON CONFLICT DO NOTHING;
    INSERT INTO semantic_refresh_queue (sahip_turu, sahip_id, neden) VALUES ('area', v_t, 'alan_birlesti')
    ON CONFLICT DO NOTHING;
    PERFORM yarenler_alan_kanoniklestir();
    RETURN jsonb_build_object('once', jsonb_build_object('kaynak', v_once, 'hedef', v_hedef_once),
                              'sonra', yarenler_yonetici_alan_ozet(v_t),
                              'eski_slug', v_slug, 'yeni_slug', (SELECT slug FROM research_area WHERE id = v_t),
                              'kisi_sayisi', cardinality(v_kisiler));
END $$;

-- Yalnız kullanıcı ve yönetici alanları silinir; bağlar kaldırılır. Başka alanlar bu alana bağlıysa
-- (kanonik ya da yönetici birleştirmesi) silinmez, birleştirme kullanılmalı.
CREATE FUNCTION yarenler_yonetici_alan_sil(p_alan uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r research_area%ROWTYPE; v_once jsonb; v_kisiler uuid[];
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('yarenler_alan_yonetim'));
    SELECT * INTO r FROM research_area WHERE id = p_alan FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA010', MESSAGE = 'alan_yok';
    END IF;
    IF r.kaynak = 'katalog' THEN
        RAISE EXCEPTION USING ERRCODE = 'YA012', MESSAGE = 'katalog_silinmez';
    END IF;
    IF EXISTS (SELECT 1 FROM research_area WHERE (kanonik_id = p_alan OR yonetici_hedef_id = p_alan) AND id <> p_alan) THEN
        RAISE EXCEPTION USING ERRCODE = 'YA014', MESSAGE = 'bagli_alanlar';
    END IF;
    v_once := yarenler_yonetici_alan_ozet(p_alan);
    v_kisiler := ARRAY(SELECT person_id FROM person_research_area WHERE area_id = p_alan
                       UNION SELECT person_id FROM person_collaboration_area WHERE area_id = p_alan);
    DELETE FROM person_research_area WHERE area_id = p_alan;
    DELETE FROM person_collaboration_area WHERE area_id = p_alan;
    DELETE FROM research_area WHERE id = p_alan;
    UPDATE person SET guncelleme = now() WHERE id = ANY (v_kisiler);
    INSERT INTO semantic_refresh_queue (sahip_turu, sahip_id, neden)
    SELECT 'person', x, 'alan_silindi' FROM unnest(v_kisiler) AS x
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('once', v_once, 'eski_slug', r.slug, 'kisi_sayisi', cardinality(v_kisiler));
END $$;

-- Duyuru: kaldir, geri_al (yalnız yöneticinin kaldırdığı ve süresi dolmamış), uzat (toplam en çok 14 hafta).
CREATE FUNCTION yarenler_yonetici_duyuru(p_duyuru uuid, p_islem text, p_hafta integer DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a announcement%ROWTYPE;
BEGIN
    SELECT * INTO a FROM announcement WHERE id = p_duyuru FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA015', MESSAGE = 'duyuru_yok';
    END IF;
    IF p_islem = 'kaldir' THEN
        IF a.durum = 'kaldirildi' THEN
            RAISE EXCEPTION USING ERRCODE = 'YA015', MESSAGE = 'zaten_kaldirildi';
        END IF;
        UPDATE announcement SET durum = 'kaldirildi', yonetici_kaldirdi = true, guncelleme = now() WHERE id = a.id;
    ELSIF p_islem = 'geri_al' THEN
        IF a.durum <> 'kaldirildi' OR NOT a.yonetici_kaldirdi THEN
            RAISE EXCEPTION USING ERRCODE = 'YA015', MESSAGE = 'geri_alinamaz';
        END IF;
        IF a.bitis <= now() THEN
            RAISE EXCEPTION USING ERRCODE = 'YA015', MESSAGE = 'suresi_dolmus';
        END IF;
        UPDATE announcement SET durum = 'yayinda', yonetici_kaldirdi = false, guncelleme = now() WHERE id = a.id;
    ELSIF p_islem = 'uzat' THEN
        IF a.durum = 'kaldirildi' THEN
            RAISE EXCEPTION USING ERRCODE = 'YA015', MESSAGE = 'kaldirilmis';
        END IF;
        IF p_hafta IS NULL OR p_hafta < 1 OR p_hafta > 14 OR p_hafta <= a.sure_hafta
           OR a.yayin_tarihi + make_interval(weeks => p_hafta) <= now() THEN
            RAISE EXCEPTION USING ERRCODE = 'YA015', MESSAGE = 'sure_gecersiz';
        END IF;
        UPDATE announcement
           SET sure_hafta = p_hafta::smallint, bitis = a.yayin_tarihi + make_interval(weeks => p_hafta),
               durum = 'yayinda', guncelleme = now()
         WHERE id = a.id;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'YA015', MESSAGE = 'islem_gecersiz';
    END IF;
    RETURN (SELECT jsonb_build_object(
                'once', jsonb_build_object('durum', a.durum, 'bitis', a.bitis, 'sure_hafta', a.sure_hafta),
                'sonra', jsonb_build_object('durum', n.durum, 'bitis', n.bitis, 'sure_hafta', n.sure_hafta),
                'kisa_kimlik', n.kisa_kimlik, 'metin', n.yayin_metni)
              FROM announcement n WHERE n.id = a.id);
END $$;

-- Profil gizleme (sahibin kaldırmasıyla aynı: aktif=false, kaldirma_tarihi) ve yalnız yöneticinin gizlediğini geri açma.
CREATE FUNCTION yarenler_yonetici_profil(p_person uuid, p_gizle boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p person%ROWTYPE;
BEGIN
    SELECT * INTO p FROM person WHERE id = p_person FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA016', MESSAGE = 'profil_yok';
    END IF;
    IF p_gizle THEN
        IF NOT p.aktif THEN
            RAISE EXCEPTION USING ERRCODE = 'YA016', MESSAGE = 'zaten_gizli';
        END IF;
        UPDATE person SET aktif = false, yonetici_gizledi = true, kaldirma_tarihi = now(), guncelleme = now() WHERE id = p.id;
        DELETE FROM orcid_session WHERE person_id = p.id;
    ELSE
        IF p.aktif OR NOT p.yonetici_gizledi THEN
            RAISE EXCEPTION USING ERRCODE = 'YA016', MESSAGE = 'gosterilemez';
        END IF;
        UPDATE person SET aktif = true, yonetici_gizledi = false, kaldirma_tarihi = NULL, guncelleme = now() WHERE id = p.id;
    END IF;
    RETURN jsonb_build_object('once', jsonb_build_object('aktif', p.aktif, 'yonetici_gizledi', p.yonetici_gizledi),
                              'sonra', jsonb_build_object('aktif', NOT p_gizle, 'yonetici_gizledi', p_gizle),
                              'kisa_kimlik', p.kisa_kimlik, 'ad', p.gorunen_ad);
END $$;

-- Kısıtlama: ikisi de kapalıysa kayıt silinir; açıksa sebep zorunlu (3-500 karakter).
CREATE FUNCTION yarenler_yonetici_kisitla(p_person uuid, p_alan boolean, p_duyuru boolean, p_sebep text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_once jsonb; v_sebep text := btrim(regexp_replace(coalesce(p_sebep, ''), '\s+', ' ', 'g')); v_ad text;
BEGIN
    SELECT gorunen_ad INTO v_ad FROM person WHERE id = p_person;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA016', MESSAGE = 'profil_yok';
    END IF;
    SELECT jsonb_build_object('alan_ekleme', k.alan_ekleme, 'duyuru', k.duyuru, 'sebep', k.sebep) INTO v_once
      FROM kisi_kisitlamasi k WHERE k.person_id = p_person FOR UPDATE;
    IF NOT coalesce(p_alan, false) AND NOT coalesce(p_duyuru, false) THEN
        DELETE FROM kisi_kisitlamasi WHERE person_id = p_person;
        RETURN jsonb_build_object('once', v_once, 'sonra', NULL, 'ad', v_ad);
    END IF;
    IF char_length(v_sebep) < 3 OR char_length(v_sebep) > 500 THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'sebep_gecersiz';
    END IF;
    INSERT INTO kisi_kisitlamasi (person_id, alan_ekleme, duyuru, sebep)
    VALUES (p_person, coalesce(p_alan, false), coalesce(p_duyuru, false), v_sebep)
    ON CONFLICT (person_id) DO UPDATE
       SET alan_ekleme = excluded.alan_ekleme, duyuru = excluded.duyuru, sebep = excluded.sebep, guncelleme = now();
    RETURN jsonb_build_object('once', v_once,
                              'sonra', jsonb_build_object('alan_ekleme', coalesce(p_alan, false), 'duyuru', coalesce(p_duyuru, false), 'sebep', v_sebep),
                              'ad', v_ad);
END $$;

-- Kullanıcı ya da yönetici alanının "onaylandı" işareti (katalog alanları zaten onaylı; ileride onaylı
-- kullanıcı alanları indekslenebilir). Yalnız kanonik satır.
CREATE FUNCTION yarenler_yonetici_alan_onay(p_alan uuid, p_onayli boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r research_area%ROWTYPE;
BEGIN
    SELECT * INTO r FROM research_area WHERE id = p_alan AND kanonik_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA010', MESSAGE = 'alan_yok';
    END IF;
    IF r.kaynak = 'katalog' OR p_onayli IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'onay_gecersiz';
    END IF;
    UPDATE research_area SET onayli = p_onayli, guncelleme = now() WHERE id = r.id;
    RETURN jsonb_build_object('once', jsonb_build_object('onayli', r.onayli), 'sonra', jsonb_build_object('onayli', p_onayli),
                              'ad_tr', r.ad_tr, 'slug', r.slug);
END $$;

-- Sahiplenme talebi (0009): ORCID ile kayıt olmak isteyen ve ORCID'siz bir AVESİS profiline benzeyen kişi.
-- Ad benzerliğiyle otomatik sahiplenme yoktur; buradaki onay yöneticinin açık, elle verdiği karardır.
--   onayla: talepteki (OAuth ile doğrulanmış) ORCID profile bağlanır, profil sahiplenilmiş sayılır (içe aktarma
--           ORCID'i ezmez), kanıt person_identifier_resolution.evidence içinde kaynak 'yonetici'. Aynı profil ya da
--           aynı ORCID için açık diğer talepler reddedilir. Açık ORCID oturumu profile bağlanır.
--   reddet: talep reddedilir; kişi ayrı profil açabilir (kayıt akışı reddedilen eşleşmeyi yeniden önermez).
--   not:    yalnız not.
-- Hatalar: YA018 talep yok, YA019 talep işlenmiş, YA020 profil bağlanamaz (MESSAGE: profil_gizli, profil_orcidli,
-- orcid_kullaniliyor), YA017 not uzun / karar geçersiz.
CREATE FUNCTION yarenler_yonetici_talep(p_talep uuid, p_karar text, p_not text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t profil_sahiplenme_talebi%ROWTYPE; p person%ROWTYPE; v_not text := nullif(btrim(coalesce(p_not, '')), '');
        v_diger integer := 0;
BEGIN
    SELECT * INTO t FROM profil_sahiplenme_talebi WHERE id = p_talep FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA018', MESSAGE = 'talep_yok';
    END IF;
    IF char_length(v_not) > 1000 THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'not_uzun';
    END IF;
    IF p_karar = 'not' THEN
        UPDATE profil_sahiplenme_talebi SET yonetici_notu = v_not WHERE id = t.id;
        RETURN jsonb_build_object('once', jsonb_build_object('not', t.yonetici_notu), 'sonra', jsonb_build_object('not', v_not));
    END IF;
    IF p_karar NOT IN ('onayla', 'reddet') THEN
        RAISE EXCEPTION USING ERRCODE = 'YA017', MESSAGE = 'karar_gecersiz';
    END IF;
    IF t.durum <> 'acik' THEN
        RAISE EXCEPTION USING ERRCODE = 'YA019', MESSAGE = 'talep_islenmis';
    END IF;
    SELECT * INTO p FROM person WHERE id = t.person_id FOR UPDATE;
    IF p_karar = 'onayla' THEN
        PERFORM pg_advisory_xact_lock(hashtext('orcid:' || t.orcid));
        IF NOT p.aktif THEN
            RAISE EXCEPTION USING ERRCODE = 'YA020', MESSAGE = 'profil_gizli';
        END IF;
        IF p.orcid IS NOT NULL AND p.orcid <> t.orcid THEN
            RAISE EXCEPTION USING ERRCODE = 'YA020', MESSAGE = 'profil_orcidli';
        END IF;
        IF EXISTS (SELECT 1 FROM person x WHERE x.orcid = t.orcid AND x.id <> p.id)
           OR EXISTS (SELECT 1 FROM person_identifier_resolution r WHERE r.orcid = t.orcid AND r.person_id <> p.id) THEN
            RAISE EXCEPTION USING ERRCODE = 'YA020', MESSAGE = 'orcid_kullaniliyor';
        END IF;
        UPDATE person SET orcid = t.orcid, sahiplenildi = true, sahiplenme_tarihi = coalesce(sahiplenme_tarihi, now()),
                          guncelleme = now()
         WHERE id = p.id;
        INSERT INTO person_identifier_resolution (person_id, orcid, source_url, evidence)
        VALUES (p.id, t.orcid, 'https://pub.orcid.org/v3.0/' || t.orcid || '/person',
                jsonb_build_object('kaynak', 'yonetici', 'talep', t.id, 'neden', t.neden, 'tarih', now()))
        ON CONFLICT (person_id) DO UPDATE
           SET orcid = excluded.orcid, source_url = excluded.source_url, evidence = excluded.evidence, checked_at = now();
        UPDATE orcid_session SET person_id = p.id WHERE orcid = t.orcid AND person_id IS NULL AND bitis > now();
        UPDATE profil_sahiplenme_talebi
           SET durum = 'reddedildi', islenme = now(), yonetici_notu = coalesce(yonetici_notu, 'Başka bir talep onaylandı.')
         WHERE durum = 'acik' AND id <> t.id AND (person_id = p.id OR orcid = t.orcid);
        GET DIAGNOSTICS v_diger = ROW_COUNT;
    END IF;
    UPDATE profil_sahiplenme_talebi
       SET durum = CASE WHEN p_karar = 'onayla' THEN 'onaylandi' ELSE 'reddedildi' END, islenme = now(), yonetici_notu = v_not
     WHERE id = t.id;
    -- Kayıt taslağındaki eşleşme önbelleği bir sonraki girişte yeniden hesaplanır.
    DELETE FROM orcid_kayit_taslagi WHERE orcid = t.orcid;
    RETURN jsonb_build_object(
        'once', jsonb_build_object('durum', t.durum, 'not', t.yonetici_notu, 'profil_orcid', p.orcid, 'sahiplenildi', p.sahiplenildi),
        'sonra', jsonb_build_object('durum', CASE WHEN p_karar = 'onayla' THEN 'onaylandi' ELSE 'reddedildi' END, 'not', v_not,
                                    'profil_orcid', CASE WHEN p_karar = 'onayla' THEN t.orcid ELSE p.orcid END,
                                    'kanit', CASE WHEN p_karar = 'onayla' THEN 'yonetici' END, 'reddedilen_diger', v_diger),
        'kisa_kimlik', p.kisa_kimlik, 'ad', p.gorunen_ad, 'orcid', t.orcid);
END $$;

REVOKE ALL ON FUNCTION yarenler_yonetici_alan_ekle(text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_alan_duzenle(uuid, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_alan_birlestir(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_alan_sil(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_duyuru(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_profil(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_kisitla(uuid, boolean, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_talep(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_alan_onay(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_es_anlamlilar(uuid, text[]) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Yetkiler. yarenler_admin yoksa göç onu giriş yapamayan (NOLOGIN) rol olarak açmayı dener; göç rolünün
-- CREATEROLE yetkisi yoksa uyarı yazar ve yetki adımını atlar (rol sonra açılınca infra/admin/grants.sql).
-- Giriş ve şifre her durumda elle verilir (DEVIR.md, "Yönetici paneli"): ALTER ROLE yarenler_admin LOGIN PASSWORD ...
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_admin') THEN
        BEGIN
            CREATE ROLE yarenler_admin NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 5;
            RAISE NOTICE 'yarenler_admin NOLOGIN olarak açıldı; giriş için yetkili bağlantıyla ALTER ROLE yarenler_admin LOGIN PASSWORD verin.';
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE WARNING 'yarenler_admin rolü yok ve göç rolü rol açamıyor. Yetkili bağlantıyla rolü açıp infra/admin/grants.sql dosyasını çalıştırın.';
        END;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_admin') THEN
        BEGIN
            EXECUTE format('GRANT CONNECT ON DATABASE %I TO yarenler_admin', current_database());
            GRANT USAGE ON SCHEMA public TO yarenler_admin;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE WARNING 'yarenler_admin için CONNECT/USAGE verilemedi; varsayılan PUBLIC yetkileri geçerli.';
        END;
        GRANT SELECT ON person, unit, institution, research_area, research_area_synonym, research_area_eski_adres,
                        person_research_area, person_collaboration_area, person_matching_area, announcement,
                        alan_denetimi, profil_sahiplenme_talebi, ai_call_log, kisi_kisitlamasi, veri_aktarimi TO yarenler_admin;
        GRANT SELECT, INSERT, UPDATE, DELETE ON yonetici_oturum, yonetici_giris_denemesi TO yarenler_admin;
        GRANT SELECT, INSERT ON yonetici_islem TO yarenler_admin;
        GRANT EXECUTE ON FUNCTION yarenler_yonetici_alan_ekle(text, text, text[]),
                                  yarenler_yonetici_alan_duzenle(uuid, text, text, text[]),
                                  yarenler_yonetici_alan_birlestir(uuid, uuid),
                                  yarenler_yonetici_alan_sil(uuid),
                                  yarenler_yonetici_alan_onay(uuid, boolean),
                                  yarenler_yonetici_duyuru(uuid, text, integer),
                                  yarenler_yonetici_profil(uuid, boolean),
                                  yarenler_yonetici_kisitla(uuid, boolean, boolean, text),
                                  yarenler_yonetici_talep(uuid, text, text),
                                  yarenler_kisitli(uuid, text) TO yarenler_admin;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_auth') THEN
        GRANT EXECUTE ON FUNCTION yarenler_kisitli(uuid, text) TO yarenler_auth;
        GRANT SELECT ON research_area_eski_adres TO yarenler_auth;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_web') THEN
        GRANT SELECT ON research_area_eski_adres TO yarenler_web;
    END IF;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION yarenler_alan_ekle(p_denetim uuid, p_person uuid, p_secim text, p_alan uuid DEFAULT NULL)
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
CREATE OR REPLACE FUNCTION yarenler_alan_kanoniklestir() RETURNS integer
    LANGUAGE plpgsql AS $$
DECLARE degisen integer;
BEGIN
    WITH aday AS (
        SELECT a.id,
               yarenler_alan_anahtar(coalesce(a.ad_tr, a.ad_en)) AS anahtar,
               (SELECT count(*) FROM person_research_area pa WHERE pa.area_id = a.id) AS kisi,
               array_position(ARRAY['avesis','scopus','wos','openalex','yarenler']::alan_semasi[], a.sema) AS sira
          FROM research_area a
    ), secim AS (
        SELECT id, anahtar,
               first_value(id) OVER (PARTITION BY anahtar ORDER BY kisi DESC, sira, id) AS kanonik
          FROM aday WHERE anahtar IS NOT NULL
    ), guncel AS (
        UPDATE research_area a
           SET kanonik_id = CASE WHEN s.kanonik = a.id THEN NULL ELSE s.kanonik END,
               guncelleme = now()
          FROM secim s
         WHERE s.id = a.id AND a.kanonik_id IS DISTINCT FROM CASE WHEN s.kanonik = a.id THEN NULL ELSE s.kanonik END
        RETURNING a.id
    )
    SELECT count(*) INTO degisen FROM guncel;

    INSERT INTO research_area_synonym (area_id, ad, dil, normalize_ad, kaynak)
    SELECT DISTINCT ON (a.kanonik_id, yarenler_katla(n.ad)) a.kanonik_id, n.ad, n.dil, yarenler_katla(n.ad), 'sema'
      FROM research_area a
      CROSS JOIN LATERAL (VALUES (a.ad_tr, 'tr'), (a.ad_en, 'en')) AS n(ad, dil)
     WHERE a.kanonik_id IS NOT NULL AND n.ad IS NOT NULL
    ON CONFLICT (normalize_ad, area_id) DO NOTHING;

    PERFORM yarenler_alan_ingilizce_doldur();
    PERFORM yarenler_alan_slug_ata();
    RETURN degisen;
END $$;
DROP TRIGGER announcement_kisitlama ON announcement;
DROP FUNCTION yarenler_duyuru_kisitlama();
DROP FUNCTION yarenler_yonetici_talep(uuid, text, text);
DROP FUNCTION yarenler_yonetici_alan_onay(uuid, boolean);
DROP FUNCTION yarenler_yonetici_kisitla(uuid, boolean, boolean, text);
DROP FUNCTION yarenler_yonetici_profil(uuid, boolean);
DROP FUNCTION yarenler_yonetici_duyuru(uuid, text, integer);
DROP FUNCTION yarenler_yonetici_alan_sil(uuid);
DROP FUNCTION yarenler_yonetici_alan_birlestir(uuid, uuid);
DROP FUNCTION yarenler_yonetici_alan_duzenle(uuid, text, text, text[]);
DROP FUNCTION yarenler_yonetici_alan_ekle(text, text, text[]);
DROP FUNCTION yarenler_yonetici_es_anlamlilar(uuid, text[]);
DROP FUNCTION yarenler_yonetici_alan_ozet(uuid);
DROP FUNCTION yarenler_alan_slug_yeni(text, uuid);
DROP FUNCTION yarenler_yonetici_ad(text);
DROP FUNCTION yarenler_kisitli(uuid, text);
DROP TABLE yonetici_islem;
DROP TABLE yonetici_giris_denemesi;
DROP TABLE yonetici_oturum;
DROP TABLE kisi_kisitlamasi;
DROP TABLE research_area_eski_adres;
ALTER TABLE profil_sahiplenme_talebi DROP COLUMN yonetici_notu, DROP COLUMN islenme;
ALTER TABLE person DROP COLUMN yonetici_gizledi;
ALTER TABLE announcement DROP COLUMN yonetici_kaldirdi;
-- Panelden eklenen alanlar silinmez (profillere bağlı olabilir); denetlenmemiş kullanıcı alanı olarak kalır.
UPDATE research_area SET kaynak = 'kullanici', ai_denetim = 'denetlenmedi' WHERE kaynak = 'yonetici';
UPDATE research_area SET ad_en_kaynak = 'kaynak' WHERE ad_en_kaynak = 'yonetici';
DROP INDEX research_area_yonetici_idx;
DROP INDEX research_area_yonetici_hedef_idx;
ALTER TABLE research_area
    DROP CONSTRAINT research_area_yonetici_hedef_kendisi_degil,
    DROP COLUMN yonetici_hedef_id;
ALTER TABLE research_area DROP CONSTRAINT research_area_ad_en_kaynak_check;
ALTER TABLE research_area ADD CONSTRAINT research_area_ad_en_kaynak_check CHECK (ad_en_kaynak IN ('avesis_sozluk', 'kaynak', 'yapay_zeka'));
ALTER TABLE research_area DROP CONSTRAINT research_area_kullanici_alani;
ALTER TABLE research_area ADD CONSTRAINT research_area_kullanici_alani
    CHECK (kaynak = 'katalog' OR (sema = 'yarenler' AND ai_denetim IS NOT NULL));
ALTER TABLE research_area DROP CONSTRAINT research_area_kaynak_check;
ALTER TABLE research_area ADD CONSTRAINT research_area_kaynak_check CHECK (kaynak IN ('katalog', 'kullanici'));
COMMENT ON COLUMN research_area.kaynak IS 'katalog: AVESİS, WoS, Scopus, OpenAlex içe aktarımı; kullanici: hocanın Profilim''den eklediği alan';
SELECT yarenler_alan_kanoniklestir();
