import type {Metadata} from 'next';
import Link from 'next/link';
import {requireAdmin} from '@/server/admin-auth';
import {listPeople,PAGE,type PersonFilter} from '@/server/admin-data';
import {AdminShell,Filters,Pager,day,one,pageNumber,visibilityLabel} from '@/views/admin-shell';
export const metadata:Metadata={title:'Profiller'};
const DURUM=[['hepsi','Hepsi'],['orcid_kayit','ORCID ile kayıtlı dış profiller'],['gizli','Gizli'],['kisitli','Kısıtlı']] as [PersonFilter,string][];
export default async function AdminPeople({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireAdmin(),sp=await searchParams;
 const durum=DURUM.find(([k])=>k===one(sp.durum))?.[0]||'hepsi',q=one(sp.q).trim().slice(0,120),sayfa=pageNumber(sp.sayfa);
 const rows=await listPeople(admin.config,q,durum,sayfa),toplam=rows[0]?.toplam||0;
 return <AdminShell current="/profiller"><h1>Profiller</h1>
  <Filters base="/yonetici/profiller" name="durum" current={durum} options={DURUM} params={{durum,q}}/>
  <form className="adm-inline" method="get" action="/yonetici/profiller" role="search"><input type="hidden" name="durum" value={durum}/>
   <label>Ad, ORCID ya da kısa kimlik<input type="search" name="q" defaultValue={q} maxLength={120}/></label><button type="submit" className="adm-button adm-secondary">Ara</button></form>
  <p className="adm-muted">{toplam.toLocaleString('tr-TR')} profil</p>
  <div className="adm-table-wrap"><table><thead><tr><th>Ad</th><th>Birim / kurum</th><th>ORCID</th><th>Kaynak</th><th>Durum</th><th>Kısıtlama</th></tr></thead><tbody>
   {rows.map(p=><tr key={p.id}><td><Link href={`/yonetici/profiller/${p.kisa_kimlik}`}>{p.gorunen_ad}</Link>{p.unvan&&<div className="adm-muted">{p.unvan}</div>}</td><td>{p.birim||''}</td><td>{p.orcid||''}{p.sahiplenildi&&<div className="adm-muted">sahiplenildi</div>}</td><td>{p.kaynak==='orcid_kayit'?<>ORCID kaydı<div className="adm-muted">{day(p.olusturma)}</div></>:'AVESİS'}</td><td>{visibilityLabel(p)}</td><td>{[p.alan_ekleme&&'alan ekleme',p.duyuru&&'duyuru'].filter(Boolean).join(', ')}</td></tr>)}
   {!rows.length&&<tr><td colSpan={6}>Sonuç yok.</td></tr>}
  </tbody></table></div>
  <Pager base="/yonetici/profiller" sayfa={sayfa} toplam={toplam} size={PAGE} params={{durum,q}}/>
 </AdminShell>;
}
