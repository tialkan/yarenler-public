-- Yönetici paneli rolü (yarenler_admin) yetkileri. Göç 0014 rol varsa aynı yetkileri verir; rol göçten sonra
-- açıldıysa bu dosyayı tablo sahibi bağlantısıyla bir kez çalıştırın (tekrar çalıştırmak zararsızdır):
--   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/admin/grants.sql
-- LOGIN rolü ve şifresi ayrıca açılır; burada kimlik bilgisi yok (DEVIR.md, "Yönetici paneli").
-- En az yetki: çekirdek tablolara yalnız okuma; yazma yalnız SECURITY DEFINER yönetici işlevleriyle;
-- işlem kaydına yalnız ekleme (güncelleme ve silme yok); kendi oturum ve giriş denemesi tabloları.
GRANT CONNECT ON DATABASE yarenler TO yarenler_admin;
GRANT USAGE ON SCHEMA public TO yarenler_admin;
GRANT SELECT ON person, unit, institution, research_area, research_area_synonym, research_area_eski_adres,
                person_research_area, person_collaboration_area, person_matching_area, announcement,
                alan_denetimi, profil_sahiplenme_talebi, ai_call_log, kisi_kisitlamasi, veri_aktarimi TO yarenler_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON yonetici_oturum, yonetici_giris_denemesi TO yarenler_admin;
GRANT SELECT, INSERT ON yonetici_islem TO yarenler_admin;
GRANT EXECUTE ON FUNCTION yarenler_yonetici_alan_ekle(text, text, text[]),
                          yarenler_yonetici_alan_duzenle(uuid, text, text, text[]),
                          yarenler_yonetici_alan_birlestir(uuid, uuid),
                          yarenler_yonetici_alan_sil(uuid),
                          yarenler_yonetici_alan_onay(uuid, boolean),
                          yarenler_yonetici_duyuru(uuid, text, integer),
                          yarenler_yonetici_profil(uuid, boolean),
                          yarenler_yonetici_kisitla(uuid, boolean, boolean, text),
                          yarenler_yonetici_talep(uuid, text, text),
                          yarenler_kisitli(uuid, text) TO yarenler_admin;
-- Göç 0015: aylık web araması sayısı (panel özeti).
GRANT SELECT ON web_arama_kaydi TO yarenler_admin;
-- Göç 0016: ihlaller ve yasaklar (okuma); yasak işlevleri ve saklama temizliği.
GRANT SELECT ON icerik_ihlali, duyuru_yasagi, platform_yasagi, duyuru_denemesi, duyuru_gunluk_yayin TO yarenler_admin;
GRANT EXECUTE ON FUNCTION yarenler_bugun(), yarenler_platform_yasagi(uuid, text), yarenler_duyuru_durumu(uuid),
                          yarenler_yonetici_duyuru_yasagi(uuid, text, integer, text),
                          yarenler_yonetici_platform_yasagi(uuid, text, boolean, integer, text, boolean),
                          yarenler_ihlal_temizle(integer) TO yarenler_admin;
-- Göç 0016: oturum rolü (yarenler_auth) ihlal tablolarını okuyamaz; yalnız yasak denetimi, deneme ve sonuç işlevlerini
-- çalıştırır. Bakım rolü yalnız saklama temizliğini çalıştırır. Roller yoksa atlanır.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_auth') THEN
        GRANT EXECUTE ON FUNCTION yarenler_bugun(), yarenler_platform_yasagi(uuid, text), yarenler_orcid_yasakli(text),
                                  yarenler_duyuru_durumu(uuid), yarenler_duyuru_deneme_baslat(uuid),
                                  yarenler_duyuru_denetim_sonucu(uuid, uuid, text, text, text, uuid, text, text, inet, text, integer),
                                  yarenler_ihlal_temizle(integer) TO yarenler_auth;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yarenler_maintenance') THEN
        GRANT EXECUTE ON FUNCTION yarenler_ihlal_temizle(integer) TO yarenler_maintenance;
    END IF;
END $$;

-- Migration 0018: private human appeals and audited resolution.
GRANT SELECT ON itiraz TO yarenler_admin;
GRANT EXECUTE ON FUNCTION yarenler_itiraz_sonuclandir(uuid,text,text) TO yarenler_admin;
GRANT EXECUTE ON FUNCTION yarenler_itiraz_ac(uuid,uuid,text,text),yarenler_itirazlarim(uuid) TO yarenler_auth;
