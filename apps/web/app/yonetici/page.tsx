import Link from 'next/link';
import {requireAdmin} from '@/server/admin-auth';
import {summary,recentUserAreas,listAnnouncements} from '@/server/admin-data';
import {AdminShell,when,day,clip,announcementStatus} from '@/views/admin-shell';
export default async function AdminHome(){
 const admin=await requireAdmin();
 const [s,areas,announcements]=await Promise.all([summary(admin.config),recentUserAreas(admin.config,20),listAnnouncements(admin.config,'hepsi',1,20)]);
 const aktarim=s.aktarim_bitis?`${day(s.aktarim_bitis)} (${s.aktarim_kaynak==='avesis'?'AVESİS':s.aktarim_kaynak}${s.aktarim_kaynak_tarihi?`, kaynak verisi ${day(s.aktarim_kaynak_tarihi)}`:''})`:'Kayıt yok';
 const cards:[string,number,string?][]=[['Araştırmacı (görünür)',s.arastirmaci,'/yonetici/profiller'],['Birim',s.birim],['Katalog alanı',s.katalog,'/yonetici/alanlar?kaynak=katalog'],['Kullanıcı alanı',s.kullanici,'/yonetici/alanlar'],['Onaylı kullanıcı alanı',s.onayli_kullanici,'/yonetici/alanlar?onay=onayli'],['Yönetici alanı',s.yonetici,'/yonetici/alanlar?kaynak=yonetici'],['Yayındaki duyuru',s.duyuru,'/yonetici/duyurular'],['Son 7 günde kullanıcı alanı',s.kullanici_7],['Son 7 günde yönetici alanı',s.yonetici_7],
  [`Son 24 saatte AI alan denetimi${s.denetim_hata_24?` (${s.denetim_hata_24} hatalı)`:' (hata yok)'}`,s.denetim_24],[`Son 24 saatte AI çağrısı${s.ai_hata_24?` (${s.ai_hata_24} başarısız)`:' (hata yok)'}`,s.ai_24],
  ['Açık itiraz',s.acik_itiraz,'/yonetici/itirazlar'],['30 günü aşan açık itiraz',s.geciken_itiraz,'/yonetici/itirazlar'],['Açık sahiplenme talebi',s.acik_talep,'/yonetici/talepler'],['Kısıtlı kişi',s.kisitli,'/yonetici/profiller?durum=kisitli'],[`Bu ay web araması${s.web_ay_hata?` (${s.web_ay_hata} hatalı)`:''}`,s.web_ay],['Son 24 saatte ihlal',s.ihlal_24,'/yonetici/ihlaller'],['Aktif yasak (duyuru + platform)',s.aktif_duyuru_yasagi+s.platform_yasagi,'/yonetici/ihlaller']];
 return <AdminShell current=""><h1>Özet</h1>
  <ul className="adm-cards">{cards.map(([label,value,href])=><li key={label}><strong>{value.toLocaleString('tr-TR')}</strong>{href?<Link href={href}>{label}</Link>:label}</li>)}</ul>
  <p className="adm-muted">Son veri aktarımı: {aktarim}. Ayrıntılı sınırlar <Link href="/yonetici/ayarlar">Ayarlar</Link> sayfasında.</p>
  <h2>Son 20 kullanıcı alanı</h2>
  <div className="adm-table-wrap"><table><thead><tr><th>Alan</th><th>Ekleyen</th><th>Tarih</th><th>Denetim</th><th className="num">Kişi</th></tr></thead><tbody>
   {areas.map(a=><tr key={a.id}><td><Link href={`/yonetici/alanlar/${a.id}`}>{a.ad_tr||a.ad_en}</Link></td><td>{a.ekleyen||''}</td><td>{when(a.olusturma)}</td><td>{a.ai_denetim==='denetlenmedi'?<span className="adm-tag warn">denetlenmedi</span>:a.ai_denetim}</td><td className="num">{a.kisi}</td></tr>)}
   {!areas.length&&<tr><td colSpan={5}>Henüz kullanıcı alanı yok.</td></tr>}
  </tbody></table></div>
  <h2>Son 20 duyuru</h2>
  <div className="adm-table-wrap"><table><thead><tr><th>Duyuru</th><th>Sahip</th><th>Yayın</th><th>Bitiş</th><th>Durum</th></tr></thead><tbody>
   {announcements.map(a=><tr key={a.id}><td>{clip(a.yayin_metni,90)}</td><td>{a.sahip}</td><td>{when(a.yayin_tarihi)}</td><td>{when(a.bitis)}</td><td>{announcementStatus(a)}</td></tr>)}
   {!announcements.length&&<tr><td colSpan={5}>Henüz duyuru yok.</td></tr>}
  </tbody></table></div>
 </AdminShell>;
}
