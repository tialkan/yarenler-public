import type {Metadata} from 'next';
import Link from 'next/link';
import {requireAdmin} from '@/server/admin-auth';
import {listClaims,PAGE,type ClaimFilter} from '@/server/admin-data';
import {claimAction} from '@/server/admin-actions';
import {AdminForm,ConfirmSubmit} from '@/components/admin-forms';
import {AdminShell,Filters,Pager,when,one,pageNumber} from '@/views/admin-shell';
export const metadata:Metadata={title:'Sahiplenme talepleri'};
const DURUM=[['acik','Açık'],['onaylandi','Onaylanan'],['reddedildi','Reddedilen'],['hepsi','Hepsi']] as [ClaimFilter,string][];
const NEDEN:Record<string,string>={ad_kurum:'Ad ve kurum benzerliği',avesis_orcid:'AVESİS ORCID çakışması'};
const DURUM_AD:Record<string,string>={acik:'Açık',onaylandi:'Onaylandı',reddedildi:'Reddedildi'};
export default async function AdminClaims({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireAdmin(),sp=await searchParams;
 const durum=DURUM.find(([k])=>k===one(sp.durum))?.[0]||'acik',sayfa=pageNumber(sp.sayfa);
 const rows=await listClaims(admin.config,durum,sayfa),toplam=rows[0]?.toplam||0;
 return <AdminShell current="/talepler"><h1>Sahiplenme talepleri</h1>
  <p className="adm-muted">ORCID ile kayıt olmak isteyen ve ORCID’siz bir AVESİS profiline benzeyen kişiler. Ad benzerliğiyle otomatik sahiplenme yapılmaz; onay sizin elle verdiğiniz karardır.</p>
  <p className="adm-muted"><strong>Onayla:</strong> talepteki ORCID iD (kişi ORCID ile giriş yaparak doğruladı) profile bağlanır ve profil sahiplenilmiş sayılır; kanıt “yönetici” olarak kaydedilir, içe aktarma bu bağı ezmez. Kişi bir sonraki ORCID girişinde profilini düzenleyebilir. Aynı profil ya da ORCID için açık diğer talepler reddedilir. <strong>Reddet:</strong> profil değişmez; kişi ayrı bir profil açabilir.</p>
  <Filters base="/yonetici/talepler" name="durum" current={durum} options={DURUM} params={{durum}}/>
  <p className="adm-muted">{toplam.toLocaleString('tr-TR')} talep</p>
  <div className="adm-table-wrap"><table><thead><tr><th>Tarih</th><th>ORCID</th><th>Profil</th><th>Neden</th><th>Karar</th></tr></thead><tbody>
   {rows.map(t=><tr key={t.id}><td>{when(t.olusturma)}</td><td><a href={`https://orcid.org/${t.orcid}`} target="_blank" rel="noopener noreferrer">{t.orcid}</a>{t.orcid_baska&&<div className="adm-muted">bu ORCID başka profilde: <Link href={`/yonetici/profiller/${t.orcid_baska}`}>{t.orcid_baska}</Link></div>}</td>
    <td><Link href={`/yonetici/profiller/${t.kisa_kimlik}`}>{t.gorunen_ad}</Link><div className="adm-muted">{t.birim||''}{t.birim?' · ':''}{t.kaynak==='avesis'?'AVESİS':'ORCID kaydı'} · {t.profil_orcid?`profil ORCID: ${t.profil_orcid}`:'profilde ORCID yok'}{t.sahiplenildi?' · sahiplenilmiş':''}{t.aktif?'':' · gizli'}</div></td>
    <td>{NEDEN[t.neden]||t.neden}</td>
    <td>{t.durum!=='acik'&&<p><strong>{DURUM_AD[t.durum]||t.durum}</strong>{t.islenme?` · ${when(t.islenme)}`:''}{t.yonetici_notu?<span className="adm-muted"> · {t.yonetici_notu}</span>:null}</p>}
     {t.durum==='acik'&&<AdminForm action={claimAction}><input type="hidden" name="id" value={t.id}/>
      <label>Not (isteğe bağlı)<textarea name="not" rows={2} maxLength={1000} defaultValue={t.yonetici_notu||''}/></label>
      <div className="adm-row-actions">
       <ConfirmSubmit label="Onayla" confirmLabel="Evet, ORCID'i bağla" warning={`${t.orcid} “${t.gorunen_ad}” profiline bağlanacak.`} name="karar" value="onayla"/>
       <ConfirmSubmit label="Reddet" confirmLabel="Evet, reddet" warning="Talep reddedilecek; profil değişmez." name="karar" value="reddet"/>
       <button type="submit" name="karar" value="not" className="adm-button adm-secondary">Yalnız notu kaydet</button>
      </div></AdminForm>}</td></tr>)}
   {!rows.length&&<tr><td colSpan={5}>Talep yok.</td></tr>}
  </tbody></table></div>
  <Pager base="/yonetici/talepler" sayfa={sayfa} toplam={toplam} size={PAGE} params={{durum}}/>
 </AdminShell>;
}
