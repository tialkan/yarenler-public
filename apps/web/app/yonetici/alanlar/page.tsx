import type {Metadata} from 'next';
import Link from 'next/link';
import {requireAdmin} from '@/server/admin-auth';
import {listAreas,PAGE,type AreaFilter} from '@/server/admin-data';
import {createArea} from '@/server/admin-actions';
import {AdminForm} from '@/components/admin-forms';
import {AdminShell,Filters,Pager,when,one,pageNumber} from '@/views/admin-shell';
export const metadata:Metadata={title:'Alanlar'};
const isoDay=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))?v:'';
const KAYNAK=[['kullanici','Kullanıcı alanları'],['yonetici','Yönetici alanları'],['katalog','Katalog'],['hepsi','Hepsi']] as [AreaFilter['kaynak'],string][];
export default async function AdminAreas({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireAdmin(),sp=await searchParams;
 const kaynak=(KAYNAK.find(([k])=>k===one(sp.kaynak))?.[0]||'kullanici'),q=one(sp.q).slice(0,120),denetim=(['denetlendi','denetlenmedi'].includes(one(sp.denetim))?one(sp.denetim):'') as AreaFilter['denetim'],sayfa=pageNumber(sp.sayfa);
 const kisi=(['0','1-4','5+'].includes(one(sp.kisi))?one(sp.kisi):'') as AreaFilter['kisi'],onay=(['onayli','onaysiz'].includes(one(sp.onay))?one(sp.onay):'') as AreaFilter['onay'];
 const baslangic=isoDay(one(sp.baslangic)),bitis=isoDay(one(sp.bitis));
 const rows=await listAreas(admin.config,{kaynak,q,denetim,kisi,onay,baslangic,bitis,sayfa}),toplam=rows[0]?.toplam||0,params={kaynak,q,denetim,kisi,onay,baslangic,bitis};
 return <AdminShell current="/alanlar"><h1>Alanlar</h1>
  {one(sp.silindi)&&<p role="status" className="adm-ok">Alan silindi.</p>}
  <Filters base="/yonetici/alanlar" name="kaynak" current={kaynak} options={KAYNAK} params={params}/>
  <form className="adm-inline" method="get" action="/yonetici/alanlar" role="search">
   <input type="hidden" name="kaynak" value={kaynak}/>
   <label>Ara (ad, İngilizce ad, eş anlamlı)<input type="search" name="q" defaultValue={q} maxLength={120}/></label>
   <label>AI denetimi<select name="denetim" defaultValue={denetim}><option value="">Hepsi</option><option value="denetlendi">Denetlendi</option><option value="denetlenmedi">Denetlenmedi</option></select></label>
   <label>Kişi sayısı<select name="kisi" defaultValue={kisi}><option value="">Hepsi</option><option value="0">Hiç kimse</option><option value="1-4">1-4 kişi</option><option value="5+">5 ve üstü</option></select></label>
   <label>Onay<select name="onay" defaultValue={onay}><option value="">Hepsi</option><option value="onayli">Onaylı</option><option value="onaysiz">Onaysız</option></select></label>
   <label>Eklenme (başlangıç)<input type="date" name="baslangic" defaultValue={baslangic}/></label>
   <label>Eklenme (bitiş)<input type="date" name="bitis" defaultValue={bitis}/></label>
   <button type="submit" className="adm-button adm-secondary">Süz</button>
  </form>
  <p className="adm-muted">{toplam.toLocaleString('tr-TR')} alan</p>
  <div className="adm-table-wrap"><table><thead><tr><th>Alan</th><th>Kaynak</th><th>Ekleyen</th><th>Tarih</th><th>AI denetimi</th><th>Onay</th><th className="num">Kişi</th></tr></thead><tbody>
   {rows.map(a=><tr key={a.id}><td><Link href={`/yonetici/alanlar/${a.id}`}>{a.ad_tr||a.ad_en}</Link>{a.ad_en&&a.ad_tr&&<div className="adm-muted" lang="en">{a.ad_en}</div>}</td><td>{a.kaynak==='katalog'?a.sema:a.kaynak}</td><td>{a.ekleyen_kimlik?<Link href={`/yonetici/profiller/${a.ekleyen_kimlik}`}>{a.ekleyen}</Link>:''}</td><td>{when(a.olusturma)}</td><td>{a.ai_denetim==='denetlenmedi'?<span className="adm-tag warn">denetlenmedi</span>:a.ai_denetim||''}</td><td>{a.kaynak==='katalog'?'':a.onayli?<span className="adm-tag">onaylı</span>:'onaysız'}</td><td className="num">{a.kisi}</td></tr>)}
   {!rows.length&&<tr><td colSpan={7}>Sonuç yok.</td></tr>}
  </tbody></table></div>
  <Pager base="/yonetici/alanlar" sayfa={sayfa} toplam={toplam} size={PAGE} params={params}/>
  <h2>Yeni alan ekle</h2>
  <p className="adm-muted">Yapay zekâ denetimi olmadan doğrudan eklenir (kaynak: yönetici, onaylı). Ad sadeleştirilir ve başlık düzenine getirilir (bağlaçlar küçük harf); Türkçe katlamalı birebir eşleşme ya da eş anlamlı havuzda varsa eklenmez, var olan alan gösterilir.</p>
  <AdminForm action={createArea} className="adm-panel">
   <label>Türkçe ad<input name="ad_tr" required minLength={2} maxLength={120}/></label>
   <label>İngilizce ad (isteğe bağlı)<input name="ad_en" maxLength={120} lang="en"/></label>
   <label>Eş anlamlılar (her satıra bir ad)<textarea name="es_anlamlilar" rows={3}/></label>
   <button type="submit" className="adm-button">Alanı ekle</button>
  </AdminForm>
 </AdminShell>;
}
