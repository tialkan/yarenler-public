-- migrate:up
-- Başlık düzeni: AVESİS birim ve alan adlarında bağlaçlar büyük harfle geliyor ("Ağız, Diş Ve Çene Cerrahisi").
-- İlk kelime hariç Türkçe "ve", "ile", "ya da", "veya", "için", "ile ilgili" ve İngilizce "and", "of", "in", "for"
-- küçük yazılır. Yalnız görünen adlar (unit.ad_tr/ad_en, research_area.ad_tr/ad_en) düzeltilir; normalize_ad,
-- slug, eş anlamlılar ve kişi adları değişmez (katlama zaten küçük harf). Tekrar çalıştırmak bir şey değiştirmez.
-- Uygulamadaki karşılığı: apps/web/src/server/text-case.ts, veri hattında metin.baslik_duzeni.
CREATE FUNCTION yarenler_baslik_duzeni(metin text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        metin,
        '(\s)(İle İlgili|Ile Ilgili)(?=[\s,;:.)]|$)', '\1ile ilgili', 'g'),
        '(\s)Ya Da(?=[\s,;:.)]|$)', '\1ya da', 'g'),
        '(\s)Veya(?=[\s,;:.)]|$)', '\1veya', 'g'),
        '(\s)Ve(?=[\s,;:.)]|$)', '\1ve', 'g'),
        '(\s)(İle|Ile)(?=[\s,;:.)]|$)', '\1ile', 'g'),
        '(\s)(İçin|Için)(?=[\s,;:.)]|$)', '\1için', 'g'),
        '(\s)And(?=[\s,;:.)]|$)', '\1and', 'g'),
        '(\s)Of(?=[\s,;:.)]|$)', '\1of', 'g'),
        '(\s)In(?=[\s,;:.)]|$)', '\1in', 'g'),
        '(\s)For(?=[\s,;:.)]|$)', '\1for', 'g');

UPDATE unit SET ad_tr = yarenler_baslik_duzeni(ad_tr), guncelleme = now()
 WHERE ad_tr IS DISTINCT FROM yarenler_baslik_duzeni(ad_tr);
UPDATE unit SET ad_en = yarenler_baslik_duzeni(ad_en), guncelleme = now()
 WHERE ad_en IS DISTINCT FROM yarenler_baslik_duzeni(ad_en);
UPDATE research_area SET ad_tr = yarenler_baslik_duzeni(ad_tr), guncelleme = now()
 WHERE ad_tr IS DISTINCT FROM yarenler_baslik_duzeni(ad_tr);
UPDATE research_area SET ad_en = yarenler_baslik_duzeni(ad_en), guncelleme = now()
 WHERE ad_en IS DISTINCT FROM yarenler_baslik_duzeni(ad_en);

-- migrate:down
-- Kaynaktaki büyük harfli bağlaçlar ayrıca saklanmadığı için adlar geri çevrilmez; yalnız işlev kaldırılır.
DROP FUNCTION yarenler_baslik_duzeni(text);
