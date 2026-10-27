-- Yarenler göç 0001: çekirdek şema (plan 9.4 ve 0.4 kararları, ADR 0004)
-- Sahibi: A5 (v0'ı A0 yazdı). Yayından sonra değiştirilmez; değişiklik yeni göç ve ADR ile yapılır.
-- Gereksinim: PostgreSQL 18+ (uuidv7), pgvector, pg_trgm, unaccent, ICU destekli derleme.
-- Kodlar ASCII tanımlayıcıdır ve contracts/openapi.yaml enum'larıyla aynıdır.
-- 0.4: sade profil (ad, unvan, birim, alanlar), yalnız ORCID ile giriş, her şey herkese açık.

-- migrate:up

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Türkçe sıralama (plan 9.6)
CREATE COLLATION IF NOT EXISTS tr_icu (provider = icu, locale = 'tr-TR');

-- Arama ve eşleştirme için Türkçe katlama. Saklanan yazım değişmez; yalnız indeks ve sorguda kullanılır.
CREATE FUNCTION yarenler_katla(metin text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN public.unaccent('public.unaccent'::regdictionary, lower(metin COLLATE tr_icu));

CREATE TYPE alan_kaynagi AS ENUM ('avesis', 'kullanici', 'oneri');
CREATE TYPE alan_semasi AS ENUM ('openalex', 'avesis', 'wos', 'scopus', 'yarenler');

-- ---------------------------------------------------------------------------
-- Kurum ve birim
-- ---------------------------------------------------------------------------
CREATE TABLE institution (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    kisa_ad      text NOT NULL UNIQUE CHECK (kisa_ad ~ '^[a-z0-9-]+$'),   -- ör. aybu
    ad           text NOT NULL COLLATE tr_icu,
    ad_en        text,
    ulke         char(2) NOT NULL,
    ror          text UNIQUE,
    openalex_id  text UNIQUE,
    avesis_kok   text,                                                     -- ör. https://avesis.aybu.edu.tr
    olusturma    timestamptz NOT NULL DEFAULT now(),
    guncelleme   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unit (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    institution_id  uuid NOT NULL REFERENCES institution(id) ON DELETE CASCADE,
    ust_id          uuid REFERENCES unit(id) ON DELETE SET NULL,
    tur             text NOT NULL CHECK (tur IN ('fakulte', 'enstitu', 'yuksekokul', 'bolum', 'anabilim_dali', 'diger')),
    ad_tr           text NOT NULL COLLATE tr_icu,
    ad_en           text,
    slug            text NOT NULL,
    olusturma       timestamptz NOT NULL DEFAULT now(),
    guncelleme      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution_id, slug)
);
CREATE INDEX unit_ust_idx ON unit (ust_id);

-- ---------------------------------------------------------------------------
-- Kişi (sade profil: ad, unvan, birim, alanlar; ada tıklayınca AVESİS)
-- ---------------------------------------------------------------------------
CREATE TABLE person (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    kisa_kimlik        text NOT NULL UNIQUE CHECK (kisa_kimlik ~ '^[0-9a-z]{4,12}$'),   -- URL'deki kimlik (ADR 0003)
    institution_id     uuid NOT NULL REFERENCES institution(id),
    unit_id            uuid REFERENCES unit(id) ON DELETE SET NULL,
    ad                 text NOT NULL COLLATE tr_icu,
    soyad              text NOT NULL COLLATE tr_icu,
    gorunen_ad         text NOT NULL COLLATE tr_icu,
    unvan              text,                 -- ör. Prof. Dr.; sahibi PATCH /me/profile ile günceller
    unvan_kaynagi      text NOT NULL DEFAULT 'avesis' CHECK (unvan_kaynagi IN ('avesis', 'kullanici')),
    avesis_kullanici   text,                 -- AVESİS kullanıcı adı, profil bağlantısı bundan kurulur
    avesis_url         text,
    orcid              text UNIQUE CHECK (orcid ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
    openalex_id        text UNIQUE,
    sahiplenildi       boolean NOT NULL DEFAULT false,   -- ORCID ile ilk girişte true
    sahiplenme_tarihi  timestamptz,
    eposta             text,                 -- yalnız duyuruda sahibi açıkça seçerse gösterilir
    telefon            text,                 -- yalnız duyuruda sahibi açıkça seçerse gösterilir
    aktif              boolean NOT NULL DEFAULT true,
    olusturma          timestamptz NOT NULL DEFAULT now(),
    guncelleme         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution_id, avesis_kullanici),
    CHECK (sahiplenildi = (sahiplenme_tarihi IS NOT NULL)),
    CHECK (NOT sahiplenildi OR orcid IS NOT NULL)
);
CREATE INDEX person_unit_idx ON person (unit_id);
CREATE INDEX person_ad_sira_idx ON person (soyad, ad);
CREATE INDEX person_ad_trgm_idx ON person USING gin (yarenler_katla(gorunen_ad) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Merkezi çalışma alanı havuzu (0.4 madde 4)
-- ---------------------------------------------------------------------------
CREATE TABLE research_area (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    ad_tr          text COLLATE tr_icu,
    ad_en          text,
    normalize_ad   text NOT NULL,            -- yarenler_katla(coalesce(ad_tr, ad_en)); uygulama yazar
    ust_id         uuid REFERENCES research_area(id) ON DELETE SET NULL,
    sema           alan_semasi NOT NULL,
    dis_kimlik     text,                     -- ör. OpenAlex T10123, WoS kategori kodu
    duzey          smallint CHECK (duzey BETWEEN 0 AND 4),   -- OpenAlex: 0 alan grubu, 1 alan, 2 alt alan, 3 konu
    onayli         boolean NOT NULL DEFAULT false,   -- yapay zekâ ya da kullanıcı kaynaklı yeni alan onaya kadar false
    olusturma      timestamptz NOT NULL DEFAULT now(),
    guncelleme     timestamptz NOT NULL DEFAULT now(),
    CHECK (ad_tr IS NOT NULL OR ad_en IS NOT NULL),
    UNIQUE NULLS NOT DISTINCT (sema, dis_kimlik, normalize_ad)
);
CREATE INDEX research_area_ust_idx ON research_area (ust_id);
CREATE INDEX research_area_norm_idx ON research_area (normalize_ad);
CREATE INDEX research_area_norm_trgm_idx ON research_area USING gin (normalize_ad gin_trgm_ops);

CREATE TABLE research_area_synonym (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    area_id        uuid NOT NULL REFERENCES research_area(id) ON DELETE CASCADE,
    ad             text NOT NULL,
    dil            char(2) CHECK (dil IN ('tr', 'en')),
    normalize_ad   text NOT NULL,
    kaynak         text NOT NULL CHECK (kaynak IN ('sema', 'avesis', 'kullanici', 'yapay_zeka', 'editor')),
    olusturma      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (normalize_ad, area_id)
);
CREATE INDEX research_area_synonym_norm_idx ON research_area_synonym (normalize_ad);
CREATE INDEX research_area_synonym_trgm_idx ON research_area_synonym USING gin (normalize_ad gin_trgm_ops);

CREATE TABLE person_research_area (
    person_id  uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    area_id    uuid NOT NULL REFERENCES research_area(id) ON DELETE CASCADE,
    kaynak     alan_kaynagi NOT NULL,
    eklenme    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (person_id, area_id)
);
CREATE INDEX person_research_area_area_idx ON person_research_area (area_id);

-- ---------------------------------------------------------------------------
-- Yayınlar: yalnız eşleştirme hesabında kullanılır, profilde gösterilmez (0.4 madde 1)
-- ---------------------------------------------------------------------------
CREATE TABLE publication (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    doi           text UNIQUE,
    openalex_id   text UNIQUE,
    baslik        text NOT NULL,
    ozet          text,
    yil           smallint CHECK (yil BETWEEN 1900 AND 2100),
    tur           text,
    dil           text,
    konu_alanlari uuid[] NOT NULL DEFAULT '{}',   -- research_area kimlikleri (OpenAlex konuları)
    olusturma     timestamptz NOT NULL DEFAULT now(),
    guncelleme    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publication_yil_idx ON publication (yil);

CREATE TABLE publication_author (
    publication_id  uuid NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
    sira            smallint NOT NULL CHECK (sira >= 1),
    person_id       uuid REFERENCES person(id) ON DELETE SET NULL,   -- kurumdaki kişiyle eşleştiyse
    yazar_adi       text NOT NULL,
    PRIMARY KEY (publication_id, sira)
);
CREATE INDEX publication_author_person_idx ON publication_author (person_id);

-- ---------------------------------------------------------------------------
-- Eşleştirme ve harita
-- ---------------------------------------------------------------------------
CREATE TABLE affinity (
    person_a           uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    person_b           uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    sicaklik           real NOT NULL CHECK (sicaklik BETWEEN 0 AND 100),
    bant               text NOT NULL CHECK (bant IN ('cok_sicak', 'sicak', 'ilik', 'serin')),
    bilesenler         jsonb NOT NULL DEFAULT '{}',   -- ör. {"alan": 0.6, "yayin": 0.3, "birim": 0.1}
    gerekceler         jsonb NOT NULL DEFAULT '[]',   -- ortak alan adları; yapay zekâ metni değil
    mevcut_isbirligi   boolean NOT NULL DEFAULT false,
    hesaplama          timestamptz NOT NULL DEFAULT now(),
    model_surumu       text NOT NULL,
    PRIMARY KEY (person_a, person_b),
    CHECK (person_a < person_b)
);
CREATE INDEX affinity_b_idx ON affinity (person_b, sicaklik DESC);
CREATE INDEX affinity_a_idx ON affinity (person_a, sicaklik DESC);

CREATE TABLE map_point (
    person_id     uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
    x             real NOT NULL,
    y             real NOT NULL,
    kume          integer,
    kume_adi      text,
    model_surumu  text NOT NULL,
    hesaplama     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Duyurular (0.4 madde 6): en fazla 14 hafta, hoca süre seçer
-- ---------------------------------------------------------------------------
CREATE TABLE announcement (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    sahip_id         uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    ham_metin        text NOT NULL CHECK (length(ham_metin) BETWEEN 20 AND 5000),
    yayin_metni      text NOT NULL CHECK (length(yayin_metni) BETWEEN 20 AND 8000),
    kaynaklar        jsonb NOT NULL DEFAULT '[]',   -- [{"baslik": "...", "url": "https://..."}]
    sure_hafta       smallint NOT NULL CHECK (sure_hafta BETWEEN 1 AND 14),
    yayin_tarihi     timestamptz NOT NULL DEFAULT now(),
    bitis            timestamptz NOT NULL,
    eposta_goster    boolean NOT NULL DEFAULT false,
    telefon_goster   boolean NOT NULL DEFAULT false,
    durum            text NOT NULL DEFAULT 'yayinda' CHECK (durum IN ('yayinda', 'suresi_doldu', 'kaldirildi')),
    olusturma        timestamptz NOT NULL DEFAULT now(),
    guncelleme       timestamptz NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(kaynaklar) = 'array'),
    CHECK (bitis > yayin_tarihi AND bitis <= yayin_tarihi + make_interval(weeks => sure_hafta) + interval '1 day')
);
CREATE INDEX announcement_yayinda_idx ON announcement (bitis DESC) WHERE durum = 'yayinda';
CREATE INDEX announcement_sahip_idx ON announcement (sahip_id);

CREATE TABLE announcement_area (
    announcement_id  uuid NOT NULL REFERENCES announcement(id) ON DELETE CASCADE,
    area_id          uuid NOT NULL REFERENCES research_area(id) ON DELETE CASCADE,
    PRIMARY KEY (announcement_id, area_id)
);
CREATE INDEX announcement_area_area_idx ON announcement_area (area_id);

-- ---------------------------------------------------------------------------
-- Oturum (yalnız ORCID ile giriş, ADR 0004)
-- ---------------------------------------------------------------------------
CREATE TABLE user_session (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    person_id        uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    belirtec_ozeti   bytea NOT NULL UNIQUE,     -- sha256(oturum belirteci); belirtecin kendisi saklanmaz
    istemci          text NOT NULL CHECK (istemci IN ('web', 'ios')),
    olusturma        timestamptz NOT NULL DEFAULT now(),
    son_kullanim     timestamptz NOT NULL DEFAULT now(),
    bitis            timestamptz NOT NULL,
    iptal            timestamptz
);
CREATE INDEX user_session_person_idx ON user_session (person_id);

-- ORCID numarası eksik profiller için haftalık AVESİS kontrolü (0.4 madde 3)
CREATE TABLE orcid_check (
    person_id     uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
    son_kontrol   timestamptz NOT NULL DEFAULT now(),
    sonuc         text NOT NULL CHECK (sonuc IN ('bulundu', 'yok', 'hata', 'cakisma')),
    deneme_sayisi integer NOT NULL DEFAULT 1
);
CREATE INDEX orcid_check_son_idx ON orcid_check (son_kontrol);

-- ---------------------------------------------------------------------------
-- Yapay zekâ maliyet takibi (0.4: en az kullanım, maliyet tavanı zorunlu)
-- ---------------------------------------------------------------------------
CREATE TABLE ai_call_log (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    amac           text NOT NULL CHECK (amac IN ('alan_eslestirme', 'duyuru_guclendirme', 'diger')),
    saglayici      text NOT NULL,
    model          text NOT NULL,
    girdi_token    integer NOT NULL CHECK (girdi_token >= 0),
    cikti_token    integer NOT NULL CHECK (cikti_token >= 0),
    maliyet_usd    numeric(10, 6) NOT NULL CHECK (maliyet_usd >= 0),
    person_id      uuid REFERENCES person(id) ON DELETE SET NULL,
    onbellek_anahtari text,                  -- aynı istek tekrar gelirse çağrı yapılmaz
    basarili       boolean NOT NULL,
    olusturma      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_call_log_zaman_idx ON ai_call_log (olusturma);
CREATE INDEX ai_call_log_onbellek_idx ON ai_call_log (onbellek_anahtari);

CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aktor_id    uuid REFERENCES person(id) ON DELETE SET NULL,   -- null: sistem ya da veri hattı
    eylem       text NOT NULL,              -- ör. alan_ekle, alan_cikar, unvan_guncelle, duyuru_yayinla
    hedef_tur   text NOT NULL,
    hedef_id    text,
    ayrinti     jsonb NOT NULL DEFAULT '{}',
    olusturma   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_aktor_idx ON audit_log (aktor_id, olusturma);
CREATE INDEX audit_log_hedef_idx ON audit_log (hedef_tur, hedef_id);

-- migrate:down

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS ai_call_log;
DROP TABLE IF EXISTS orcid_check;
DROP TABLE IF EXISTS user_session;
DROP TABLE IF EXISTS announcement_area;
DROP TABLE IF EXISTS announcement;
DROP TABLE IF EXISTS map_point;
DROP TABLE IF EXISTS affinity;
DROP TABLE IF EXISTS publication_author;
DROP TABLE IF EXISTS publication;
DROP TABLE IF EXISTS person_research_area;
DROP TABLE IF EXISTS research_area_synonym;
DROP TABLE IF EXISTS research_area;
DROP TABLE IF EXISTS person;
DROP TABLE IF EXISTS unit;
DROP TABLE IF EXISTS institution;
DROP TYPE IF EXISTS alan_semasi;
DROP TYPE IF EXISTS alan_kaynagi;
DROP FUNCTION IF EXISTS yarenler_katla(text);
DROP COLLATION IF EXISTS tr_icu;
-- Uzantılar başka şemalarca da kullanılabileceği için kaldırılmaz.
