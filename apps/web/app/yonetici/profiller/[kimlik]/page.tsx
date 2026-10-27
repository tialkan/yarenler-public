import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireAdmin} from '@/server/admin-auth';
import {personDetail} from '@/server/admin-data';
import {profileVisibility,restrictPerson,announcementAction} from '@/server/admin-actions';
import {AnnouncementBanControls,PlatformBanControls} from '@/components/admin-ban-controls';
import {CATEGORIES,CATEGORY_LABELS,banReason,type BanInfo,type Category} from '@/server/announcement-moderation';
import {personPath} from '@/server/model';
import {announcementPath} from '@/server/announcement-text';
import {AdminForm,ConfirmSubmit} from '@/components/admin-forms';
import {AdminShell,when,day,clip,visibilityLabel} from '@/views/admin-shell';
export const metadata:Metadata={title:'Profil'};
export default async function AdminPerson({params}:{params:Promise<{kimlik:string}>}){
 const admin=await requireAdmin(),{kimlik}=await params;
 if(!/^[0-9a-z]{4,12}$/.test(kimlik))notFound();
 const d=await personDetail(admin.config,kimlik);if(!d)notFound();
 const p=d.person;
 return <AdminShell current="/profiller">
  <p><Link href="/yonetici/profiller">Profiller</Link></p>
  <h1>{p.gorunen_ad}</h1>
  <section className="adm-panel"><dl className="adm-dl">
   <dt>Profil</dt><dd>{p.aktif?<a href={personPath(p.kisa_kimlik,p.gorunen_ad)} target="_blank" rel="noopener noreferrer">{personPath(p.kisa_kimlik,p.gorunen_ad)}</a>:p.kisa_kimlik}</dd>
   <dt>Durum</dt><dd>{visibilityLabel(p)}{p.kaldirma_tarihi?` · ${when(p.kaldirma_tarihi)}`:''}</dd>
   {p.unvan&&<><dt>Unvan</dt><dd>{p.unvan}</dd></>}
   {p.birim&&<><dt>Birim / kurum</dt><dd>{p.birim}</dd></>}
   <dt>Kaynak</dt><dd>{p.kaynak==='orcid_kayit'?'ORCID ile kayıt':'AVESİS'} · eklenme {day(p.olusturma)}</dd>
   {p.orcid&&<><dt>ORCID</dt><dd><a href={`https://orcid.org/${p.orcid}`} target="_blank" rel="noopener noreferrer">{p.orcid}</a>{p.sahiplenildi?` · sahiplenildi ${day(p.sahiplenme_tarihi)}`:''}</dd></>}
   {p.avesis_url&&<><dt>AVESİS</dt><dd><a href={p.avesis_url} target="_blank" rel="noopener noreferrer">{p.avesis_url}</a></dd></>}
   <dt>Alan</dt><dd>{p.alan} alan · eklediği yeni alan {p.ekledigi_alan} · duyuru {p.duyuru_sayisi}</dd>
  </dl></section>

  <h2>Görünürlük</h2>
  <AdminForm action={profileVisibility} className="adm-panel"><input type="hidden" name="id" value={p.id}/>
   {p.aktif?<><input type="hidden" name="islem" value="gizle"/><p>Gizlenen profil sitede, ağda, aramada ve site haritasında görünmez; duyuruları da kalkar. Sahibi kendi başına yeniden açamaz.</p><ConfirmSubmit label="Profili gizle" confirmLabel="Evet, gizle" warning="Profil ve duyuruları hemen görünmez olur."/></>
    :p.yonetici_gizledi?<><input type="hidden" name="islem" value="goster"/><p>Bu profili yönetici gizledi.</p><button type="submit" className="adm-button">Yeniden göster</button></>
    :<p>Profili sahibi kaldırdı. Yeniden açmak sahibinin kararıdır (Profilim sayfasından).</p>}
  </AdminForm>

  <h2>Kısıtlama</h2>
  <AdminForm action={restrictPerson} className="adm-panel"><input type="hidden" name="id" value={p.id}/>
   {p.sebep&&<p>Kısıtlı: {[p.alan_ekleme&&'yeni alan ekleme',p.duyuru&&'duyuru yayımlama'].filter(Boolean).join(', ')} · {when(p.kisit_guncelleme)} (ilk: {when(p.kisit_tarihi)})</p>}
   <label className="adm-check"><input type="checkbox" name="alan_ekleme" defaultChecked={Boolean(p.alan_ekleme)}/> Yeni alan ekleme kapalı</label>
   <label className="adm-check"><input type="checkbox" name="duyuru" defaultChecked={Boolean(p.duyuru)}/> Duyuru yayımlama kapalı</label>
   <label>Sebep (kayda geçer)<textarea name="sebep" rows={2} maxLength={500} defaultValue={p.sebep||''}/></label>
   <p className="adm-muted">İkisi de işaretsiz kaydedilirse kısıtlama kalkar. Var olan alan seçimi ve profil düzenleme açık kalır.</p>
   <button type="submit" className="adm-button">Kaydet</button>
  </AdminForm>

  <h2>Yasaklar</h2>
  <section className="adm-panel">
   <h3>Duyuru yasağı</h3>
   <p>{d.ban?<>Etkin, bitiş {when(d.ban.bitis)} · {banReason({neden:d.ban.neden as BanInfo['neden'],kategori:d.ban.kategori as Category|null},'tr')}{d.ban.gerekce?` · ${d.ban.gerekce}`:''}</>:'Yok.'}</p>
   {!d.platform&&<AnnouncementBanControls personId={p.id} active={Boolean(d.ban)}/>}
   <h3>Platform yasağı</h3>
   <p>{d.platform?<>Etkin, {d.platform.bitis?`bitiş ${when(d.platform.bitis)}`:'süresiz'} · başlangıç {when(d.platform.olusturma)} · {d.platform.gerekce}{d.platform.profil_gizlendi?' · profil gizlendi':''}</>:'Yok.'}</p>
   <PlatformBanControls personId={p.id} orcid={p.orcid} active={Boolean(d.platform)}/>
  </section>

  <h2>İhlal geçmişi</h2>
  <div className="adm-table-wrap"><table><thead><tr><th>Tarih</th><th>Karar ve kategori</th><th>Gerekçe</th><th>IP ve User-Agent</th><th>Metin</th></tr></thead><tbody>
   {d.violations.map(v=><tr key={v.id}><td>{when(v.olusturma)}</td><td>{v.karar==='agir_ihlal'?<strong>Ağır ihlal</strong>:'Ret'}<div className="adm-muted">{(CATEGORIES as readonly string[]).includes(v.kategori)?CATEGORY_LABELS[v.kategori as Category].tr:v.kategori}</div></td>
    <td>{v.gerekce}</td><td>{v.ip||'Yok'}<div className="adm-muted adm-ua">{v.user_agent||''}</div></td>
    <td><details className="adm-details"><summary>Metni göster</summary><p className="adm-fulltext">{v.metin}</p></details></td></tr>)}
   {!d.violations.length&&<tr><td colSpan={5}>İhlal kaydı yok.</td></tr>}
  </tbody></table></div>

  <h2>Duyuruları</h2>
  <div className="adm-table-wrap"><table><thead><tr><th>Duyuru</th><th>Durum</th><th>Bitiş</th><th>İşlem</th></tr></thead><tbody>
   {d.announcements.map(a=><tr key={a.kisa_kimlik}><td>{a.durum==='yayinda'&&p.aktif&&a.suresi_var?<a href={announcementPath('tr',a.kisa_kimlik,a.yayin_metni)} target="_blank" rel="noopener noreferrer">{clip(a.yayin_metni,100)}</a>:clip(a.yayin_metni,100)}</td><td>{a.durum}</td><td>{day(a.bitis)}</td><td>{a.durum==='yayinda'&&<AdminForm action={announcementAction}><input type="hidden" name="id" value={a.id}/><input type="hidden" name="islem" value="kaldir"/><ConfirmSubmit label="Duyuruyu kaldır" confirmLabel="Evet, kaldır" warning="Duyuru sitede görünmez olur (410)."/></AdminForm>}</td></tr>)}
   {!d.announcements.length&&<tr><td colSpan={4}>Duyuru yok.</td></tr>}
  </tbody></table></div>
 </AdminShell>;
}
