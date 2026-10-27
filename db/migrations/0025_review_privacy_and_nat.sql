-- migrate:up
ALTER TABLE icerik_ihlali ALTER COLUMN metin DROP NOT NULL;
CREATE OR REPLACE FUNCTION yarenler_ret_veri_azalt() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.karar='ret' THEN
  NEW.metin:=NULL;NEW.ip:=NULL;NEW.user_agent:=NULL;NEW.orcid:=NULL;NEW.ad:=NULL;NEW.kurum:=NULL;
  NEW.gerekce:='İçerik denetiminde reddedildi.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION yarenler_ret_veri_azalt() FROM PUBLIC;
DROP TRIGGER IF EXISTS minimize_ordinary_rejection ON icerik_ihlali;
CREATE TRIGGER minimize_ordinary_rejection BEFORE INSERT OR UPDATE ON icerik_ihlali FOR EACH ROW EXECUTE FUNCTION yarenler_ret_veri_azalt();
UPDATE icerik_ihlali SET metin=NULL,ip=NULL,user_agent=NULL,orcid=NULL,ad=NULL,kurum=NULL WHERE karar='ret';
ALTER TABLE icerik_ihlali DROP CONSTRAINT IF EXISTS ordinary_rejection_minimal;
ALTER TABLE icerik_ihlali ADD CONSTRAINT ordinary_rejection_minimal CHECK(karar<>'ret' OR (metin IS NULL AND ip IS NULL AND user_agent IS NULL AND orcid IS NULL AND ad IS NULL AND kurum IS NULL));
CREATE OR REPLACE FUNCTION yarenler_ihlal_temizle(p_gun integer) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE sinir timestamptz:=now()-make_interval(days=>greatest(coalesce(p_gun,180),30));n int;toplam int:=0;
BEGIN
 DELETE FROM duyuru_yasagi WHERE bitis<sinir;GET DIAGNOSTICS n=ROW_COUNT;toplam:=toplam+n;
 DELETE FROM platform_yasagi WHERE bitis IS NOT NULL AND bitis<sinir;GET DIAGNOSTICS n=ROW_COUNT;toplam:=toplam+n;
 DELETE FROM icerik_ihlali v WHERE (v.olusturma<sinir OR (v.karar='ret' AND v.olusturma<now()-interval '30 days')) AND NOT EXISTS(SELECT 1 FROM itiraz i WHERE i.ihlal_id=v.id AND i.durum='acik');GET DIAGNOSTICS n=ROW_COUNT;toplam:=toplam+n;
 DELETE FROM duyuru_denemesi WHERE olusturma<sinir;GET DIAGNOSTICS n=ROW_COUNT;toplam:=toplam+n;
 DELETE FROM duyuru_gunluk_yayin WHERE olusturma<sinir;GET DIAGNOSTICS n=ROW_COUNT;toplam:=toplam+n;
 RETURN toplam;
END $$;
-- NAT networks can submit five applications/day; the per-ORCID one/day constraint remains.
ALTER TABLE kurum_basvurusu DROP CONSTRAINT IF EXISTS kurum_basvurusu_ip_ozeti_gun_key;
CREATE INDEX IF NOT EXISTS kurum_network_day_idx ON kurum_basvurusu(ip_ozeti,gun);
CREATE OR REPLACE FUNCTION yarenler_kurum_yukleme_ac(p_oturum uuid,p_ip text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kimlik text;
BEGIN
 SELECT orcid INTO kimlik FROM orcid_session WHERE id=p_oturum AND bitis>now();
 IF kimlik IS NULL OR yarenler_orcid_yasakli(kimlik) OR p_ip !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='kurum_oturum';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('kurum_dosya:'||yarenler_bugun()::text));
 IF EXISTS(SELECT 1 FROM kurum_basvurusu WHERE gun=yarenler_bugun() AND orcid=kimlik)
 OR (SELECT count(*) FROM kurum_basvurusu WHERE gun=yarenler_bugun() AND ip_ozeti=p_ip)>=5
 OR (SELECT count(*) FROM kurum_yukleme_siniri WHERE gun=yarenler_bugun())>=60
 OR (SELECT count(*) FROM kurum_yukleme_siniri WHERE gun=yarenler_bugun() AND orcid=kimlik)>=3
 OR (SELECT count(*) FROM kurum_yukleme_siniri WHERE gun=yarenler_bugun() AND ip_ozeti=p_ip)>=20
 OR EXISTS(SELECT 1 FROM kurum_yukleme_siniri WHERE olusturma>now()-interval '1 minute' AND orcid=kimlik)
 OR (SELECT count(*) FROM kurum_yukleme_siniri WHERE olusturma>now()-interval '1 minute' AND ip_ozeti=p_ip)>=5 THEN RAISE EXCEPTION USING ERRCODE='YA033',MESSAGE='kurum_sinir';END IF;
 INSERT INTO kurum_yukleme_siniri(ip_ozeti,orcid) VALUES(p_ip,kimlik);
END $$;
CREATE OR REPLACE FUNCTION yarenler_kurum_basvur(p_oturum uuid,p_kurum text,p_eposta text,p_url text,p_ip text,p_pdf bytea,p_sha text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kimlik text;sonuc uuid;
BEGIN
 SELECT orcid INTO kimlik FROM orcid_session WHERE id=p_oturum AND bitis>now();
 IF kimlik IS NULL OR yarenler_orcid_yasakli(kimlik) OR p_ip !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='kurum_oturum';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('kurum_gunluk:'||yarenler_bugun()::text));
 IF (SELECT count(*) FROM kurum_basvurusu WHERE gun=yarenler_bugun())>=20 OR (SELECT count(*) FROM kurum_basvurusu WHERE gun=yarenler_bugun() AND ip_ozeti=p_ip)>=5 THEN RAISE EXCEPTION USING ERRCODE='YA033',MESSAGE='kurum_kapasite';END IF;
 INSERT INTO kurum_basvurusu(orcid,kurum,eposta,avesis_url,ip_ozeti,pdf,pdf_sha) VALUES(kimlik,p_kurum,p_eposta,p_url,p_ip,p_pdf,p_sha) RETURNING id INTO sonuc;
 RETURN sonuc;
END $$;
CREATE OR REPLACE FUNCTION yarenler_duyuru_denetim_sonucu(
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
       SET gun = CASE WHEN p_durum='hata' THEN gun ELSE yarenler_bugun() END, durum = p_durum, kategori = CASE WHEN p_durum IN ('ret', 'agir_ihlal') THEN p_kategori END,
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

-- migrate:down
-- Removing personal data is irreversible. Preserve the narrower policy during an application rollback.
-- A future policy change must use a reviewed forward migration.
SELECT 1;
