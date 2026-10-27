-- migrate:up
-- Duyuru: tek adımlı yapay zekâ denetimi, günlük hak, ihlal kaydı, duyuru ve platform yasakları.
--
-- Akış (uygulama, src/server/announcement-publish.ts): yarenler_duyuru_deneme_baslat (yasaklar ve günlük hak;
-- hak doluysa yapay zekâ çağrılmaz) > yapay zekâ denetimi > yarenler_duyuru_denetim_sonucu (ret ve ağır ihlal
-- kaydı, ağır ihlalde duyuru yasağı) ya da aynı işlemde duyuru eklemesi ve 'kabul'.
--
-- Günlük hak (Europe/Istanbul takvim günü): kişi başı bir deneme. 'baslatildi', 'kabul', 'ret' ve 'agir_ihlal'
-- hakkı tüketir; 'hata' (yapay zekâ zaman aşımı, bozuk yanıt) tüketmez. Kısmi benzersiz dizin
-- duyuru_denemesi_gunluk bunu yapısal ve atomik yapar: aynı anda iki istekten biri benzersizlik hatası alır.
-- 3 dakikadan uzun süren 'baslatildi' (çökmüş süreç) yeni denemede 'hata' sayılır. Ayrıca duyuru_gunluk_yayin
-- günde bir yayını duyuru tablosunda da garanti eder; duyuru silinse de hak geri açılmaz.
--
-- Hata kodları:
--   YA021 platform yasağı (DETAIL: bitiş ISO 8601 UTC ya da boş = süresiz)
--   YA022 duyuru yasağı sürüyor (DETAIL: bitiş, ISO 8601 UTC)
--   YA023 bugünkü duyuru hakkı kullanıldı
--   YA025 deneme geçersiz (yok, başka kişinin ya da sonuçlanmış)
--   YA027 yönetici yasak işlemi geçersiz (MESSAGE: gerekce_gecersiz, orcid_gecersiz, zaten_yasakli, yasak_yok,
--         gun_gecersiz, islem_gecersiz, profil_yok)
--
-- KVKK: IP adresi ve User-Agent özeti yalnız icerik_ihlali tablosunda tutulur; yarenler_ihlal_temizle(180)
-- 180 günden eski ihlal ve deneme kayıtlarını ve süresi geçmiş yasakları siler (bakım görevi ve uygulama).

CREATE FUNCTION yarenler_bugun() RETURNS date
    LANGUAGE sql STABLE SET search_path = public, pg_temp
    RETURN (now() AT TIME ZONE 'Europe/Istanbul')::date;

ALTER TABLE announcement ADD COLUMN anahtar_kelimeler text[] NOT NULL DEFAULT '{}'
    CONSTRAINT announcement_anahtar_kelimeler_sinir CHECK (cardinality(anahtar_kelimeler) <= 16);
COMMENT ON COLUMN announcement.anahtar_kelimeler IS 'Yapay zekâ denetiminin çıkardığı araştırma kavramları; potansiyel yaren araması için';

-- Yapay zekâ denemeleri. Metin, IP ve User-Agent saklanmaz.
CREATE TABLE duyuru_denemesi (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    person_id        uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    gun              date NOT NULL,
    durum            text NOT NULL DEFAULT 'baslatildi' CHECK (durum IN ('baslatildi', 'kabul', 'ret', 'agir_ihlal', 'hata')),
    kategori         text CHECK (kategori IN ('hakaret', 'nefret', 'taciz', 'cinsel', 'siddet', 'reklam_spam',
                                              'anlamsiz', 'akademik_degil', 'kisisel_veri', 'diger')),
    announcement_id  uuid REFERENCES announcement(id) ON DELETE SET NULL,
    olusturma        timestamptz NOT NULL DEFAULT now(),
    sonuclanma       timestamptz
);
-- Günde bir deneme: 'hata' dışındaki tek satır (atomik sınır).
CREATE UNIQUE INDEX duyuru_denemesi_gunluk ON duyuru_denemesi (person_id, gun) WHERE durum <> 'hata';
CREATE INDEX duyuru_denemesi_kisi_idx ON duyuru_denemesi (person_id, gun);
CREATE INDEX duyuru_denemesi_zaman_idx ON duyuru_denemesi (olusturma);

-- Kişi başı günde bir yayımlanmış duyuru. Duyuru kaldırılsa ya da silinse de satır kalır.
CREATE TABLE duyuru_gunluk_yayin (
    person_id        uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    gun              date NOT NULL,
    announcement_id  uuid REFERENCES announcement(id) ON DELETE SET NULL,
    olusturma        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (person_id, gun)
);
-- Göçün yapıldığı gün yayımlanmış duyurular bugünün hakkını kullanmış sayılır.
INSERT INTO duyuru_gunluk_yayin (person_id, gun, announcement_id, olusturma)
SELECT DISTINCT ON (a.sahip_id) a.sahip_id, yarenler_bugun(), a.id, a.yayin_tarihi
  FROM announcement a
 WHERE (a.yayin_tarihi AT TIME ZONE 'Europe/Istanbul')::date = yarenler_bugun()
 ORDER BY a.sahip_id, a.yayin_tarihi;

-- İhlal kaydı: reddedilen her deneme ve her ağır ihlal. Kişi silinse de ORCID, ad ve kurum anlık görüntüsü kalır.
CREATE TABLE icerik_ihlali (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    person_id   uuid REFERENCES person(id) ON DELETE SET NULL,
    orcid       text CHECK (orcid ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
    ad          text CHECK (char_length(ad) <= 300),
    kurum       text CHECK (char_length(kurum) <= 300),
    karar       text NOT NULL CHECK (karar IN ('ret', 'agir_ihlal')),
    kategori    text NOT NULL CHECK (kategori IN ('hakaret', 'nefret', 'taciz', 'cinsel', 'siddet', 'reklam_spam',
                                                  'anlamsiz', 'akademik_degil', 'kisisel_veri', 'diger')),
    gerekce     text NOT NULL CHECK (char_length(gerekce) <= 400),
    metin       text NOT NULL CHECK (char_length(metin) <= 5000),
    model       text CHECK (char_length(model) <= 100),
    ip          inet,
    user_agent  text CHECK (char_length(user_agent) <= 200),
    olusturma   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX icerik_ihlali_zaman_idx ON icerik_ihlali (olusturma DESC);
CREATE INDEX icerik_ihlali_kisi_idx ON icerik_ihlali (person_id);

-- Duyuru yasağı (yeni alan eklemeyi de kapatır). Etkin: bitis > now().
CREATE TABLE duyuru_yasagi (
    person_id   uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
    bitis       timestamptz NOT NULL,
    neden       text NOT NULL CHECK (neden IN ('agir_ihlal', 'yonetici')),
    kategori    text CHECK (kategori IN ('hakaret', 'nefret', 'taciz', 'cinsel', 'siddet', 'reklam_spam',
                                         'anlamsiz', 'akademik_degil', 'kisisel_veri', 'diger')),
    gerekce     text CHECK (char_length(gerekce) BETWEEN 3 AND 500),
    ihlal_id    uuid REFERENCES icerik_ihlali(id) ON DELETE SET NULL,
    olusturma   timestamptz NOT NULL DEFAULT now(),
    guncelleme  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX duyuru_yasagi_bitis_idx ON duyuru_yasagi (bitis);

-- Platform yasağı: kişi ve ORCID düzeyinde (biri ya da ikisi). Süresiz (bitis boş) ya da süreli.
-- Giriş, oturum, yeniden kayıt (aynı ORCID ya da aynı profil), profil düzenleme, duyuru ve alan ekleme kapanır.
CREATE TABLE platform_yasagi (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    person_id        uuid UNIQUE REFERENCES person(id) ON DELETE SET NULL,
    orcid            text UNIQUE CHECK (orcid ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
    ad               text CHECK (char_length(ad) <= 300),
    gerekce          text NOT NULL CHECK (char_length(gerekce) BETWEEN 3 AND 500),
    bitis            timestamptz,
    profil_gizlendi  boolean NOT NULL DEFAULT false,
    olusturma        timestamptz NOT NULL DEFAULT now(),
    CHECK (bitis IS NULL OR bitis > olusturma)
);

-- ---------------------------------------------------------------------------
-- Okuma işlevleri (yarenler_auth tablolara doğrudan erişmez)
-- ---------------------------------------------------------------------------
-- Etkin platform yasağı: kişi kimliği ya da ORCID ile (profil ORCID'e bağlıysa ikisi birbirini kapsar).
-- Dönüş: NULL (yasak yok) ya da {"bitis": zaman | null}.
CREATE FUNCTION yarenler_platform_yasagi(p_person uuid, p_orcid text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    RETURN (SELECT jsonb_build_object('bitis', b.bitis)
              FROM platform_yasagi b
             WHERE (b.bitis IS NULL OR b.bitis > now())
               AND (b.person_id = p_person
                    OR b.orcid = p_orcid
                    OR b.person_id = (SELECT p.id FROM person p WHERE p.orcid = p_orcid)
                    OR b.orcid = (SELECT p.orcid FROM person p WHERE p.id = p_person))
             ORDER BY b.bitis DESC NULLS FIRST
             LIMIT 1);

CREATE FUNCTION yarenler_orcid_yasakli(p_orcid text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    RETURN p_orcid IS NOT NULL AND yarenler_platform_yasagi(NULL, p_orcid) IS NOT NULL;

-- Formun ve merkezi erişim denetiminin durumu: platform yasağı, duyuru yasağı, yönetici kısıtları, bugünkü hak.
CREATE FUNCTION yarenler_duyuru_durumu(p_person uuid) RETURNS jsonb
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

-- 0014 kısıtına yasaklar eklendi: etkin duyuru yasağı ya da platform yasağı yeni alan eklemeyi ve duyuruyu kapatır.
-- yarenler_alan_ekle (YA004) ve duyuru tetikleyicisi bu işlevi kullanır.
CREATE OR REPLACE FUNCTION yarenler_kisitli(p_person uuid, p_tur text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    RETURN coalesce((SELECT CASE p_tur WHEN 'alan' THEN k.alan_ekleme WHEN 'duyuru' THEN k.duyuru END
                       FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false)
        OR (p_tur IN ('alan', 'duyuru') AND EXISTS (SELECT 1 FROM duyuru_yasagi y WHERE y.person_id = p_person AND y.bitis > now()))
        OR (p_tur IN ('alan', 'duyuru') AND yarenler_platform_yasagi(p_person, NULL) IS NOT NULL);

-- Hata ayrıntısı için zaman biçimi.
CREATE FUNCTION yarenler_iso(p timestamptz) RETURNS text
    LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
    RETURN to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

-- Duyuru eklemesi: önce platform yasağı (YA021), duyuru yasağı (YA022), yönetici kısıtı (YA005).
CREATE OR REPLACE FUNCTION yarenler_duyuru_kisitlama() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bitis timestamptz; v_platform jsonb;
BEGIN
    v_platform := yarenler_platform_yasagi(NEW.sahip_id, NULL);
    IF v_platform IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'YA021', MESSAGE = 'platform_yasagi', DETAIL = coalesce(v_platform->>'bitis', '');
    END IF;
    SELECT bitis INTO v_bitis FROM duyuru_yasagi WHERE person_id = NEW.sahip_id AND bitis > now();
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA022', MESSAGE = 'duyuru_yasagi', DETAIL = yarenler_iso(v_bitis);
    END IF;
    IF yarenler_kisitli(NEW.sahip_id, 'duyuru') THEN
        RAISE EXCEPTION USING ERRCODE = 'YA005', MESSAGE = 'duyuru_kisitli';
    END IF;
    RETURN NEW;
END $$;

-- Günde bir duyuru (YA023). Satır eklendikten sonra çalışır (yabancı anahtar için); eşzamanlı iki ekleme
-- birincil anahtarda sıraya girer, ikincisi YA023 alır.
CREATE FUNCTION yarenler_duyuru_gunluk() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO duyuru_gunluk_yayin (person_id, gun, announcement_id)
    VALUES (NEW.sahip_id, yarenler_bugun(), NEW.id)
    ON CONFLICT (person_id, gun) DO NOTHING;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA023', MESSAGE = 'gunluk_sinir';
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER announcement_gunluk AFTER INSERT ON announcement
    FOR EACH ROW EXECUTE FUNCTION yarenler_duyuru_gunluk();

-- ---------------------------------------------------------------------------
-- Deneme başlatma ve sonuç
-- ---------------------------------------------------------------------------
-- Yasakları ve günlük hakkı denetler, hakkı ayırır ('baslatildi'). Kapalıysa yapay zekâ çağrılmaz.
CREATE FUNCTION yarenler_duyuru_deneme_baslat(p_person uuid) RETURNS uuid
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

-- Sonuç: 'kabul' (p_duyuru ile, duyuru eklemesiyle aynı işlemde), 'ret', 'agir_ihlal' ya da 'hata' (hak geri açılır).
-- 'ret' ve 'agir_ihlal': ihlal kaydı (metin, gerekçe, IP, User-Agent özeti). 'agir_ihlal': p_yasak_gun günlük duyuru
-- yasağı (etkin yasak varsa daha geç bitiş geçerli). Dönüş: {"yasak": {...} | null, "ihlal": kimlik | null}.
CREATE FUNCTION yarenler_duyuru_denetim_sonucu(
    p_deneme uuid, p_person uuid, p_durum text, p_kategori text, p_gerekce text, p_duyuru uuid,
    p_metin text, p_model text, p_ip inet, p_user_agent text, p_yasak_gun integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ihlal uuid; v_bitis timestamptz; v_kurum text; p person%ROWTYPE;
BEGIN
    IF p_durum NOT IN ('kabul', 'ret', 'agir_ihlal', 'hata')
       OR (p_durum IN ('ret', 'agir_ihlal') AND p_kategori IS NULL)
       OR (p_durum = 'kabul' AND p_duyuru IS NULL)
       OR p_yasak_gun IS NULL OR p_yasak_gun NOT BETWEEN 1 AND 365 THEN
        RAISE EXCEPTION USING ERRCODE = 'YA025', MESSAGE = 'sonuc_gecersiz';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('yarenler_duyuru:' || p_person::text, 0));
    UPDATE duyuru_denemesi
       SET durum = p_durum, kategori = CASE WHEN p_durum IN ('ret', 'agir_ihlal') THEN p_kategori END,
           announcement_id = p_duyuru, sonuclanma = now()
     WHERE id = p_deneme AND person_id = p_person AND durum = 'baslatildi';
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA025', MESSAGE = 'deneme_gecersiz';
    END IF;
    IF p_durum NOT IN ('ret', 'agir_ihlal') THEN
        RETURN jsonb_build_object('yasak', NULL, 'ihlal', NULL);
    END IF;

    SELECT * INTO p FROM person WHERE id = p_person;
    SELECT i.ad INTO v_kurum FROM institution i WHERE i.id = p.institution_id;
    INSERT INTO icerik_ihlali (person_id, orcid, ad, kurum, karar, kategori, gerekce, metin, model, ip, user_agent)
    VALUES (p_person, p.orcid, left(p.gorunen_ad, 300), left(coalesce(v_kurum, p.kurum_beyan), 300), p_durum, p_kategori,
            left(coalesce(p_gerekce, ''), 400), left(coalesce(p_metin, ''), 5000), left(p_model, 100), p_ip, left(p_user_agent, 200))
    RETURNING id INTO v_ihlal;
    IF p_durum = 'ret' THEN
        RETURN jsonb_build_object('yasak', NULL, 'ihlal', v_ihlal);
    END IF;
    INSERT INTO duyuru_yasagi (person_id, bitis, neden, kategori, ihlal_id)
    VALUES (p_person, now() + make_interval(days => p_yasak_gun), 'agir_ihlal', p_kategori, v_ihlal)
    ON CONFLICT (person_id) DO UPDATE
       SET bitis = greatest(CASE WHEN duyuru_yasagi.bitis > now() THEN duyuru_yasagi.bitis END, excluded.bitis),
           neden = excluded.neden, kategori = excluded.kategori, gerekce = NULL, ihlal_id = excluded.ihlal_id, guncelleme = now()
    RETURNING bitis INTO v_bitis;
    RETURN jsonb_build_object('yasak', jsonb_build_object('bitis', v_bitis, 'neden', 'agir_ihlal', 'kategori', p_kategori), 'ihlal', v_ihlal);
END $$;

-- ---------------------------------------------------------------------------
-- Yönetici işlevleri (yarenler_admin; her çağrı uygulamada yonetici_islem kaydına yazılır)
-- ---------------------------------------------------------------------------
CREATE FUNCTION yarenler_gerekce(p text) RETURNS text
    LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
    RETURN nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '');

-- Duyuru yasağı: 'ver' (bitiş = şimdi + p_gun gün; varsa süre yeniden ayarlanır) ya da 'kaldir'. Gerekçe zorunlu.
CREATE FUNCTION yarenler_yonetici_duyuru_yasagi(p_person uuid, p_islem text, p_gun integer, p_gerekce text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE y duyuru_yasagi%ROWTYPE; v_ad text; v_gerekce text := yarenler_gerekce(p_gerekce); v_once jsonb;
BEGIN
    IF v_gerekce IS NULL OR char_length(v_gerekce) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'gerekce_gecersiz';
    END IF;
    SELECT gorunen_ad INTO v_ad FROM person WHERE id = p_person;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'profil_yok';
    END IF;
    SELECT * INTO y FROM duyuru_yasagi WHERE person_id = p_person FOR UPDATE;
    v_once := CASE WHEN FOUND AND y.bitis > now() THEN jsonb_build_object('bitis', y.bitis, 'neden', y.neden, 'kategori', y.kategori, 'gerekce', y.gerekce) END;
    IF p_islem = 'kaldir' THEN
        IF v_once IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'yasak_yok';
        END IF;
        DELETE FROM duyuru_yasagi WHERE person_id = p_person;
        RETURN jsonb_build_object('once', v_once, 'sonra', NULL, 'ad', v_ad, 'gerekce', v_gerekce);
    ELSIF p_islem = 'ver' THEN
        IF p_gun IS NULL OR p_gun NOT BETWEEN 1 AND 365 THEN
            RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'gun_gecersiz';
        END IF;
        INSERT INTO duyuru_yasagi (person_id, bitis, neden, gerekce)
        VALUES (p_person, now() + make_interval(days => p_gun), 'yonetici', v_gerekce)
        ON CONFLICT (person_id) DO UPDATE
           SET bitis = excluded.bitis, gerekce = excluded.gerekce, guncelleme = now(),
               neden = CASE WHEN duyuru_yasagi.bitis > now() THEN duyuru_yasagi.neden ELSE 'yonetici' END,
               kategori = CASE WHEN duyuru_yasagi.bitis > now() THEN duyuru_yasagi.kategori END,
               ihlal_id = CASE WHEN duyuru_yasagi.bitis > now() THEN duyuru_yasagi.ihlal_id END
        RETURNING * INTO y;
        RETURN jsonb_build_object('once', v_once, 'sonra', jsonb_build_object('bitis', y.bitis, 'neden', y.neden, 'kategori', y.kategori, 'gerekce', y.gerekce), 'ad', v_ad, 'gerekce', v_gerekce);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'islem_gecersiz';
END $$;

-- Platform yasağı: kişi (p_person) ya da ORCID (p_orcid; profili olmayan kişi de) ile. p_gun boşsa süresiz.
-- Yasaklama: oturumlar ve kayıt taslağı silinir, yayındaki duyurular yönetici kaldırması olarak kaldırılır, istenirse
-- profil gizlenir. Kaldırma: satır silinir; yasakla gizlenen profil yeniden görünür. Gerekçe her iki işlemde zorunlu.
CREATE FUNCTION yarenler_yonetici_platform_yasagi(p_person uuid, p_orcid text, p_yasakla boolean, p_gun integer, p_gerekce text, p_profil_gizle boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p person%ROWTYPE; b platform_yasagi%ROWTYPE; v_orcid text := nullif(upper(btrim(coalesce(p_orcid, ''))), '');
        v_gizle boolean := false; v_duyurular jsonb := '[]'::jsonb; v_gerekce text := yarenler_gerekce(p_gerekce);
BEGIN
    IF v_gerekce IS NULL OR char_length(v_gerekce) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'gerekce_gecersiz';
    END IF;
    IF v_orcid IS NOT NULL AND v_orcid !~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$' THEN
        RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'orcid_gecersiz';
    END IF;
    IF p_person IS NOT NULL THEN
        SELECT * INTO p FROM person WHERE id = p_person FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'profil_yok';
        END IF;
        v_orcid := coalesce(p.orcid, v_orcid);
    ELSIF v_orcid IS NOT NULL THEN
        SELECT * INTO p FROM person WHERE orcid = v_orcid FOR UPDATE;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'profil_yok';
    END IF;

    IF coalesce(p_yasakla, false) THEN
        IF p_gun IS NOT NULL AND p_gun NOT BETWEEN 1 AND 3650 THEN
            RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'gun_gecersiz';
        END IF;
        IF yarenler_platform_yasagi(p.id, v_orcid) IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'zaten_yasakli';
        END IF;
        -- Süresi geçmiş eski satırlar benzersizliği bozmasın.
        DELETE FROM platform_yasagi WHERE (person_id = p.id OR orcid = v_orcid) AND bitis IS NOT NULL AND bitis <= now();
        v_gizle := coalesce(p_profil_gizle, false) AND p.id IS NOT NULL AND p.aktif;
        INSERT INTO platform_yasagi (person_id, orcid, ad, gerekce, bitis, profil_gizlendi)
        VALUES (p.id, v_orcid, left(coalesce(p.gorunen_ad, (SELECT i.ad FROM icerik_ihlali i WHERE i.orcid = v_orcid ORDER BY i.olusturma DESC LIMIT 1)), 300),
                v_gerekce, CASE WHEN p_gun IS NOT NULL THEN now() + make_interval(days => p_gun) END, v_gizle)
        RETURNING * INTO b;
        DELETE FROM orcid_session WHERE (v_orcid IS NOT NULL AND orcid = v_orcid) OR (p.id IS NOT NULL AND person_id = p.id);
        IF v_orcid IS NOT NULL THEN
            DELETE FROM orcid_kayit_taslagi WHERE orcid = v_orcid;
        END IF;
        IF p.id IS NOT NULL THEN
            WITH k AS (
                UPDATE announcement SET durum = 'kaldirildi', yonetici_kaldirdi = true, guncelleme = now()
                 WHERE sahip_id = p.id AND durum = 'yayinda' RETURNING kisa_kimlik, yayin_metni)
            SELECT coalesce(jsonb_agg(jsonb_build_object('kisa_kimlik', k.kisa_kimlik, 'metin', k.yayin_metni)), '[]'::jsonb) INTO v_duyurular FROM k;
            IF v_gizle THEN
                UPDATE person SET aktif = false, yonetici_gizledi = true, kaldirma_tarihi = now(), guncelleme = now() WHERE id = p.id;
            END IF;
        END IF;
        RETURN jsonb_build_object('once', NULL,
                                  'sonra', jsonb_build_object('gerekce', v_gerekce, 'bitis', b.bitis, 'orcid', v_orcid, 'profil_gizlendi', v_gizle, 'kaldirilan_duyuru', jsonb_array_length(v_duyurular)),
                                  'id', b.id, 'ad', coalesce(p.gorunen_ad, b.ad), 'kisa_kimlik', p.kisa_kimlik, 'orcid', v_orcid, 'duyurular', v_duyurular, 'gerekce', v_gerekce);
    END IF;

    DELETE FROM platform_yasagi
     WHERE ((p.id IS NOT NULL AND person_id = p.id) OR (v_orcid IS NOT NULL AND orcid = v_orcid))
       AND (bitis IS NULL OR bitis > now())
    RETURNING * INTO b;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'YA027', MESSAGE = 'yasak_yok';
    END IF;
    -- Kişi ve ORCID için ayrı satır kaldıysa o da kalkar.
    DELETE FROM platform_yasagi WHERE (p.id IS NOT NULL AND person_id = p.id) OR (v_orcid IS NOT NULL AND orcid = v_orcid);
    IF b.profil_gizlendi AND p.id IS NOT NULL AND NOT p.aktif AND p.yonetici_gizledi THEN
        UPDATE person SET aktif = true, yonetici_gizledi = false, kaldirma_tarihi = NULL, guncelleme = now() WHERE id = p.id;
    END IF;
    RETURN jsonb_build_object('once', jsonb_build_object('gerekce', b.gerekce, 'bitis', b.bitis, 'profil_gizlendi', b.profil_gizlendi, 'olusturma', b.olusturma),
                              'sonra', NULL, 'id', b.id, 'ad', coalesce(p.gorunen_ad, b.ad), 'kisa_kimlik', p.kisa_kimlik, 'orcid', v_orcid,
                              'profil_geri', b.profil_gizlendi AND p.id IS NOT NULL AND NOT p.aktif AND p.yonetici_gizledi,
                              'duyurular', '[]'::jsonb, 'gerekce', v_gerekce);
END $$;

-- Saklama: p_gun günden (en az 30) eski ihlal kayıtları (metin, IP, User-Agent), denemeler, günlük yayın satırları ve
-- süresi geçmiş yasaklar silinir. Süresiz platform yasakları kaldırılana kadar kalır (IP içermez).
CREATE FUNCTION yarenler_ihlal_temizle(p_gun integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_sinir timestamptz := now() - make_interval(days => greatest(coalesce(p_gun, 180), 30)); n integer; toplam integer := 0;
BEGIN
    DELETE FROM duyuru_yasagi WHERE bitis < v_sinir; GET DIAGNOSTICS n = ROW_COUNT; toplam := toplam + n;
    DELETE FROM platform_yasagi WHERE bitis IS NOT NULL AND bitis < v_sinir; GET DIAGNOSTICS n = ROW_COUNT; toplam := toplam + n;
    DELETE FROM icerik_ihlali WHERE olusturma < v_sinir; GET DIAGNOSTICS n = ROW_COUNT; toplam := toplam + n;
    DELETE FROM duyuru_denemesi WHERE olusturma < v_sinir; GET DIAGNOSTICS n = ROW_COUNT; toplam := toplam + n;
    DELETE FROM duyuru_gunluk_yayin WHERE olusturma < v_sinir; GET DIAGNOSTICS n = ROW_COUNT; toplam := toplam + n;
    RETURN toplam;
END $$;

REVOKE ALL ON FUNCTION yarenler_bugun() FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_iso(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_gerekce(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_platform_yasagi(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_orcid_yasakli(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_duyuru_durumu(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_duyuru_gunluk() FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_duyuru_deneme_baslat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_duyuru_denetim_sonucu(uuid, uuid, text, text, text, uuid, text, text, inet, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_duyuru_yasagi(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_yonetici_platform_yasagi(uuid, text, boolean, integer, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_ihlal_temizle(integer) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_auth') THEN
        GRANT EXECUTE ON FUNCTION yarenler_bugun(), yarenler_platform_yasagi(uuid, text), yarenler_orcid_yasakli(text),
                                  yarenler_duyuru_durumu(uuid), yarenler_duyuru_deneme_baslat(uuid),
                                  yarenler_duyuru_denetim_sonucu(uuid, uuid, text, text, text, uuid, text, text, inet, text, integer),
                                  yarenler_ihlal_temizle(integer) TO yarenler_auth;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_admin') THEN
        GRANT SELECT ON icerik_ihlali, duyuru_yasagi, platform_yasagi, duyuru_denemesi, duyuru_gunluk_yayin TO yarenler_admin;
        GRANT EXECUTE ON FUNCTION yarenler_bugun(), yarenler_platform_yasagi(uuid, text), yarenler_duyuru_durumu(uuid),
                                  yarenler_yonetici_duyuru_yasagi(uuid, text, integer, text),
                                  yarenler_yonetici_platform_yasagi(uuid, text, boolean, integer, text, boolean),
                                  yarenler_ihlal_temizle(integer) TO yarenler_admin;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_maintenance') THEN
        GRANT EXECUTE ON FUNCTION yarenler_ihlal_temizle(integer) TO yarenler_maintenance;
    END IF;
END $$;

-- migrate:down
DROP TRIGGER announcement_gunluk ON announcement;
DROP FUNCTION yarenler_duyuru_gunluk();
CREATE OR REPLACE FUNCTION yarenler_duyuru_kisitlama() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF yarenler_kisitli(NEW.sahip_id, 'duyuru') THEN
        RAISE EXCEPTION USING ERRCODE = 'YA005', MESSAGE = 'duyuru_kisitli';
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION yarenler_kisitli(p_person uuid, p_tur text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
    RETURN coalesce((SELECT CASE p_tur WHEN 'alan' THEN k.alan_ekleme WHEN 'duyuru' THEN k.duyuru END
                       FROM kisi_kisitlamasi k WHERE k.person_id = p_person), false);
DROP FUNCTION yarenler_ihlal_temizle(integer);
DROP FUNCTION yarenler_yonetici_platform_yasagi(uuid, text, boolean, integer, text, boolean);
DROP FUNCTION yarenler_yonetici_duyuru_yasagi(uuid, text, integer, text);
DROP FUNCTION yarenler_duyuru_denetim_sonucu(uuid, uuid, text, text, text, uuid, text, text, inet, text, integer);
DROP FUNCTION yarenler_duyuru_deneme_baslat(uuid);
DROP FUNCTION yarenler_duyuru_durumu(uuid);
DROP FUNCTION yarenler_orcid_yasakli(text);
DROP FUNCTION yarenler_platform_yasagi(uuid, text);
DROP FUNCTION yarenler_gerekce(text);
DROP FUNCTION yarenler_iso(timestamptz);
DROP TABLE platform_yasagi;
DROP TABLE duyuru_yasagi;
DROP TABLE icerik_ihlali;
DROP TABLE duyuru_gunluk_yayin;
DROP TABLE duyuru_denemesi;
ALTER TABLE announcement DROP COLUMN anahtar_kelimeler;
DROP FUNCTION yarenler_bugun();
