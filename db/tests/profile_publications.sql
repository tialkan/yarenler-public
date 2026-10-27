-- Göç 0013: profil yayınları, kaynak tarihi ve içe aktarma kaydı.
BEGIN;
DO $$
DECLARE inst uuid:=uuidv7(); kisi uuid:=uuidv7(); yayin uuid:=uuidv7(); ok boolean;
BEGIN
 INSERT INTO institution(id,kisa_ad,ad,ulke) VALUES(inst,'ci-yayin-test','Test','TR');
 INSERT INTO person(id,kisa_kimlik,institution_id,ad,soyad,gorunen_ad,kaynak_tarihi) VALUES(kisi,'testyayin1',inst,'Test','Kişi','Test Kişi','2026-10-22T16:45:19Z');
 INSERT INTO publication(id,anahtar,baslik,yil,tur,doi,kaynak_adi,avesis_yayin_id,avesis_url)
  VALUES(yayin,'doi:10.1000/test','Örnek başlık',2025,'makale','10.1000/test','Örnek Dergisi','c9d15fe9-cde4-5394-a6fb-51228f6d4674','https://avesis.aybu.edu.tr/yayin/c9d15fe9-cde4-5394-a6fb-51228f6d4674/ornek');
 INSERT INTO person_publication(person_id,publication_id,sira) VALUES(kisi,yayin,0);
 -- Tekilleştirme anahtarı benzersiz.
 ok:=false; BEGIN INSERT INTO publication(anahtar,baslik) VALUES('doi:10.1000/test','Kopya'); EXCEPTION WHEN unique_violation THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'publication.anahtar benzersiz olmalı'; END IF;
 -- AVESİS adresi yalnız /yayin/<uuid> biçiminde.
 ok:=false; BEGIN INSERT INTO publication(anahtar,baslik,avesis_url) VALUES('avesis:x','X','https://example.org/yayin/1'); EXCEPTION WHEN check_violation THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'publication.avesis_url denetimi çalışmıyor'; END IF;
 -- Boş başlık yok.
 ok:=false; BEGIN INSERT INTO publication(anahtar,baslik) VALUES('baslik:bos',''); EXCEPTION WHEN check_violation THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'boş başlık kabul edilmemeli'; END IF;
 -- İçe aktarma kaydı: bitiş başlangıçtan önce olamaz.
 INSERT INTO veri_aktarimi(kaynak,baslangic,bitis) VALUES('avesis','2026-10-22T10:00:00Z','2026-10-22T10:05:00Z');
 ok:=false; BEGIN INSERT INTO veri_aktarimi(kaynak,baslangic,bitis) VALUES('avesis','2026-10-22T10:00:00Z','2026-10-22T09:00:00Z'); EXCEPTION WHEN check_violation THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'veri_aktarimi bitiş denetimi çalışmıyor'; END IF;
 -- Kişi silinince bağlantısı da gider, yayın kalır (başka yazarları olabilir).
 DELETE FROM person WHERE id=kisi;
 IF EXISTS(SELECT 1 FROM person_publication WHERE person_id=kisi) THEN RAISE EXCEPTION 'kişi silinince bağlantı kalmamalı'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication WHERE id=yayin) THEN RAISE EXCEPTION 'yayın kendi başına silinmemeli'; END IF;
END $$;
ROLLBACK;
