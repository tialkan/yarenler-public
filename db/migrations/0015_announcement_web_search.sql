-- migrate:up
-- Duyuru yapay zekâsında canlı web araması (OpenRouter web eklentisi, Exa).
-- web_arama_kaydi: kişi başı saatlik/günlük sınır ve panelde aylık toplam. Taslak metni burada saklanmaz.
-- announcement.kaynaklar (0001'den beri jsonb dizi): yayımlanınca doğrulanmış web kaynakları
--   [{"url": "https://...", "baslik": "...", "alan_adi": "...", "tur": "web"}], en çok 10.

CREATE TABLE web_arama_kaydi (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    person_id          uuid REFERENCES person(id) ON DELETE SET NULL,
    amac               text NOT NULL DEFAULT 'duyuru' CHECK (amac IN ('duyuru')),
    saglayici          text NOT NULL DEFAULT 'openrouter_exa' CHECK (char_length(saglayici) <= 40),
    durum              text NOT NULL DEFAULT 'baslatildi' CHECK (durum IN ('baslatildi', 'tamam', 'hata')),
    sonuc_sayisi       integer NOT NULL DEFAULT 0 CHECK (sonuc_sayisi >= 0),
    dogrulanan_sayisi  integer NOT NULL DEFAULT 0 CHECK (dogrulanan_sayisi >= 0),
    olusturma          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX web_arama_kaydi_kisi_idx ON web_arama_kaydi (person_id, olusturma DESC);
CREATE INDEX web_arama_kaydi_zaman_idx ON web_arama_kaydi (olusturma);

ALTER TABLE announcement ADD CONSTRAINT announcement_kaynaklar_sinir CHECK (jsonb_array_length(kaynaklar) <= 10);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_auth') THEN
        GRANT SELECT, INSERT, UPDATE ON web_arama_kaydi TO yarenler_auth;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_admin') THEN
        GRANT SELECT ON web_arama_kaydi TO yarenler_admin;
    END IF;
END $$;

-- migrate:down
ALTER TABLE announcement DROP CONSTRAINT announcement_kaynaklar_sinir;
DROP TABLE web_arama_kaydi;
