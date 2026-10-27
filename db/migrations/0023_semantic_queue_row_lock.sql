-- migrate:up
-- SELECT FOR UPDATE needs UPDATE on at least one column. Limit the indexer's grant to the timestamp.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_indexer') THEN
  GRANT UPDATE(olusturma) ON semantic_refresh_queue TO yarenler_indexer;
 END IF;
END $$;
-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yarenler_indexer') THEN
  REVOKE UPDATE(olusturma) ON semantic_refresh_queue FROM yarenler_indexer;
 END IF;
END $$;
