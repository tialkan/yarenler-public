// Reuse stable TR Dizin-backed publication identities during later AVESIS refreshes.
// The source importer holds yarenler_import for this entire transaction.
export const TRDIZIN_CONFLICT_SQL=`WITH matches AS (
 SELECT DISTINCT k.anahtar,p.id,p.anahtar canonical FROM yayin_kayit k JOIN publication p
 ON (k.doi IS NOT NULL AND (lower(p.doi)=k.doi OR EXISTS(SELECT 1 FROM trdizin_publication t WHERE t.publication_id=p.id AND t.doi=k.doi)))
 OR (k.openalex_id IS NOT NULL AND p.openalex_id=k.openalex_id) OR (k.avesis_yayin_id IS NOT NULL AND p.avesis_yayin_id=k.avesis_yayin_id)
 WHERE EXISTS(SELECT 1 FROM trdizin_publication t WHERE t.publication_id=p.id)
 ) SELECT count(*)::int conflicts FROM (
 SELECT anahtar FROM matches GROUP BY anahtar HAVING count(DISTINCT id)>1
 UNION SELECT anahtar FROM matches WHERE canonical IS NULL
 UNION SELECT m.anahtar FROM matches m JOIN publication p ON p.anahtar=m.anahtar AND p.id<>m.id
 ) blocked`;
export const TRDIZIN_RECONCILE_SQL=[
 `CREATE TEMP TABLE yayin_trdizin_alias ON COMMIT DROP AS
 SELECT k.anahtar incoming,min(p.anahtar) canonical FROM yayin_kayit k JOIN publication p
 ON (k.doi IS NOT NULL AND (lower(p.doi)=k.doi OR EXISTS(SELECT 1 FROM trdizin_publication t WHERE t.publication_id=p.id AND t.doi=k.doi))) OR (k.openalex_id IS NOT NULL AND p.openalex_id=k.openalex_id) OR (k.avesis_yayin_id IS NOT NULL AND p.avesis_yayin_id=k.avesis_yayin_id)
 WHERE EXISTS(SELECT 1 FROM trdizin_publication t WHERE t.publication_id=p.id)
 GROUP BY k.anahtar HAVING count(DISTINCT p.id)=1`,
 `INSERT INTO yayin_bag(person_id,anahtar,sira)
 SELECT b.person_id,a.canonical,min(b.sira) FROM yayin_bag b JOIN yayin_trdizin_alias a ON a.incoming=b.anahtar
 WHERE a.incoming<>a.canonical GROUP BY b.person_id,a.canonical
 ON CONFLICT(person_id,anahtar) DO UPDATE SET sira=least(yayin_bag.sira,excluded.sira)`,
 `DELETE FROM yayin_bag b USING yayin_trdizin_alias a WHERE b.anahtar=a.incoming AND a.incoming<>a.canonical`,
 `INSERT INTO yayin_kayit SELECT DISTINCT ON (a.canonical) a.canonical,k.baslik,k.yil,k.tur,k.doi,k.openalex_id,k.kaynak_adi,k.avesis_yayin_id,k.avesis_url
 FROM yayin_kayit k JOIN yayin_trdizin_alias a ON a.incoming=k.anahtar WHERE a.incoming<>a.canonical ORDER BY a.canonical,k.anahtar
 ON CONFLICT(anahtar) DO NOTHING`,
 `DELETE FROM yayin_kayit k USING yayin_trdizin_alias a WHERE k.anahtar=a.incoming AND a.incoming<>a.canonical`,
];
