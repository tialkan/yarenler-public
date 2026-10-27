-- migrate:up
-- Exact orthographic repairs; no conceptual field merge and no person-name inference.
UPDATE unit SET ad_tr=regexp_replace(replace(ad_tr,'Dijital Oyun Tasarimi','Dijital Oyun Tasarımı'),' Pr\.$',' Programı'),guncelleme=now()
 WHERE ad_tr LIKE '%Dijital Oyun Tasarimi%' OR ad_tr LIKE '% Pr.';
UPDATE research_area SET ad_tr=replace(ad_tr,'Dijital Oyun Tasarimi','Dijital Oyun Tasarımı') WHERE ad_tr LIKE '%Dijital Oyun Tasarimi%';
-- migrate:down
-- Correct display labels keep their stable IDs and URLs during a rollback.
SELECT 1;
