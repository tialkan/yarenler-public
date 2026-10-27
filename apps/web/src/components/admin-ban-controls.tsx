import {announcementBan,platformBan} from '@/server/admin-actions';
import {AdminForm,ConfirmSubmit} from '@/components/admin-forms';

const DAYS=[1,3,7,14,30,90,365];
/** Announcement ban of a person: give or reset the duration, or lift it. A reason is required for both. */
export function AnnouncementBanControls({personId,active}:{personId:string;active:boolean}){
 return <div className="adm-row-actions">
  <AdminForm action={announcementBan} className="adm-inline"><input type="hidden" name="id" value={personId}/><input type="hidden" name="islem" value="ver"/>
   <label>{active?'Yeni süre':'Duyuru yasağı'}<select name="gun" defaultValue="7">{DAYS.map(d=><option key={d} value={d}>{d} gün</option>)}</select></label>
   <label>Gerekçe<input name="gerekce" minLength={3} maxLength={500} required/></label>
   <button type="submit" className="adm-button adm-secondary">{active?'Süreyi değiştir':'Duyuru yasağı ver'}</button></AdminForm>
  {active&&<AdminForm action={announcementBan} className="adm-inline"><input type="hidden" name="id" value={personId}/><input type="hidden" name="islem" value="kaldir"/>
   <label>Gerekçe<input name="gerekce" minLength={3} maxLength={500} required/></label>
   <button type="submit" className="adm-button adm-secondary">Duyuru yasağını kaldır</button></AdminForm>}
 </div>;
}
/** Platform ban by profile or ORCID iD: indefinite or timed, reason required; lifting also needs a reason. */
export function PlatformBanControls({personId,orcid,active}:{personId?:string|null;orcid?:string|null;active:boolean}){
 const target=<>{personId&&<input type="hidden" name="person" value={personId}/>}{orcid&&<input type="hidden" name="orcid" value={orcid}/>}</>;
 if(active)return <AdminForm action={platformBan} className="adm-stack">{target}<input type="hidden" name="islem" value="kaldir"/>
  <label>Gerekçe (zorunlu)<input name="gerekce" minLength={3} maxLength={500} required/></label>
  <ConfirmSubmit label="Platform yasağını kaldır" confirmLabel="Evet, kaldır" warning="Kişi yeniden giriş yapabilir; yasakla gizlenen profil yeniden görünür. Kaldırılan duyurular Duyurular sayfasından tek tek geri alınabilir."/>
 </AdminForm>;
 return <AdminForm action={platformBan} className="adm-stack">{target}<input type="hidden" name="islem" value="yasakla"/>
  <label>Süre<select name="gun" defaultValue=""><option value="">Süresiz</option>{DAYS.map(d=><option key={d} value={d}>{d} gün</option>)}</select></label>
  <label>Gerekçe (zorunlu)<textarea name="gerekce" minLength={3} maxLength={500} required rows={2}/></label>
  <label className="adm-check"><input type="checkbox" name="profil_gizle"/> Profili de gizle</label>
  <ConfirmSubmit label="Platform yasağı ver" confirmLabel="Evet, yasakla" warning="ORCID girişi reddedilir, oturumları silinir, aynı ORCID ve profille yeniden kayıt olamaz; profil düzenleme, duyuru ve alan ekleme kapanır, yayındaki duyuruları kaldırılır."/>
 </AdminForm>;
}
