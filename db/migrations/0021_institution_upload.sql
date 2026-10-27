-- migrate:up
CREATE FUNCTION yarenler_kurum_surumu() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
CREATE TABLE kurum_basvurusu(
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 orcid text NOT NULL,
 kurum text NOT NULL CHECK(char_length(kurum) BETWEEN 3 AND 300),
 eposta text NOT NULL CHECK(char_length(eposta) BETWEEN 5 AND 254),
 avesis_url text NOT NULL CHECK(avesis_url ~ '^https://avesis\.[a-z0-9.-]+/?$'),
 ip_ozeti text NOT NULL CHECK(ip_ozeti ~ '^[0-9a-f]{64}$'),
 gun date NOT NULL DEFAULT yarenler_bugun(),
 pdf bytea NOT NULL CHECK(octet_length(pdf) BETWEEN 100 AND 8388608),
 pdf_sha text NOT NULL CHECK(pdf_sha ~ '^[0-9a-f]{64}$'),
 durum text NOT NULL DEFAULT 'bekliyor' CHECK(durum IN ('bekliyor','kabul','ret')),
 olusturma timestamptz NOT NULL DEFAULT now(),
 mail_durum text NOT NULL DEFAULT 'bekliyor' CHECK(mail_durum IN ('bekliyor','gonderiliyor','gonderildi')),
 mail_deneme int NOT NULL DEFAULT 0,
 mail_son_deneme timestamptz,
 mail_id text,
 UNIQUE(orcid,gun),UNIQUE(ip_ozeti,gun)
);
CREATE TABLE kurum_yukleme_siniri(ip_ozeti text NOT NULL,orcid text NOT NULL,gun date NOT NULL DEFAULT yarenler_bugun(),olusturma timestamptz NOT NULL DEFAULT now());
CREATE INDEX kurum_yukleme_gun_idx ON kurum_yukleme_siniri(gun);
CREATE FUNCTION yarenler_kurum_yukleme_ac(p_oturum uuid,p_ip text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kimlik text;
BEGIN
 SELECT orcid INTO kimlik FROM orcid_session WHERE id=p_oturum AND bitis>now();
 IF kimlik IS NULL OR yarenler_orcid_yasakli(kimlik) OR p_ip !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='kurum_oturum';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('kurum_dosya:'||yarenler_bugun()::text));
 IF EXISTS(SELECT 1 FROM kurum_basvurusu WHERE gun=yarenler_bugun() AND (orcid=kimlik OR ip_ozeti=p_ip))
 OR (SELECT count(*) FROM kurum_yukleme_siniri WHERE gun=yarenler_bugun())>=60
 OR (SELECT count(*) FROM kurum_yukleme_siniri WHERE gun=yarenler_bugun() AND (orcid=kimlik OR ip_ozeti=p_ip))>=3
 OR EXISTS(SELECT 1 FROM kurum_yukleme_siniri WHERE olusturma>now()-interval '1 minute' AND (orcid=kimlik OR ip_ozeti=p_ip)) THEN RAISE EXCEPTION USING ERRCODE='YA033',MESSAGE='kurum_sinir';END IF;
 INSERT INTO kurum_yukleme_siniri(ip_ozeti,orcid) VALUES(p_ip,kimlik);
END $$;
REVOKE ALL ON FUNCTION yarenler_kurum_yukleme_ac(uuid,text) FROM PUBLIC;
CREATE FUNCTION yarenler_kurum_basvur(p_oturum uuid,p_kurum text,p_eposta text,p_url text,p_ip text,p_pdf bytea,p_sha text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kimlik text; sonuc uuid;
BEGIN
 SELECT orcid INTO kimlik FROM orcid_session WHERE id=p_oturum AND bitis>now();
 IF kimlik IS NULL OR yarenler_orcid_yasakli(kimlik) THEN RAISE EXCEPTION USING ERRCODE='YA030',MESSAGE='kurum_oturum';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('kurum_gunluk:'||yarenler_bugun()::text));
 IF (SELECT count(*) FROM kurum_basvurusu WHERE gun=yarenler_bugun())>=20 THEN RAISE EXCEPTION USING ERRCODE='YA033',MESSAGE='kurum_kapasite';END IF;
 INSERT INTO kurum_basvurusu(orcid,kurum,eposta,avesis_url,ip_ozeti,pdf,pdf_sha) VALUES(kimlik,p_kurum,p_eposta,p_url,p_ip,p_pdf,p_sha) RETURNING id INTO sonuc;
 RETURN sonuc;
END $$;
CREATE FUNCTION yarenler_kurum_bildirim_al(p_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r kurum_basvurusu;
BEGIN
 UPDATE kurum_basvurusu SET mail_durum='gonderiliyor',mail_deneme=mail_deneme+1,mail_son_deneme=now()
 WHERE id=p_id AND mail_durum<>'gonderildi' AND mail_deneme<12 AND (mail_son_deneme IS NULL OR mail_son_deneme<now()-interval '10 minutes') RETURNING * INTO r;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',r.id,'kurum',r.kurum,'eposta',r.eposta,'url',r.avesis_url,'pdf',encode(r.pdf,'base64'));
END $$;
CREATE FUNCTION yarenler_kurum_bildirim_sonuc(p_id uuid,p_mail text) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE kurum_basvurusu SET mail_durum=CASE WHEN p_mail IS NOT NULL THEN 'gonderildi' ELSE 'bekliyor' END,mail_id=p_mail WHERE id=p_id AND mail_durum='gonderiliyor'
$$;
CREATE FUNCTION yarenler_kurum_bildirim_bekleyen() RETURNS SETOF uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT id FROM kurum_basvurusu WHERE mail_durum<>'gonderildi' AND mail_deneme<12 AND (mail_son_deneme IS NULL OR mail_son_deneme<now()-interval '10 minutes') ORDER BY olusturma LIMIT 5
$$;
CREATE FUNCTION yarenler_kurum_temizle() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n int;
BEGIN DELETE FROM kurum_yukleme_siniri WHERE olusturma<now()-interval '2 days';DELETE FROM kurum_basvurusu WHERE durum<>'kabul' AND olusturma<now()-interval '90 days';GET DIAGNOSTICS n=ROW_COUNT;RETURN n;END $$;
CREATE FUNCTION yarenler_kurum_durum(p_id uuid,p_durum text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE onceki kurum_basvurusu;
BEGIN
 IF p_durum IS NULL OR p_durum NOT IN ('bekliyor','kabul','ret') THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='kurum_durum';END IF;
 SELECT * INTO onceki FROM kurum_basvurusu WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='YA031',MESSAGE='kurum_yok';END IF;
 UPDATE kurum_basvurusu SET durum=p_durum WHERE id=p_id;
 RETURN jsonb_build_object('once',onceki.durum,'sonra',p_durum);
END $$;
REVOKE ALL ON FUNCTION yarenler_kurum_durum(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION yarenler_kurum_basvur(uuid,text,text,text,text,bytea,text),yarenler_kurum_bildirim_al(uuid),yarenler_kurum_bildirim_sonuc(uuid,text),yarenler_kurum_bildirim_bekleyen(),yarenler_kurum_temizle() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN
 GRANT EXECUTE ON FUNCTION yarenler_kurum_yukleme_ac(uuid,text),yarenler_kurum_basvur(uuid,text,text,text,text,bytea,text) TO yarenler_auth;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_admin') THEN GRANT SELECT ON kurum_basvurusu TO yarenler_admin;GRANT EXECUTE ON FUNCTION yarenler_kurum_durum(uuid,text) TO yarenler_admin;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_maintenance') THEN
 GRANT EXECUTE ON FUNCTION yarenler_kurum_bildirim_al(uuid),yarenler_kurum_bildirim_sonuc(uuid,text),yarenler_kurum_bildirim_bekleyen(),yarenler_kurum_temizle() TO yarenler_maintenance;
 END IF;
END $$;
-- migrate:down
DROP FUNCTION IF EXISTS yarenler_kurum_surumu();
DROP FUNCTION IF EXISTS yarenler_kurum_durum(uuid,text);
DROP FUNCTION yarenler_kurum_basvur(uuid,text,text,text,text,bytea,text),yarenler_kurum_bildirim_al(uuid),yarenler_kurum_bildirim_sonuc(uuid,text),yarenler_kurum_bildirim_bekleyen(),yarenler_kurum_temizle();
DROP FUNCTION yarenler_kurum_yukleme_ac(uuid,text);
DROP TABLE kurum_yukleme_siniri;
DROP TABLE kurum_basvurusu;
