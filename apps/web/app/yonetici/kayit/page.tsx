import type {Metadata} from 'next';
import {requireAdmin} from '@/server/admin-auth';
import {listAudit,PAGE} from '@/server/admin-data';
import {AdminShell,Pager,when,pageNumber} from '@/views/admin-shell';
export const metadata:Metadata={title:'İşlem kaydı'};
const short=(v:unknown)=>v===null||v===undefined?'':JSON.stringify(v,null,1).slice(0,600);
export default async function AdminAudit({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireAdmin(),sayfa=pageNumber((await searchParams).sayfa);
 const rows=await listAudit(admin.config,sayfa),toplam=rows[0]?.toplam||0;
 return <AdminShell current="/kayit"><h1>İşlem kaydı</h1>
  <p className="adm-muted">Her panel işlemi: zaman, kullanıcı, işlem, hedef, önce ve sonra özeti, IP adresinin anahtarlı özeti (ham IP saklanmaz).</p>
  <div className="adm-table-wrap"><table><thead><tr><th>Zaman</th><th>İşlem</th><th>Hedef</th><th>Önce</th><th>Sonra</th><th>IP özeti</th></tr></thead><tbody>
   {rows.map(r=><tr key={r.id}><td>{when(r.zaman)}<div className="adm-muted">{r.kullanici}</div></td><td>{r.islem}</td><td>{r.hedef_tur}{r.hedef_ad?`: ${r.hedef_ad}`:''}{r.hedef_id&&<div className="adm-muted">{r.hedef_id}</div>}</td><td><pre>{short(r.once)}</pre></td><td><pre>{short(r.sonra)}</pre></td><td><code>{r.ip_ozeti?.slice(0,12)||''}</code></td></tr>)}
   {!rows.length&&<tr><td colSpan={6}>Kayıt yok.</td></tr>}
  </tbody></table></div>
  <Pager base="/yonetici/kayit" sayfa={sayfa} toplam={toplam} size={PAGE} params={{}}/>
 </AdminShell>;
}
