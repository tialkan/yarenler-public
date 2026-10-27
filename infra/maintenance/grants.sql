-- The LOGIN role and its password are provisioned separately; no credentials here.
GRANT CONNECT ON DATABASE yarenler TO yarenler_maintenance;
GRANT USAGE ON SCHEMA public TO yarenler_maintenance;
GRANT SELECT ON person,person_identifier_resolution TO yarenler_maintenance;
GRANT UPDATE(orcid,guncelleme) ON person TO yarenler_maintenance;
GRANT INSERT ON person_identifier_resolution TO yarenler_maintenance;
GRANT SELECT,INSERT,UPDATE ON orcid_check TO yarenler_maintenance;
-- Migration 0016: daily retention (retention.py) only runs the cleanup function; it cannot read the violation records.
GRANT EXECUTE ON FUNCTION yarenler_ihlal_temizle(integer) TO yarenler_maintenance;

GRANT EXECUTE ON FUNCTION yarenler_itiraz_temizle() TO yarenler_maintenance;

-- Migration 0029: restricted source ingestion; no direct writes to publications or owner choices.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_maintenance') THEN
  GRANT SELECT(id,orcid,aktif,yonetici_gizledi) ON person TO yarenler_maintenance;
  GRANT EXECUTE ON FUNCTION yarenler_trdizin_kaydet(uuid,text,text,text,text,smallint,text,jsonb,jsonb) TO yarenler_maintenance;
 END IF;
END $$;
