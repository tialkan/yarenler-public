-- migrate:up
-- The notification worker only needs an opaque reference, never the applicant's PDF or contact details.
CREATE OR REPLACE FUNCTION yarenler_kurum_bildirim_al(p_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kimlik uuid;
BEGIN
 UPDATE kurum_basvurusu SET mail_durum='gonderiliyor',mail_deneme=mail_deneme+1,mail_son_deneme=now()
 WHERE id=p_id AND mail_durum<>'gonderildi' AND mail_deneme<12 AND (mail_son_deneme IS NULL OR mail_son_deneme<now()-interval '10 minutes') RETURNING id INTO kimlik;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',kimlik);
END $$;
-- migrate:down
CREATE OR REPLACE FUNCTION yarenler_kurum_bildirim_al(p_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r kurum_basvurusu;
BEGIN
 UPDATE kurum_basvurusu SET mail_durum='gonderiliyor',mail_deneme=mail_deneme+1,mail_son_deneme=now()
 WHERE id=p_id AND mail_durum<>'gonderildi' AND mail_deneme<12 AND (mail_son_deneme IS NULL OR mail_son_deneme<now()-interval '10 minutes') RETURNING * INTO r;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',r.id,'kurum',r.kurum,'eposta',r.eposta,'url',r.avesis_url,'pdf',encode(r.pdf,'base64'));
END $$;
