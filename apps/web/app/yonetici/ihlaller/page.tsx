import type {Metadata} from 'next';
import Link from 'next/link';
import {requireAdmin,adminDb} from '@/server/admin-auth';
import {listViolations,activeBans,platformBans,PAGE,type ViolationFilter} from '@/server/admin-data';
import {AdminForm} from '@/components/admin-forms';
import {platformBan} from '@/server/admin-actions';
import {AnnouncementBanControls,PlatformBanControls} from '@/components/admin-ban-controls';
import {AdminShell,Filters,Pager,when,one,pageNumber} from '@/views/admin-shell';
import {CATEGORIES,CATEGORY_LABELS,banReason,type BanInfo,type Category} from '@/server/announcement-moderation';
import {cleanupViolations} from '@/server/announcement-gate';
import {VIOLATION_RETENTION_DAYS} from '@/server/announcement-limits';
export const metadata:Metadata={title:'İhlaller'};
const KARAR=[['','Hepsi'],['ret','Ret'],['agir_ihlal','Ağır ihlal']] as [ViolationFilter['karar'],string][];
const label=(k:string|null)=>k&&(CATEGORIES as readonly string[]).includes(k)?CATEGORY_LABELS[k as Category].tr:(k||'');

/**
 * Violations: every rejected announcement and every severe violation, with text, reason, IP address and
 * User-Agent summary; active announcement bans and platform bans. Every change goes to the audit log.
 */
export default async function AdminViolations({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireAdmin(),sp=await searchParams;
 await cleanupViolations((sql,params)=>adminDb(admin.config).query(sql,params));
 const f:ViolationFilter={karar:KARAR.find(([k])=>k===one(sp.karar))?.[0]||'',kategori:(CATEGORIES as readonly string[]).includes(one(sp.kategori))?one(sp.kategori):'',q:one(sp.q).trim().slice(0,100),sayfa:pageNumber(sp.sayfa)};
 const [rows,bans,platform]=await Promise.all([listViolations(admin.config,f),activeBans(admin.config),platformBans(admin.config)]);
 const toplam=rows[0]?.toplam||0,params={karar:f.karar,kategori:f.kategori,q:f.q};
 return <AdminShell current="/ihlaller"><h1>İhlaller</h1>
  <p className="adm-muted">Yapay zekâ denetiminin reddettiği her duyuru ve her ağır ihlal burada. Ağır ihlal duyuru yayımlamayı ve yeni alan eklemeyi 7 gün kapatır. Sıradan retlerin metni ve IP bilgisi tutulmaz; sınırlı metadata 30 gün saklanır. IP ve User-Agent özeti yalnız ağır ihlal kayıtlarında tutulur ve {VIOLATION_RETENTION_DAYS} gün sonra silinir. IP, istek Cloudflare’den geldiyse CF-Connecting-IP başlığından, değilse bağlanan adresten okunur.</p>

  <h2>İhlal kayıtları</h2>
  <Filters base="/yonetici/ihlaller" name="karar" current={f.karar} options={KARAR} params={params}/>
  <form method="get" className="adm-inline adm-search"><input type="hidden" name="karar" value={f.karar}/>
   <label>Kategori<select name="kategori" defaultValue={f.kategori}><option value="">Hepsi</option>{CATEGORIES.map(k=><option key={k} value={k}>{CATEGORY_LABELS[k].tr}</option>)}</select></label>
   <label>Ara<input name="q" defaultValue={f.q} maxLength={100} placeholder="ad, kurum, ORCID ya da IP"/></label>
   <button type="submit" className="adm-button adm-secondary">Süz</button></form>
  <p className="adm-muted">{toplam.toLocaleString('tr-TR')} kayıt.</p>
  <div className="adm-table-wrap"><table><thead><tr><th>Tarih</th><th>Kişi</th><th>Karar ve kategori</th><th>Gerekçe</th><th>IP ve User-Agent</th><th>Metin</th><th>Durum ve işlemler</th></tr></thead><tbody>
   {rows.map(v=><tr key={v.id}><td>{when(v.olusturma)}</td>
    <td>{v.kisa_kimlik?<Link href={`/yonetici/profiller/${v.kisa_kimlik}`}>{v.ad||'Profil'}</Link>:(v.ad||'Silinmiş profil')}{v.orcid&&<div className="adm-muted">{v.orcid}</div>}{v.kurum&&<div className="adm-muted">{v.kurum}</div>}</td>
    <td>{v.karar==='agir_ihlal'?<strong>Ağır ihlal</strong>:'Ret'}<div className="adm-muted">{label(v.kategori)}</div>{v.model&&<div className="adm-muted">{v.model}</div>}</td>
    <td>{v.gerekce}</td>
    <td>{v.ip||'Yok'}<div className="adm-muted adm-ua">{v.user_agent||''}</div></td>
    <td>{v.metin?<details className="adm-details"><summary>Metni göster</summary><p className="adm-fulltext">{v.metin}</p></details>:'Saklanmıyor'}</td>
    <td>{v.platform?<strong>Platformdan yasaklı</strong>:v.yasak_bitis?<>Duyuru yasağı: {when(v.yasak_bitis)}</>:'Yasak yok'}
     {v.person_id&&<details className="adm-details"><summary>İşlemler</summary>
      {!v.platform&&<AnnouncementBanControls personId={v.person_id} active={Boolean(v.yasak_bitis)}/>}
      <PlatformBanControls personId={v.person_id} orcid={v.orcid} active={v.platform}/>
     </details>}</td></tr>)}
   {!rows.length&&<tr><td colSpan={7}>İhlal kaydı yok.</td></tr>}
  </tbody></table></div>
  <Pager base="/yonetici/ihlaller" sayfa={f.sayfa} toplam={toplam} size={PAGE} params={params}/>

  <h2>Etkin duyuru yasakları</h2>
  <div className="adm-table-wrap"><table><thead><tr><th>Kişi</th><th>Bitiş</th><th>Neden</th><th>İşlem</th></tr></thead><tbody>
   {bans.map(b=><tr key={b.person_id}><td><Link href={`/yonetici/profiller/${b.kisa_kimlik}`}>{b.ad}</Link>{b.kurum&&<div className="adm-muted">{b.kurum}</div>}</td><td>{when(b.bitis)}</td>
    <td>{banReason({neden:b.neden as BanInfo['neden'],kategori:b.kategori as Category|null},'tr')}{b.gerekce&&<div className="adm-muted">{b.gerekce}</div>}</td>
    <td><AnnouncementBanControls personId={b.person_id} active/></td></tr>)}
   {!bans.length&&<tr><td colSpan={4}>Etkin duyuru yasağı yok.</td></tr>}
  </tbody></table></div>

  <h2>Etkin platform yasakları</h2>
  <div className="adm-table-wrap"><table><thead><tr><th>Kişi ve ORCID</th><th>Başlangıç</th><th>Bitiş</th><th>Gerekçe</th><th>İşlem</th></tr></thead><tbody>
   {platform.map(b=><tr key={b.id}><td>{b.kisa_kimlik?<Link href={`/yonetici/profiller/${b.kisa_kimlik}`}>{b.ad}</Link>:(b.ad||'Profil yok')}{b.orcid&&<div className="adm-muted">{b.orcid}</div>}</td><td>{when(b.olusturma)}</td><td>{b.bitis?when(b.bitis):'Süresiz'}</td>
    <td>{b.gerekce}{b.profil_gizlendi&&<div className="adm-muted">Profil gizlendi</div>}</td>
    <td><PlatformBanControls personId={b.person_id} orcid={b.orcid} active/></td></tr>)}
   {!platform.length&&<tr><td colSpan={5}>Etkin platform yasağı yok.</td></tr>}
  </tbody></table></div>
  <details className="adm-details"><summary>ORCID iD ile platform yasağı (profili olmayan kişi de)</summary>
   <AdminForm action={platformBan} className="adm-stack"><input type="hidden" name="islem" value="yasakla"/>
    <label>ORCID iD<input name="orcid" required pattern="\d{4}-\d{4}-\d{4}-\d{3}[\dX]" placeholder="0000-0000-0000-0000"/></label>
    <label>Süre<select name="gun" defaultValue=""><option value="">Süresiz</option>{[7,30,90,365].map(d=><option key={d} value={d}>{d} gün</option>)}</select></label>
    <label>Gerekçe (zorunlu)<textarea name="gerekce" minLength={3} maxLength={500} required rows={2}/></label>
    <label className="adm-check"><input type="checkbox" name="profil_gizle"/> Profili de gizle</label>
    <button type="submit" className="adm-button">Platform yasağı ver</button>
   </AdminForm></details>
 </AdminShell>;
}
