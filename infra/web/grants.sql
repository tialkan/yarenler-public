-- Optional reapplication when runtime roles are provisioned after migration 0028.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_web') THEN
  GRANT SELECT ON publication_topic_path,person_publication_scope,person_field_publication TO yarenler_web;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN
  GRANT SELECT ON publication_topic_path,person_publication_scope,person_field_publication TO yarenler_auth;
 END IF;
END $$;

-- Migration 0029: public metadata links; source ingestion remains maintenance-only.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_web') THEN GRANT SELECT ON trdizin_publication TO yarenler_web;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_auth') THEN GRANT SELECT ON person_publication_all,trdizin_publication TO yarenler_auth;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_indexer') THEN GRANT SELECT ON person_publication_all TO yarenler_indexer;END IF;
END $$;
