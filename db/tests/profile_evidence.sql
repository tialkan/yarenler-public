BEGIN;
-- CI creates empty runtime roles; core public read grants are provisioned separately in production.
GRANT SELECT ON person TO yarenler_web;
DO $$
DECLARE institution_id uuid; p1 uuid; p2 uuid;p3 uuid; field uuid; alias uuid; topic uuid; work1 uuid;work2 uuid;
BEGIN
 INSERT INTO institution(kisa_ad,ad,ulke) VALUES('pure-test','Test kurumu','TR') RETURNING id INTO institution_id;
 INSERT INTO person(institution_id,kisa_kimlik,ad,soyad,gorunen_ad) VALUES(institution_id,'puretest1','Test','Bir','Test Bir') RETURNING id INTO p1;
 INSERT INTO person(institution_id,kisa_kimlik,ad,soyad,gorunen_ad) VALUES(institution_id,'puretest2','Test','İki','Test İki') RETURNING id INTO p2;
 INSERT INTO person(institution_id,kisa_kimlik,ad,soyad,gorunen_ad,aktif) VALUES(institution_id,'puretest3','Test','Üç','Test Üç',false) RETURNING id INTO p3;
 INSERT INTO research_area(ad_tr,normalize_ad,sema,duzey) VALUES('Test İstatistik','test istatistik','avesis',NULL) RETURNING id INTO field;
 INSERT INTO research_area(ad_en,normalize_ad,sema,duzey,kanonik_id) VALUES('Test Statistics','test statistics','openalex',2,field) RETURNING id INTO alias;
 INSERT INTO research_area(ad_en,normalize_ad,sema,duzey,ust_id) VALUES('Test topic','test topic','openalex',3,alias) RETURNING id INTO topic;
 INSERT INTO publication(baslik,yil,konu_alanlari) VALUES('Test yayın bir',2025,ARRAY[topic]) RETURNING id INTO work1;
 INSERT INTO publication(baslik,yil) VALUES('Test yayın iki',2024) RETURNING id INTO work2;
 INSERT INTO person_publication VALUES(p1,work1,'avesis',0,now()),(p2,work1,'avesis',0,now()),(p3,work1,'avesis',0,now()),(p1,work2,'avesis',1,now()),(p2,work2,'avesis',1,now());
 INSERT INTO person_research_area VALUES(p1,field,'oneri',now()),(p2,field,'kullanici',now()),(p3,field,'avesis',now());
 INSERT INTO research_area_suggestion(person_id,area_id,similarity,evidence,model,applied_automatically) VALUES(p1,field,0,jsonb_build_object('titles',jsonb_build_array(jsonb_build_object('title','Test yayın iki'))),'test-only',true);
 IF (SELECT count(DISTINCT publication_id) FROM person_field_publication WHERE person_id=p1 AND area_id=field)<>2 THEN RAISE EXCEPTION 'Missing canonical OA/pilot evidence';END IF;
 IF EXISTS(SELECT 1 FROM person_field_publication WHERE person_id=p3) THEN RAISE EXCEPTION 'Hidden profile evidence leaked';END IF;
 IF EXISTS(SELECT 1 FROM person_field_publication WHERE person_id=p2 AND publication_id=work2) THEN RAISE EXCEPTION 'Borrowed another researcher pilot evidence';END IF;
 INSERT INTO person_publication_choice VALUES(p1,work1,false,now());
 IF EXISTS(SELECT 1 FROM person_field_publication WHERE person_id=p1 AND publication_id=work1) THEN RAISE EXCEPTION 'Hidden work remains in field support';END IF;
 IF (SELECT count(*) FROM person_publication_effective a JOIN person_publication_effective b USING(publication_id) WHERE a.person_id=p1 AND b.person_id=p2)<>1 THEN RAISE EXCEPTION 'Shared count ignores owner choice';END IF;
 UPDATE research_area_suggestion SET status='dismissed' WHERE person_id=p1 AND area_id=field;
 IF EXISTS(SELECT 1 FROM person_field_publication WHERE person_id=p1) THEN RAISE EXCEPTION 'Dismissed suggestion remains support';END IF;
 -- A mere collaboration interest never becomes a publication-supported research field.
 DELETE FROM person_research_area WHERE person_id=p2 AND area_id=field;
 INSERT INTO person_collaboration_area(person_id,area_id) VALUES(p2,field);
 IF EXISTS(SELECT 1 FROM person_field_publication WHERE person_id=p2) THEN RAISE EXCEPTION 'Interest treated as expertise';END IF;
END $$;
SET LOCAL ROLE yarenler_web;
PREPARE profile_public_evidence(text) AS SELECT e.* FROM person_field_publication e JOIN person p ON p.id=e.person_id WHERE p.kisa_kimlik=$1::text;
EXECUTE profile_public_evidence('puretest1');
DEALLOCATE profile_public_evidence;
PREPARE profile_public_scopes(text) AS SELECT s.* FROM person_publication_scope s JOIN person p ON p.id=s.person_id WHERE p.kisa_kimlik=$1::text;
EXECUTE profile_public_scopes('puretest1');
DEALLOCATE profile_public_scopes;
RESET ROLE;
SET LOCAL ROLE yarenler_auth;
PREPARE profile_auth_evidence(text) AS SELECT e.* FROM person_field_publication e JOIN person p ON p.id=e.person_id WHERE p.kisa_kimlik=$1::text;
EXECUTE profile_auth_evidence('puretest1');
DEALLOCATE profile_auth_evidence;
DO $$ BEGIN
 BEGIN EXECUTE 'UPDATE person_field_publication SET basis=''fake'''; RAISE EXCEPTION 'Read-only view writable';EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state OR feature_not_supported THEN NULL;END;
END $$;
ROLLBACK;
