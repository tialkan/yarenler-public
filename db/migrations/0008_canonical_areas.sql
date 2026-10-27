-- migrate:up
-- Kaynaklar arası tek alan kavramı (avesis, wos, scopus, openalex aynı alanı ayrı satır olarak getirir).
-- Kaynak satırları korunur; her satır kanonik_id ile tek kanonik satıra bağlanır (kanonik satırda NULL).

-- Görünen ad: sondaki parantezli kodları "(Soc)", "(Med)" kaldırır, boşlukları sadeleştirir.
CREATE FUNCTION yarenler_alan_temiz(metin text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN btrim(regexp_replace(regexp_replace(metin, '\s*[\(\[][^\)\]]{1,12}[\)\]]', '', 'g'), '\s+', ' ', 'g'));

-- Eşleme anahtarı: temiz ad, Türkçe katlama, noktalama yerine boşluk, "ve/and/&" atılır,
-- kelimeler alfabetik sıralanır ("Genel Sosyal Bilimler" = "Sosyal Bilimler Genel").
CREATE FUNCTION yarenler_alan_anahtar(metin text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN (SELECT string_agg(w, ' ' ORDER BY w)
              FROM regexp_split_to_table(regexp_replace(yarenler_katla(yarenler_alan_temiz(metin)), '[^[:alnum:]]+', ' ', 'g'), '\s+') AS w
             WHERE w <> '' AND w NOT IN ('ve', 'and', 'ile'));

ALTER TABLE research_area
    ADD COLUMN kanonik_id uuid REFERENCES research_area(id) ON DELETE SET NULL,
    ADD CONSTRAINT research_area_kanonik_kendisi_degil CHECK (kanonik_id IS DISTINCT FROM id);
CREATE INDEX research_area_kanonik_idx ON research_area (kanonik_id);

-- Tekrarlanabilir eşleme. Yeni alanlar içe aktarıldıktan sonra yeniden çağrılır:
--   SELECT yarenler_alan_kanoniklestir();
-- Kanonik seçim: en çok kişiye bağlı satır, eşitlikte avesis > scopus > wos > openalex > yarenler, sonra id.
CREATE FUNCTION yarenler_alan_kanoniklestir() RETURNS integer
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

    -- Birleşen kaynak adları kanonik alana eş anlamlı olarak yazılır (aramada bulunsun).
    INSERT INTO research_area_synonym (area_id, ad, dil, normalize_ad, kaynak)
    SELECT DISTINCT ON (a.kanonik_id, yarenler_katla(n.ad)) a.kanonik_id, n.ad, n.dil, yarenler_katla(n.ad), 'sema'
      FROM research_area a
      CROSS JOIN LATERAL (VALUES (a.ad_tr, 'tr'), (a.ad_en, 'en')) AS n(ad, dil)
     WHERE a.kanonik_id IS NOT NULL AND n.ad IS NOT NULL
    ON CONFLICT (normalize_ad, area_id) DO NOTHING;
    RETURN degisen;
END $$;

SELECT yarenler_alan_kanoniklestir();

-- Eşleştirme, arama, ağ ve alan sayfaları bu görünümü kullanır: her bağ kanonik alana taşınır, tekrarlar düşer.
CREATE OR REPLACE VIEW person_matching_area AS
 SELECT DISTINCT person_id, area_id, interest FROM (
   SELECT pa.person_id, coalesce(a.kanonik_id, a.id) AS area_id, false AS interest
     FROM person_research_area pa JOIN research_area a ON a.id = pa.area_id
   UNION ALL
   SELECT ca.person_id, coalesce(a.kanonik_id, a.id), true
     FROM person_collaboration_area ca JOIN research_area a ON a.id = ca.area_id
 ) t;

-- migrate:down
CREATE OR REPLACE VIEW person_matching_area AS
 SELECT person_id,area_id,false AS interest FROM person_research_area
 UNION ALL SELECT person_id,area_id,true AS interest FROM person_collaboration_area;
DELETE FROM research_area_synonym WHERE kaynak = 'sema' AND area_id IN (SELECT DISTINCT kanonik_id FROM research_area WHERE kanonik_id IS NOT NULL);
DROP FUNCTION yarenler_alan_kanoniklestir();
ALTER TABLE research_area DROP COLUMN kanonik_id;
DROP FUNCTION yarenler_alan_anahtar(text);
DROP FUNCTION yarenler_alan_temiz(text);
