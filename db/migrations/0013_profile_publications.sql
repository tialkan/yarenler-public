-- migrate:up
-- Profilde yayınlar ve veri tarihi (Paket 3).
--
-- 0.4 kararında yayınlar yalnız eşleştirmede kullanılıyordu; Paket 3 ile profil sayfası yayın sayısını
-- (türe göre) ve son beş yayını kaynak etiketi ve tarihle gösterir. Veri AVESİS yayın listesinden gelir
-- (pipeline `avesis-yayinlar`, ayrıştırıcı 0.2.0) ve apps/web/scripts/import.mjs ile yazılır. Yayın
-- ayrıntı sayfaları çekilmez; özet ve yazar listesi profilde gösterilmez.

-- ---------------------------------------------------------------------------
-- publication: kaynak, tekilleştirme anahtarı, dergi/etkinlik adı ve AVESİS yayın adresi
-- ---------------------------------------------------------------------------
ALTER TABLE publication
    ADD COLUMN anahtar text,
    ADD COLUMN kaynak text NOT NULL DEFAULT 'avesis' CHECK (kaynak IN ('avesis', 'openalex')),
    ADD COLUMN kaynak_adi text CHECK (length(kaynak_adi) BETWEEN 1 AND 300),
    ADD COLUMN avesis_yayin_id uuid,
    ADD COLUMN avesis_url text CHECK (avesis_url ~ '^https://avesis\.[a-z0-9.-]+/yayin/[0-9a-f-]{36}'),
    ADD CONSTRAINT publication_baslik_uzunluk CHECK (length(baslik) BETWEEN 1 AND 2000);
COMMENT ON COLUMN publication.anahtar IS 'Tekilleştirme anahtarı: doi:<doi> > openalex:<W> > avesis:<uuid> > baslik:<özet> (import.mjs, publication-plan.mjs)';
COMMENT ON COLUMN publication.kaynak_adi IS 'Dergi, etkinlik ya da kitap/yayınevi adı; yalnız kaynağın yazdığı metinden';
CREATE UNIQUE INDEX publication_anahtar_key ON publication (anahtar);

-- Kişi ile yayın: kaynağın listesindeki sırayla (AVESİS: sayfadaki sıra, yeni yayın önce).
CREATE TABLE person_publication (
    person_id       uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    publication_id  uuid NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
    kaynak          text NOT NULL DEFAULT 'avesis' CHECK (kaynak IN ('avesis', 'openalex')),
    sira            integer NOT NULL CHECK (sira >= 0),
    eklenme         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (person_id, publication_id)
);
CREATE INDEX person_publication_publication_idx ON person_publication (publication_id);

-- ---------------------------------------------------------------------------
-- Kaynak tarihi: kişinin kaynak sayfalarının en son okunduğu an (profilde "AVESİS · <tarih>")
-- ---------------------------------------------------------------------------
ALTER TABLE person ADD COLUMN kaynak_tarihi timestamptz;
COMMENT ON COLUMN person.kaynak_tarihi IS 'AVESİS sayfalarının en son okunduğu an (ham depo meta, pipeline kaynak_tarihi); bilinmiyorsa boş';

-- ---------------------------------------------------------------------------
-- İçe aktarma kaydı: alt bilgideki "Veri güncelleme" tarihi buradan gelir
-- ---------------------------------------------------------------------------
CREATE TABLE veri_aktarimi (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    kaynak         text NOT NULL CHECK (kaynak IN ('avesis', 'openalex')),
    baslangic      timestamptz NOT NULL DEFAULT now(),
    bitis          timestamptz,
    kaynak_tarihi  timestamptz,               -- girdideki en yeni kaynak okuma anı
    ozet           jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (bitis IS NULL OR bitis >= baslangic)
);
CREATE INDEX veri_aktarimi_bitis_idx ON veri_aktarimi (bitis DESC) WHERE bitis IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Yetkiler (roller yerelde ya da CI'da yoksa atlanır)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_web') THEN
        GRANT SELECT ON publication, person_publication, veri_aktarimi TO yarenler_web;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_auth') THEN
        GRANT SELECT ON publication, person_publication, veri_aktarimi TO yarenler_auth;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_indexer') THEN
        GRANT SELECT ON publication, person_publication TO yarenler_indexer;
    END IF;
END $$;

-- migrate:down
DROP TABLE veri_aktarimi;
ALTER TABLE person DROP COLUMN kaynak_tarihi;
DROP TABLE person_publication;
DROP INDEX publication_anahtar_key;
ALTER TABLE publication
    DROP CONSTRAINT publication_baslik_uzunluk,
    DROP COLUMN avesis_url,
    DROP COLUMN avesis_yayin_id,
    DROP COLUMN kaynak_adi,
    DROP COLUMN kaynak,
    DROP COLUMN anahtar;
