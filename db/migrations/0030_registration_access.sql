-- migrate:up
-- Registration and owner editing operate with the restricted authentication role.
ALTER TABLE institution DROP CONSTRAINT institution_kaynak_check;
ALTER TABLE institution ADD CONSTRAINT institution_kaynak_check CHECK(kaynak IN ('avesis','orcid','ror','openalex','kullanici'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON orcid_session TO yarenler_auth;
  GRANT SELECT,INSERT ON profile_field_review TO yarenler_auth;
  GRANT SELECT,UPDATE(status) ON research_area_suggestion TO yarenler_auth;
  GRANT SELECT,INSERT,DELETE ON person_collaboration_area TO yarenler_auth;
  GRANT UPDATE(kaynak) ON person_research_area TO yarenler_auth;
 END IF;
END $$;
-- migrate:down
-- Preserve newly created institution records and existing access on rollback.
