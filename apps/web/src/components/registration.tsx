import Link from 'next/link';
import {FieldPicker} from './field-picker';
import type {RegistrationDraft} from '@/server/registration-sources';
import {ActionForm,SubmitButton,type FormAction} from './action-form';
type Action=FormAction;
const errors={kvkk:['Devam etmek için aydınlatma metnini onaylaman gerekiyor.','Please confirm the privacy notice to continue.'],kurum:['Bir kurum seç ya da kurumunu yaz.','Choose an institution or type yours.'],name:['ORCID kaydından ad okunamadı. ORCID’de adının görünür olduğunu kontrol et.','No name could be read from ORCID. Check that your name is visible on ORCID.']} as const;

/** First ORCID sign-in without a profile: name from ORCID, institution from ORCID employment, fields from OpenAlex. */
export function RegistrationForm({action,lang,draft,catalog,error}:{action:Action;lang:'tr'|'en';draft:RegistrationDraft;catalog:{id:string;ad:string}[];error:string|null}){const tr=lang==='tr';const message=error&&error in errors?errors[error as keyof typeof errors][tr?0:1]:null;const hasEmployment=draft.employments.length>0;
 return <ActionForm action={action} className="registration-form"><input type="hidden" name="lang" value={lang}/>
  <h2>{tr?'Yarenler profilini aç':'Create your Yarenler profile'}</h2>
  <p>{tr?'Bu ORCID kimliğine bağlı bir profil yok. Aşağıdaki bilgilerle araştırmacı profili açabilirsin.':'No profile is linked to this ORCID iD. You can create a researcher profile with the details below.'}</p>
  {message&&<p role="alert">{message}</p>}
  <p className="profile-input">{tr?'Ad (ORCID kaydından)':'Name (from ORCID)'}<strong>{draft.name?.display||'-'}</strong></p>
  <label className="profile-input">{tr?'Unvan (isteğe bağlı)':'Title (optional)'}<input name="title" maxLength={120} placeholder={tr?'Örn. Doç. Dr.':'e.g. Associate Professor'}/></label>
  <fieldset className="institution-picker"><legend>{tr?'Kurum':'Institution'}</legend>
   {hasEmployment?<p className="source-note">{tr?'ORCID’deki aktif görev kaydından ve ROR/OpenAlex kurum listesinden:':'From your active ORCID employment and the ROR/OpenAlex institution list:'}</p>:<p className="source-note">{tr?'ORCID kaydında aktif görev bilgisi yok. Kurumunu kendin yaz.':'Your ORCID record has no active employment. Please type your institution.'}</p>}
   {draft.choices.map((c,i)=><label key={c.key}><input type="radio" name="institution" value={c.key} defaultChecked={i===0} required={!hasEmployment?undefined:true}/>{c.name}{c.country&&<> · {c.country}</>}{c.detail&&<small> ({c.detail})</small>}<small> · {c.ror?'ROR':c.origin==='openalex'?'OpenAlex':'ORCID'}</small></label>)}
   {draft.choices.length>0&&<label><input type="radio" name="institution" value="__beyan"/>{tr?'Listede yok, kendim yazacağım':'Not listed, I will type it'}</label>}
   <label className="profile-input">{tr?'Kurum adı':'Institution name'}<input name="kurum_beyan" maxLength={200} required={draft.choices.length===0}/></label>
  </fieldset>
  <FieldPicker fields={catalog} initial={draft.suggestions.map(s=>s.id).filter(id=>catalog.some(c=>c.id===id))} lang={lang}/>
  <p className="source-note">{draft.suggestions.length?(tr?'Öneriler OpenAlex’te ORCID iD’ne bağlı yayınlarının konularından alan havuzuyla eşleştirildi. İstemediklerini çıkar, eksikleri ekle.':'Suggestions match the topics of your OpenAlex publications (found by ORCID iD) to the field catalog. Remove or add fields as you like.'):(tr?'OpenAlex’te ORCID iD’ne bağlı yayın konusu bulunamadı. Alanlarını havuzdan ekleyebilirsin.':'No OpenAlex publication topics were found for your ORCID iD. Add fields from the catalog.')}</p>
  <section className="consent"><h3>{tr?'Aydınlatma':'Privacy notice'}</h3><p>{tr?'Herkese görünecek alanlar: ad, unvan (girersen), kurum, çalışma alanları ve ORCID bağlantın. Profilin ağda, aramada ve eşleştirmede yer alır. Onay zamanı ve metin sürümü saklanır. Profilini istediğin zaman Profilim sayfasından kaldırabilirsin.':'Publicly visible: name, title (if given), institution, research fields and your ORCID link. Your profile appears in the network, search and matching. The consent time and notice version are stored. You can remove your profile at any time from My profile.'} <Link href={tr?'/tr/gizlilik':'/en/privacy'}>{tr?'Gizlilik ve kişisel veriler':'Privacy and personal data'}</Link></p>
   <label><input type="checkbox" name="kvkk" required/>{tr?'Aydınlatma metnini okudum; yukarıdaki bilgilerin herkese açık yayımlanmasını onaylıyorum.':'I have read the notice and agree that the details above are published publicly.'}</label></section>
  <SubmitButton className="button" pending={tr?'Profil oluşturuluyor…':'Creating profile…'}>{tr?'Profilimi oluştur':'Create my profile'}</SubmitButton>
 </ActionForm>;}

/** Possible existing AVESİS profile: no new record, no name-based takeover; explain the ORCID based claim. */
export function ClaimNotice({lang,duplicate,orcid}:{lang:'tr'|'en';duplicate:NonNullable<RegistrationDraft['duplicate']>;orcid:string}){const tr=lang==='tr';return <section className="claim-notice" role="status"><h2>{tr?'Sana ait olabilecek bir profil var':'A profile that may be yours already exists'}</h2>
 <p>{tr?'Yarenler’de aynı ad ve kurumla ya da AVESİS’teki ORCID ile eşleşen bir profil bulundu. Aynı kişinin iki kez kaydolmaması için yeni profil açılmadı.':'A profile with the same name and institution, or with your ORCID on AVESİS, already exists. No new profile was created so that one person is not registered twice.'}</p>
 <p><Link href={`/${lang}/a/${duplicate.kisa}`}>{duplicate.ad}</Link>{duplicate.url&&<> · <a href={duplicate.url} target="_blank" rel="noopener noreferrer">AVESİS ↗</a></>}</p>
 <p>{tr?`Bu profili sahiplenmek için ORCID iD’ni (${orcid}) AVESİS profiline ekle. Haftalık ORCID kontrolü eşleşmeyi doğrular; sonra ORCID ile girişte profil sana açılır. Sahiplenme talebin kaydedildi.`:`To claim this profile, add your ORCID iD (${orcid}) to your AVESİS profile. The weekly ORCID check verifies it; the profile then opens for you at ORCID sign-in. Your claim request has been recorded.`}</p>
 <p className="source-note">{tr?'Bu profil sana ait değilse proje sahibine gizlilik sayfasındaki kanaldan yazabilirsin.':'If this profile is not yours, contact the project owner through the channel on the privacy page.'}</p></section>;}

/** Owner removal of their own profile. */
export function RemoveProfile({action,lang,selfRegistered,error}:{action:Action;lang:'tr'|'en';selfRegistered:boolean;error:boolean}){const tr=lang==='tr';return <details className="remove-profile"><summary>{tr?'Profilimi kaldır':'Remove my profile'}</summary><ActionForm action={action}><input type="hidden" name="lang" value={lang}/>
 <p>{selfRegistered?(tr?'ORCID ile açtığın profil, alanların ve duyuruların kalıcı olarak silinir.':'Your ORCID created profile, fields and announcements are permanently deleted.'):(tr?'AVESİS kaynaklı profilin gizlenir, duyuruların yayından kalkar ve sonraki veri güncellemelerinde de gizli kalır. ORCID ile yeniden girişte tekrar görünür yapabilirsin.':'Your AVESİS based profile is hidden, your announcements are unpublished and it stays hidden in later updates. You can make it visible again by signing in with ORCID.')}</p>
 {error&&<p role="alert">{tr?'Kaldırmak için onay kutusunu işaretle.':'Tick the confirmation box to remove.'}</p>}
 <label><input type="checkbox" name="confirm" required/>{tr?'Profilimi kaldırmak istiyorum.':'I want to remove my profile.'}</label>
 <SubmitButton className="button" pending={tr?'Kaldırılıyor…':'Removing…'}>{tr?'Kaldır':'Remove'}</SubmitButton></ActionForm></details>;}
