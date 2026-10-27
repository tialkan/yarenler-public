-- Kanonik alan eşlemesini yeniden çalıştırır (idempotent). Yeni kaynak içe aktarımından sonra:
--   psql "$DATABASE_URL" -f db/canonical-areas.sql
SELECT yarenler_alan_kanoniklestir() AS degisen_satir;
SELECT count(*) AS toplam_satir, count(*) FILTER (WHERE kanonik_id IS NULL) AS kanonik_alan FROM research_area;
