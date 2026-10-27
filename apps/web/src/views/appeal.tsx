import Link from 'next/link';
import {currentSession,authDb} from '@/server/auth';
import {submitAppeal} from '@/server/appeals';
import {ActionForm,SubmitButton} from '@/components/action-form';
import {SiteShell} from '@/components/site-shell';
import type {Lang} from '@/server/i18n';
type Item={id:string;tur:string;mesaj:string;durum:string;yanit:string|null;olusturma:string};
type Decision={id:string;gerekce:string;olusturma:string};
export async function AppealView({lang,sent}:{lang:Lang;sent:boolean}){
 const en=lang==='en',session=await currentSession();
 const data: {itirazlar:Item[];kararlar:Decision[]}=session?.person_id?(await authDb().query('SELECT yarenler_itirazlarim($1::uuid) AS d',[session.id])).rows[0].d:{itirazlar:[],kararlar:[]};
 const date=(v:string)=>new Date(v).toLocaleDateString(en?'en-GB':'tr-TR');
 const kinds=en?{profil:'Profile',alan:'Research fields',duyuru:'Announcement decision'}:{profil:'Profil',alan:'Çalışma alanları',duyuru:'Duyuru kararı'};
 const statuses=en?{acik:'Awaiting human review',kabul:'Accepted',ret:'Rejected'}:{acik:'İnsan incelemesi bekliyor',kabul:'Kabul edildi',ret:'Reddedildi'};
 return <SiteShell lang={lang} otherPath={en?'/itiraz':'/appeal'}><section className="inner-page prose"><h1>{en?'Corrections and appeals':'Düzeltme ve itiraz'}</h1>
 <p>{en?'You can usually make corrections yourself by claiming your profile with your ORCID iD. No request or administrator approval is needed for your title, research fields, collaboration interests or publication list.':'Profilinizi ORCID iD’nizle sahiplenerek çoğu düzeltmeyi kolayca kendiniz yapabilirsiniz. Unvan, çalışma alanları, işbirliği ilgileri ve yayın listeniz için başvuru veya yönetici onayı gerekmez.'}</p>
 <ol><li><Link href={en?'/en/sign-in':'/tr/giris'}>{en?'Sign in with ORCID':'ORCID ile giriş yapın'}</Link>{en?' using the ORCID iD linked to your profile.':' ve profilinize bağlı ORCID kimliğini doğrulayın.'}</li><li><Link href={en?'/en/my-profile':'/tr/profilim'}>{en?'Open My profile':'Profilim sayfasını açın'}</Link>{en?' to update your fields and collaboration interests, then save.':'; çalışma alanlarınızı ve işbirliği ilgilerinizi düzenleyip kaydedin.'}</li><li>{en?'Under My publications, add your own work, remove an incorrect work or restore a removed item. Under My announcements, you can submit one revision of a published announcement.':'Yayınlarım bölümünden kendi yayınınızı ekleyin, size ait olmayan yayını çıkarın veya çıkardığınız kaydı geri ekleyin. Yayımlanan duyurularım bölümünden duyurunuzu bir kez revize edebilirsiniz.'}</li></ol>
 <details><summary>{en?'A correction I cannot make myself or an appeal':'Kendim düzeltemediğim bir konu veya karara itiraz'}</summary><p>{en?'Human review remains available for identity conflicts, access problems and disputed decisions. Do not include sensitive information or other people’s contact details. AI cannot conclusively verify identity or legal authority.':'Kimlik uyuşmazlığı, erişim sorunu ve itiraz edilen kararlar için insan incelemesi yolu açıktır. Özel nitelikli bilgi veya başkalarının iletişim bilgilerini eklemeyin. AI kimlik veya hukuki yetkiyi kesin olarak doğrulayamaz.'} <Link href={en?'/en/privacy':'/tr/gizlilik'}>{en?'Data controller contact and your rights':'Veri sorumlusuna başvuru ve haklarınız'}</Link></p>
 {sent&&<p role="status">{en?'Your request was recorded. You can follow the response below.':'Başvurunuz kaydedildi. Yanıtı aşağıdan takip edebilirsiniz.'}</p>}
 {session?.person_id?<><ActionForm action={submitAppeal}><input type="hidden" name="lang" value={lang}/><label className="profile-input">{en?'Subject':'Konu'}<select name="kind">{Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label className="profile-input">{en?'Related decision only for an announcement appeal':'Yalnız duyuru konusundaki itirazlar için ilgili karar'}<select name="violation"><option value="">{en?'No specific decision':'Belirli bir karar seçmedim'}</option>{data.kararlar.map(v=><option key={v.id} value={v.id}>{date(v.olusturma)} · {v.gerekce}</option>)}</select></label>
 <label className="profile-input">{en?'Explanation':'Açıklama'}<textarea name="message" minLength={20} maxLength={3000} rows={5} required/></label><SubmitButton className="button" pending={en?'Sending…':'Gönderiliyor…'}>{en?'Request human review':'İnsan incelemesi iste'}</SubmitButton></ActionForm>
 <h2>{en?'Your requests':'Başvurularım'}</h2>{data.itirazlar.map(i=><article key={i.id}><h3>{kinds[i.tur as keyof typeof kinds]} · {date(i.olusturma)}</h3><p>{i.mesaj}</p><p><strong>{statuses[i.durum as keyof typeof statuses]}</strong></p>{i.yanit&&<p>{i.yanit}</p>}</article>)}</>:<p><Link href={en?'/en/sign-in':'/tr/giris'}>{en?'Sign in with ORCID to track a request':'Başvurunuzu takip etmek için ORCID ile giriş yapın'}</Link></p>}
 </details></section></SiteShell>;
}
