BEGIN;
DO $$
DECLARE inst uuid:=uuidv7(); owner_id uuid:=uuidv7(); area uuid:=uuidv7();
BEGIN
 INSERT INTO institution(id,kisa_ad,ad,ulke) VALUES(inst,'ci-interest-test','Test','TR');
 INSERT INTO person(id,kisa_kimlik,institution_id,ad,soyad,gorunen_ad) VALUES(owner_id,'testintent1',inst,'Test','Researcher','Test Researcher');
 INSERT INTO research_area(id,ad_en,normalize_ad,sema) VALUES(area,'Test field','test field','yarenler');
 INSERT INTO person_collaboration_area(person_id,area_id) VALUES(owner_id,area);
 IF (SELECT count(*) FROM person_research_area WHERE person_id=owner_id)<>0 THEN RAISE EXCEPTION 'Interest must not become expertise'; END IF;
 IF (SELECT count(*) FROM person_matching_area WHERE person_id=owner_id AND interest)<>1 THEN RAISE EXCEPTION 'Interest must participate in matching'; END IF;
 INSERT INTO person_research_area(person_id,area_id,kaynak) VALUES(owner_id,area,'kullanici');
 IF (SELECT count(DISTINCT area_id) FROM person_matching_area WHERE person_id=owner_id)<>1 THEN RAISE EXCEPTION 'Same field must not boost twice'; END IF;
 DELETE FROM person_collaboration_area WHERE person_id=owner_id;
 IF EXISTS(SELECT 1 FROM person_matching_area WHERE person_id=owner_id AND interest) THEN RAISE EXCEPTION 'Removed interest must leave matching'; END IF;
 IF NOT EXISTS(SELECT 1 FROM person_research_area WHERE person_id=owner_id) THEN RAISE EXCEPTION 'Removing interest must preserve expertise'; END IF;
END $$;
ROLLBACK;
