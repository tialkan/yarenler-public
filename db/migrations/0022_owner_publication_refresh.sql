-- migrate:up
-- Publication changes and their refresh marker commit together. The trigger also covers future callers.
CREATE FUNCTION yarenler_yayin_yenileme_isareti() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kisi uuid;
BEGIN
 kisi:=CASE WHEN TG_OP='DELETE' THEN OLD.person_id ELSE NEW.person_id END;
 IF EXISTS(SELECT 1 FROM person WHERE id=kisi AND aktif) THEN
  INSERT INTO semantic_refresh_queue(sahip_turu,sahip_id,neden) VALUES('person',kisi,'yayin_degisti')
  ON CONFLICT(sahip_turu,sahip_id) DO UPDATE SET neden=excluded.neden,olusturma=now();
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION yarenler_yayin_yenileme_isareti() FROM PUBLIC;
CREATE TRIGGER owner_publication_refresh AFTER INSERT OR UPDATE OR DELETE ON person_publication_choice
 FOR EACH ROW EXECUTE FUNCTION yarenler_yayin_yenileme_isareti();
-- migrate:down
DROP TRIGGER owner_publication_refresh ON person_publication_choice;
DROP FUNCTION yarenler_yayin_yenileme_isareti();
