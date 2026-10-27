import type {Metadata} from 'next';
import Link from 'next/link';
import {requireAdmin} from '@/server/admin-auth';
import {listAnnouncements,PAGE,type AnnouncementFilter} from '@/server/admin-data';
import {announcementAction} from '@/server/admin-actions';
import {announcementPath} from '@/server/announcement-text';
import {AdminForm,ConfirmSubmit} from '@/components/admin-forms';
import {AdminShell,Filters,Pager,when,day,clip,one,pageNumber,announcementStatus} from '@/views/admin-shell';
export const metadata:Metadata={title:'Duyurular'};
const DURUM=[['yayinda','Yayında'],['suresi_doldu','Süresi dolan'],['kaldirildi','Kaldırılan'],['hepsi','Hepsi']] as [AnnouncementFilter,string][];
const WEEK=7*24*3600*1000;
export default async function AdminAnnouncements({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireAdmin(),sp=await searchParams;
 const durum=DURUM.find(([k])=>k===one(sp.durum))?.[0]||'yayinda',sayfa=pageNumber(sp.sayfa);
 const rows=await listAnnouncements(admin.config,durum,sayfa),toplam=rows[0]?.toplam||0;
 return <AdminShell current="/duyurular"><h1>Duyurular</h1>
  <Filters base="/yonetici/duyurular" name="durum" current={durum} options={DURUM} params={{durum}}/>
  <p className="adm-muted">{toplam.toLocaleString('tr-TR')} duyuru. Süre yayın tarihinden itibaren en çok 14 haftadır.</p>
  <div className="adm-table-wrap"><table><thead><tr><th>Duyuru</th><th>Sahip</th><th>Yayın</th><th>Bitiş</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>
   {rows.map(a=>{const live=a.durum!=='kaldirildi',start=new Date(a.yayin_tarihi).getTime();
    // Total duration from the publication date: longer than now, at most 14 weeks, ending after today.
    const weeks=Array.from({length:14},(_,i)=>i+1).filter(w=>w>a.sure_hafta&&w>a.gecen_hafta);
    return <tr key={a.id}><td>{live&&a.suresi_var?<a href={announcementPath('tr',a.kisa_kimlik,a.yayin_metni)} target="_blank" rel="noopener noreferrer">{clip(a.yayin_metni,110)}</a>:clip(a.yayin_metni,110)}
     <details className="adm-details"><summary>Metni göster</summary><p className="adm-fulltext">{a.yayin_metni}</p>
      {Array.isArray(a.kaynaklar)&&a.kaynaklar.length>0&&<><p className="adm-muted">Kaynaklar</p><ul>{a.kaynaklar.map(k=><li key={k.url}><a href={k.url} target="_blank" rel="noopener noreferrer nofollow">{k.baslik||k.url}</a>{k.alan_adi?<span className="adm-muted"> · {k.alan_adi}</span>:null}</li>)}</ul></>}
     </details></td>
     <td><Link href={`/yonetici/profiller/${a.sahip_kimlik}`}>{a.sahip}</Link></td><td>{when(a.yayin_tarihi)}</td><td>{day(a.bitis)}<div className="adm-muted">{a.sure_hafta} hafta</div></td><td>{announcementStatus(a)}</td>
     <td><div className="adm-row-actions">
      {live&&<AdminForm action={announcementAction}><input type="hidden" name="id" value={a.id}/><input type="hidden" name="islem" value="kaldir"/><ConfirmSubmit label="Kaldır" confirmLabel="Evet, kaldır" warning="Duyuru sitede görünmez olur (410)."/></AdminForm>}
      {!live&&a.yonetici_kaldirdi&&a.suresi_var&&<AdminForm action={announcementAction}><input type="hidden" name="id" value={a.id}/><input type="hidden" name="islem" value="geri_al"/><button type="submit" className="adm-button adm-secondary">Geri al</button></AdminForm>}
      {live&&weeks.length>0&&<AdminForm action={announcementAction} className="adm-inline"><input type="hidden" name="id" value={a.id}/><input type="hidden" name="islem" value="uzat"/>
       <label>Toplam süre<select name="hafta" defaultValue={String(weeks[0])}>{weeks.map(w=><option key={w} value={w}>{w} hafta · {day(new Date(start+w*WEEK))}</option>)}</select></label><button type="submit" className="adm-button adm-secondary">Uzat</button></AdminForm>}
     </div></td></tr>;})}
   {!rows.length&&<tr><td colSpan={6}>Duyuru yok.</td></tr>}
  </tbody></table></div>
  <Pager base="/yonetici/duyurular" sayfa={sayfa} toplam={toplam} size={PAGE} params={{durum}}/>
 </AdminShell>;
}
