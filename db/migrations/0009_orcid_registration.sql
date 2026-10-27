-- migrate:up
-- AYBÜ dışı araştırmacıların ORCID ile bireysel kaydı.
-- Kişi kaydı önce açılır, ORCID iD aynı işlemde doğrulanmış olarak bağlanır.
-- person.orcid üzerindeki UNIQUE kısıt (0001) aynı ORCID ile ikinci kaydı engeller.

-- Kurum kaynağı ve kanıtı. ROR / OpenAlex / ORCID görev kaydından gelir; ülke bilinmiyorsa boş kalır, uydurulmaz.
ALTER TABLE institution ALTER COLUMN ulke DROP NOT NULL;
ALTER TABLE institution
  ADD COLUMN kaynak text NOT NULL DEFAULT 'avesis' CHECK (kaynak IN ('avesis', 'orcid', 'ror', 'openalex')),
  ADD COLUMN kanit jsonb;
CREATE INDEX institution_ad_katli_idx ON institution (yarenler_katla(ad));

-- Kişi kaynağı, sahip beyanlı kurum, aydınlatma onayı ve kaldırma zamanı.
ALTER TABLE person ALTER COLUMN institution_id DROP NOT NULL;
ALTER TABLE person
  ADD COLUMN kaynak text NOT NULL DEFAULT 'avesis' CHECK (kaynak IN ('avesis', 'orcid_kayit')),
  ADD COLUMN kurum_beyan text CHECK (kurum_beyan IS NULL OR length(kurum_beyan) BETWEEN 2 AND 200),
  ADD COLUMN kvkk_onay timestamptz,
  ADD COLUMN kvkk_metin_surumu text,
  ADD COLUMN kaldirma_tarihi timestamptz,
  ADD CONSTRAINT person_kurum_var CHECK (institution_id IS NOT NULL OR kurum_beyan IS NOT NULL),
  ADD CONSTRAINT person_orcid_kayit_onay CHECK (kaynak <> 'orcid_kayit' OR kvkk_onay IS NOT NULL);
CREATE INDEX person_kaynak_idx ON person (kaynak) WHERE kaynak <> 'avesis';

-- ORCID ve OpenAlex'ten okunan kayıt taslağı: aynı kişi için dış kaynaklara tekrar tekrar gidilmez.
CREATE TABLE orcid_kayit_taslagi (
 orcid text PRIMARY KEY CHECK (orcid ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
 veri jsonb NOT NULL,
 olusturma timestamptz NOT NULL DEFAULT now()
);

-- ORCID'siz AVESİS profiline benzeyen kayıt denemeleri. Ad benzerliğiyle otomatik sahiplenme yapılmaz;
-- talep proje sahibince ya da AVESİS'e eklenen ORCID'in haftalık kontrolüyle sonuçlanır.
CREATE TABLE profil_sahiplenme_talebi (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 orcid text NOT NULL CHECK (orcid ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
 person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
 neden text NOT NULL CHECK (neden IN ('ad_kurum', 'avesis_orcid')),
 durum text NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik', 'onaylandi', 'reddedildi')),
 olusturma timestamptz NOT NULL DEFAULT now(),
 UNIQUE (orcid, person_id)
);

-- Çalışma rolleri varsa en az yetki (rol yoksa, ör. CI, sessizce geçilir).
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_auth') THEN
  GRANT SELECT, INSERT, UPDATE ON institution TO yarenler_auth;
  GRANT SELECT, INSERT, UPDATE, DELETE ON person TO yarenler_auth;
  GRANT SELECT, INSERT ON person_identifier_resolution TO yarenler_auth;
  GRANT SELECT, INSERT, DELETE ON person_research_area TO yarenler_auth;
  GRANT SELECT, INSERT, UPDATE, DELETE ON orcid_kayit_taslagi TO yarenler_auth;
  GRANT SELECT, INSERT ON profil_sahiplenme_talebi TO yarenler_auth;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_web') THEN
  GRANT SELECT ON institution TO yarenler_web;
 END IF;
END $$;

-- migrate:down
DROP TABLE profil_sahiplenme_talebi;
DROP TABLE orcid_kayit_taslagi;
DELETE FROM person WHERE kaynak = 'orcid_kayit';
DROP INDEX person_kaynak_idx;
ALTER TABLE person
  DROP CONSTRAINT person_orcid_kayit_onay,
  DROP CONSTRAINT person_kurum_var,
  DROP COLUMN kaldirma_tarihi,
  DROP COLUMN kvkk_metin_surumu,
  DROP COLUMN kvkk_onay,
  DROP COLUMN kurum_beyan,
  DROP COLUMN kaynak;
ALTER TABLE person ALTER COLUMN institution_id SET NOT NULL;
DELETE FROM institution i WHERE i.kaynak <> 'avesis' AND NOT EXISTS (SELECT 1 FROM person p WHERE p.institution_id = i.id);
DROP INDEX institution_ad_katli_idx;
ALTER TABLE institution DROP COLUMN kanit, DROP COLUMN kaynak;
UPDATE institution SET ulke = 'ZZ' WHERE ulke IS NULL;
ALTER TABLE institution ALTER COLUMN ulke SET NOT NULL;
