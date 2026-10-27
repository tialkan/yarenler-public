import type {Metadata} from 'next';
import {requireAdmin} from '@/server/admin-auth';
import {AdminShell} from '@/views/admin-shell';
import {DAILY_NEW_AREA_LIMIT,AI_CHECKS_PER_HOUR,AREA_AI_MODEL} from '@/server/area-intake';
import {ANNOUNCEMENT_MIN,ANNOUNCEMENT_MAX,ANNOUNCEMENT_MAX_WEEKS,ANNOUNCEMENT_TIME_ZONE,AI_BUDGET_MS,BAN_DAYS,DAILY_ATTEMPTS,DAILY_AI_CALL_CAP,HOURLY_AI_CALL_CAP,REJECTION_RETENTION_DAYS,DAILY_ANNOUNCEMENTS,MAX_LINKS,PUBLISH_DEADLINE_MS,VIOLATION_RETENTION_DAYS} from '@/server/announcement-limits';
import {ASSIST_MODEL,WEB_MAX_RESULTS,webSearchEnabled,webSearchLimits} from '@/server/announcement-assist';
import {LOCK_AFTER,LOCK_MS,LOCK_MAX_MS,SESSION_ABSOLUTE_MS,SESSION_IDLE_MS} from '@/server/admin-security';
export const metadata:Metadata={title:'Ayarlar'};

/** Read-only view of the limits in force. Values come from the code and the runtime variables; nothing is changed here. */
export default async function AdminSettings(){
 const admin=await requireAdmin();
 const configured=Number(process.env.LLM_MONTHLY_BUDGET_USD||5),budget=Number.isFinite(configured)?Math.max(0,Math.min(configured,5)):0;
 const web=webSearchLimits(process.env),webOn=webSearchEnabled(process.env);
 const rows:[string,string,string][]=[
  ['Yeni kullanıcı alanı','Kişi başına günde '+DAILY_NEW_AREA_LIMIT,'Kod ve veritabanı (yarenler_alan_ekle, YA003)'],
  ['Alan denetimi (yapay zekâ)',`Kişi başına saatte ${AI_CHECKS_PER_HOUR} çağrı · ${AREA_AI_MODEL}`,'Kod'],
  ['Duyuru metni',`${ANNOUNCEMENT_MIN} ile ${ANNOUNCEMENT_MAX.toLocaleString('tr-TR')} karakter`,'Kod ve veritabanı'],
  ['Duyuru süresi',`En çok ${ANNOUNCEMENT_MAX_WEEKS} hafta (yayın tarihinden)`,'Veritabanı'],
  ['Günlük duyuru',`Kişi başına ${DAILY_ANNOUNCEMENTS} yayımlanmış duyuru (${ANNOUNCEMENT_TIME_ZONE} takvim günü); silmek hakkı geri açmaz`,'Veritabanı (duyuru_gunluk_yayin, YA023)'],
  ['Günlük duyuru denemesi',`Kişi başına ${DAILY_ATTEMPTS} (yayın ve ret hakkı tüketir; yapay zekâ hatası tüketmez) · ${ASSIST_MODEL}`,'Veritabanı (duyuru_denemesi_gunluk, YA023)'],
  ['Süre sınırı',`Yapay zekâ ${AI_BUDGET_MS/1000} sn (web araması dahil), tüm yayın ${PUBLISH_DEADLINE_MS/1000} sn; aşılırsa yayımlanmaz`,'Kod'],
  ['Günlük model çağrısı tavanı',`Kişi başına saatte ${HOURLY_AI_CALL_CAP}, 24 saatte ${DAILY_AI_CALL_CAP} (hatalar dahil)`,'Kod'],
  ['Duyuru ön denetimi',`En çok ${MAX_LINKS} bağlantı; açık küfür listesi (yapay zekâ çağrılmaz)`,'Kod'],
  ['İhlal kaydı',`Sıradan ret: kategori/zaman ve profil bağlantısı ${REJECTION_RETENTION_DAYS} gün, metin/IP yok. Ağır ihlal: ayrıntılı kayıt ${VIOLATION_RETENTION_DAYS} gün`,'Veritabanı (icerik_ihlali)'],
  ['Ağır ihlal yasağı',`${BAN_DAYS} gün duyuru ve yeni alan yasağı; kişiye bitiş tarihiyle bildirilir`,'Kod ve veritabanı'],
  ['İhlal kaydı saklama',`${VIOLATION_RETENTION_DAYS} gün; günlük bakım görevi (infra/maintenance/retention.py) ve uygulama 12 saatte bir yarenler_ihlal_temizle çalıştırır`,'Bakım görevi ve veritabanı'],
  ['Canlı web araması',webOn?`Açık · OpenRouter web eklentisi (Exa), en çok ${WEB_MAX_RESULTS} sonuç`:'Kapalı','WEB_SEARCH_ENABLED'],
  ['Web araması sınırları',`Kişi başına saatte ${web.hourly}, günde ${web.daily}; uygulama geneli ayda ${web.monthly}`,'WEB_SEARCH_HOURLY_LIMIT, WEB_SEARCH_DAILY_LIMIT, WEB_SEARCH_MONTHLY_LIMIT'],
  ['Aylık yapay zekâ bütçesi',`${budget.toLocaleString('tr-TR')} USD (üst sınır 5 USD)`,'LLM_MONTHLY_BUDGET_USD'],
  ['Panel oturumu',`En çok ${SESSION_ABSOLUTE_MS/3600e3} saat; ${SESSION_IDLE_MS/60e3} dakika işlem yoksa kapanır`,'Kod'],
  ['Panel giriş sınırı',`IP ya da kullanıcı adı başına ${LOCK_AFTER} hatalı denemede ${LOCK_MS/60e3} dakika kilit; tekrarında süre ikiye katlanır (en çok ${LOCK_MAX_MS/3600e3} saat)`,'Kod'],
  ['Panel şifresi',admin.config.secret.kind==='hash'?'scrypt özeti (YONETICI_SIFRE_HASH)':'Düz şifre (YONETICI_SIFRE); özet tanımlanması önerilir','Coolify'],
  ['Panel IP izin listesi',admin.config.allowedIps?'Tanımlı':'Tanımlı değil (her adres giriş sayfasını görebilir)','ADMIN_ALLOWED_IPS'],
 ];
 return <AdminShell current="/ayarlar"><h1>Ayarlar</h1>
  <p className="adm-muted">Salt okunur. Değerler koddan ve Coolify ortam değişkenlerinden okunur; değiştirmek için kod ya da Coolify ayarı gerekir.</p>
  <div className="adm-table-wrap"><table className="adm-settings"><thead><tr><th>Ayar</th><th>Değer</th><th>Kaynak</th></tr></thead><tbody>
   {rows.map(([name,value,source])=><tr key={name}><td>{name}</td><td>{value}</td><td className="adm-muted">{source}</td></tr>)}
  </tbody></table></div>
 </AdminShell>;
}
