import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {requireAdmin} from '@/server/admin-auth';
import {areaDetail} from '@/server/admin-data';
import {editArea,mergeArea,deleteArea,approveArea} from '@/server/admin-actions';
import {AdminForm,ConfirmSubmit,MergeForm} from '@/components/admin-forms';
import {AdminShell,when,one} from '@/views/admin-shell';
export const metadata:Metadata={title:'Alan'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KATLA=(s:string)=>s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ı/g,'i');
export default async function AdminArea({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireAdmin(),{id}=await params,sp=await searchParams;
 if(!UUID.test(id))notFound();
 const d=await areaDetail(admin.config,id);if(!d)notFound();
 const a=d.area;if(a.kanonik_id)redirect(`/yonetici/alanlar/${a.kanonik_id}`);
 const name=a.ad_tr||a.ad_en||'';
 // Synonyms the panel edits: not the automatic ones ('sema') and not the current names themselves.
 const own=new Set([a.ad_tr,a.ad_en].filter(Boolean).map((s:string)=>KATLA(s)));
 const editable=d.synonyms.filter(s=>s.kaynak!=='sema'&&!own.has(KATLA(s.ad))),automatic=d.synonyms.filter(s=>s.kaynak==='sema');
 const deletable=a.kaynak!=='katalog';
 return <AdminShell current="/alanlar">
  <p><Link href={`/yonetici/alanlar${a.kaynak==='katalog'?'?kaynak=katalog':a.kaynak==='yonetici'?'?kaynak=yonetici':''}`}>Alanlar</Link></p>
  <h1>{name}</h1>
  {one(sp.eklendi)&&<p role="status" className="adm-ok">Alan eklendi.</p>}
  {one(sp.birlesti)&&<p role="status" className="adm-ok">Birleştirme tamamlandı; bu alan hedef alandır.</p>}
  <section className="adm-panel"><dl className="adm-dl">
   <dt>Adres</dt><dd>{a.slug?<a href={`/tr/alan/${a.slug}`} target="_blank" rel="noopener noreferrer">/tr/alan/{a.slug}</a>:'Yok'}</dd>
   <dt>Kaynak</dt><dd>{a.kaynak}{a.kaynak==='katalog'?` (${a.sema})`:''}</dd>
   <dt>Kişi sayısı</dt><dd>{a.kisi} (uzmanlık ve işbirliği ilgisi)</dd>
   {a.ekleyen&&<><dt>Ekleyen</dt><dd><Link href={`/yonetici/profiller/${a.ekleyen_kimlik}`}>{a.ekleyen}</Link></dd></>}
   <dt>Eklenme</dt><dd>{when(a.olusturma)}</dd>
   {a.ai_denetim&&<><dt>AI denetimi</dt><dd>{a.ai_denetim}{d.review?` · hocanın yazdığı: “${d.review.girdi}” · karar: ${d.review.karar}${d.review.kisa_gerekce?` · ${d.review.kisa_gerekce}`:''}`:''}</dd></>}
   {a.kaynak!=='katalog'&&<><dt>Onay</dt><dd>{a.onayli?'Onaylandı':'Onaylanmadı'}</dd></>}
   {d.aliases.length>0&&<><dt>Eski adresler (308)</dt><dd>{d.aliases.map(x=>x.slug).join(', ')}</dd></>}
   {automatic.length>0&&<><dt>Kaynak sınıflama adları</dt><dd>{automatic.map(s=>s.ad).join('; ')}</dd></>}
  </dl></section>

  {a.kaynak!=='katalog'&&<AdminForm action={approveArea} className="adm-panel adm-inline">
   <input type="hidden" name="id" value={a.id}/><input type="hidden" name="onayli" value={a.onayli?'0':'1'}/>
   <p>{a.onayli?'Bu alan onaylı. Onaylı kullanıcı alanları ileride arama motorlarına açılabilir.':'Bu alan henüz onaylanmadı. Adı ve anlamı uygunsa onaylayın; onaylı kullanıcı alanları ileride arama motorlarına açılabilir.'}</p>
   <button type="submit" className={a.onayli?'adm-button adm-secondary':'adm-button'}>{a.onayli?'Onayı kaldır':'Onaylandı olarak işaretle'}</button>
  </AdminForm>}

  <h2>Düzenle</h2>
  <AdminForm action={editArea} className="adm-panel">
   <input type="hidden" name="id" value={a.id}/>
   <label>Türkçe ad<input name="ad_tr" defaultValue={a.ad_tr||''} maxLength={120}/></label>
   <label>İngilizce ad<input name="ad_en" defaultValue={a.ad_en||''} maxLength={120} lang="en"/></label>
   <label>Eş anlamlılar (her satıra bir ad)<textarea name="es_anlamlilar" rows={4} defaultValue={editable.map(s=>s.ad).join('\n')}/></label>
   <p className="adm-muted">Ad başlık düzenine getirilir (ilk harf büyük, bağlaçlar küçük). Ad değişirse eski ad eş anlamlı olarak kalır; adres değişirse eski adres yeni adrese 308 ile yönlenir.{a.kaynak==='katalog'?' Katalog alanında içe aktarma eşleşmesi korunur.':''}</p>
   <button type="submit" className="adm-button">Kaydet</button>
  </AdminForm>

  <h2>Birleştir</h2>
  <p className="adm-muted">Bu alanı başka bir alana katar. {a.kaynak==='katalog'?'Katalog satırı kalır ve kalıcı olarak hedefe bağlanır; içe aktarmalar bunu bozmaz.':'Profil bağları hedefe taşınır, bu alan silinir, adı hedefin eş anlamlısı olur.'}</p>
  <div className="adm-panel"><MergeForm action={mergeArea} id={a.id} name={name} people={a.kisi}/></div>

  {deletable&&<><h2>Sil</h2>
   <AdminForm action={deleteArea} className="adm-panel">
    <input type="hidden" name="id" value={a.id}/>
    {a.bagli_alan>0?<p role="alert" className="adm-error">Bu alana bağlı {a.bagli_alan} başka alan var; silinemez. Başka bir alana birleştirin.</p>
     :<><p>{a.kisi>0?<strong>Bu alan {a.kisi} kişiye bağlı. Silince bu kişilerin profilinden kaldırılır.</strong>:'Bu alan hiçbir kişiye bağlı değil.'}</p>
      <ConfirmSubmit label="Alanı sil" confirmLabel="Evet, kalıcı olarak sil" warning={a.kisi>0?`${a.kisi} kişinin bağı kaldırılacak ve alan silinecek.`:'Alan silinecek.'}/></>}
   </AdminForm></>}

  {d.members.length>0&&<><h2>Bu kavramın kaynak satırları</h2>
   <div className="adm-table-wrap"><table><thead><tr><th>Ad</th><th>Şema</th><th>Bağ</th><th className="num">Kişi</th></tr></thead><tbody>
    {d.members.map(m=><tr key={m.id}><td>{m.ad_tr||m.ad_en}</td><td>{m.sema}</td><td>{m.yonetici?'yönetici birleştirmesi':'aynı ad'}</td><td className="num">{m.kisi}</td></tr>)}
   </tbody></table></div></>}

  <h2>Kişiler {a.kisi>30?'(ilk 30)':''}</h2>
  <div className="adm-table-wrap"><table><thead><tr><th>Ad</th><th>Bağ</th></tr></thead><tbody>
   {d.people.map(p=><tr key={p.kisa_kimlik}><td><Link href={`/yonetici/profiller/${p.kisa_kimlik}`}>{p.gorunen_ad}</Link>{!p.aktif&&<> <span className="adm-tag">gizli</span></>}</td><td>{p.interest?'işbirliği ilgisi':'uzmanlık'}</td></tr>)}
   {!d.people.length&&<tr><td colSpan={2}>Bu alana bağlı kişi yok.</td></tr>}
  </tbody></table></div>
 </AdminShell>;
}
