'use server';
import {after} from 'next/server';
import {revalidatePath} from 'next/cache';
import {redirect,unstable_rethrow} from 'next/navigation';
import {headers} from 'next/headers';
import {UserError,logServerError} from './action-errors';
import {reportError} from './error-report';
import {appOrigin} from './auth';
import {adminAction,attemptLogin,endSession,inAdminTransaction,setSessionCookie,currentAdmin} from './admin-auth';
import {mergeCandidates} from './admin-data';
import {ADMIN_PATH,adminAreaName} from './admin-security';
import {invalidateNetwork} from './network';
import {revalidateAnnouncements,revalidateEverything,announcementIndexNowPaths} from './revalidate';
import {purgeCdn} from './cdn-purge';
import {notifyIndexNow} from './indexnow';
import {requestSemanticRefresh} from './area-intake-db';
import {personPath} from './model';

/** State of every panel form: an alert, a confirmation line, or merge candidates to choose from. */
export type AdminState={error?:string;ok?:string;mevcut?:string;adaylar?:{id:string;ad:string;kaynak:string;kisi:number}[];sorgu?:string}|null;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text=(form:FormData,name:string,max=2000)=>String(form.get(name)??'').slice(0,max);
function uuid(form:FormData,name:string){const value=text(form,name,40);if(!UUID.test(value))throw new UserError('Kayıt kimliği geçersiz.','Invalid record id.');return value;}
const lines=(value:string)=>value.split(/[\n;]/).map(s=>s.trim()).filter(Boolean);

const DB_MESSAGES:Record<string,string>={
 YA031:'Karar veya yanıt geçersiz. Yanıt 10 ile 2000 karakter arasında olmalı.',
 YA034:'Bu başvuru daha önce sonuçlandırılmış veya bulunamadı.',
 YA010:'Alan bulunamadı ya da başka bir alana bağlanmış. Sayfayı yenileyin.',
 YA011:'Bu ad başka bir alanda zaten var. İki alanı birleştirmek için "Birleştir" bölümünü kullanın.',
 YA012:'Katalog alanları silinemez. Gerekirse başka bir alana birleştirin.',
 YA013:'Bir alan kendisiyle birleştirilemez.',
 YA014:'Bu alana bağlı başka alanlar var (kaynak satırları ya da birleştirmeler). Silmek yerine başka bir alana birleştirin.',
 YA016:'Profil işlemi yapılamadı.',
 YA018:'Talep bulunamadı.',
 YA019:'Bu talep daha önce sonuçlandırılmış.',
 '23505':'Bu adla başka bir alan var.',
};
const DETAIL_MESSAGES:Record<string,string>={
 ad_gecersiz:'Ad 2 ile 120 karakter arasında olmalı ve kontrol karakteri içermemeli.',
 es_anlamli_cok:'En fazla 50 eş anlamlı girilebilir.',
 sebep_gecersiz:'Kısıtlama sebebi 3 ile 500 karakter arasında olmalı.',
 not_uzun:'Not en fazla 1000 karakter olabilir.',
 duyuru_yok:'Duyuru bulunamadı.',
 zaten_kaldirildi:'Duyuru zaten kaldırılmış.',
 geri_alinamaz:'Yalnız yöneticinin kaldırdığı duyurular geri alınabilir.',
 suresi_dolmus:'Süresi dolmuş duyuru geri alınamaz.',
 kaldirilmis:'Kaldırılmış duyurunun süresi uzatılamaz; önce geri alın.',
 sure_gecersiz:'Yeni süre mevcut süreden uzun, en fazla 14 hafta olmalı ve bugünden sonra bitmeli.',
 zaten_gizli:'Profil zaten gizli.',
 gosterilemez:'Yalnız yöneticinin gizlediği profiller yeniden gösterilebilir. Sahibinin kaldırdığı profil sahibinin kararıdır.',
 profil_yok:'Profil bulunamadı.',
 gerekce_gecersiz:'Gerekçe 3 ile 500 karakter arasında olmalı.',
 orcid_gecersiz:'ORCID iD biçimi geçersiz (0000-0000-0000-0000).',
 zaten_yasakli:'Bu ORCID iD zaten platformdan yasaklı.',
 yasak_yok:'Kaldırılacak etkin bir yasak ya da engel yok.',
 gun_gecersiz:'Süre 1 ile 365 gün arasında olmalı.',
 ag_gecersiz:'IP adresi ya da ağ geçersiz (ör. 203.0.113.7 ya da 203.0.113.0/24; en geniş /16, IPv6 için /32).',
 islem_gecersiz:'İşlem geçersiz.',
 onay_gecersiz:'Onay işareti yalnız kullanıcı ve yönetici alanlarında değiştirilir; katalog alanları zaten onaylıdır.',
 karar_gecersiz:'Karar geçersiz.',
 profil_gizli:'Profil gizli ya da kaldırılmış; önce yeniden gösterin.',
 profil_orcidli:'Bu profil başka bir ORCID iD ile bağlı; talep onaylanamaz.',
 orcid_kullaniliyor:'Bu ORCID iD başka bir profile bağlı; talep onaylanamaz.',
};
/** Safe message for the panel; unexpected errors are logged and reported, never shown. */
function message(error:unknown,action:string){
 if(error instanceof UserError)return error.tr;
 const e=error as {code?:string;message?:string};
 if(e?.code&&/^YA0\d\d$/.test(e.code)&&e.message&&DETAIL_MESSAGES[e.message])return DETAIL_MESSAGES[e.message];
 if(e?.code&&DB_MESSAGES[e.code])return DB_MESSAGES[e.code];
 logServerError('admin_action_failed',error,{action});
 after(()=>reportError(error,{kind:'action',action:'admin:'+action}));
 return 'İşlem tamamlanamadı. Lütfen biraz sonra yeniden deneyin.';
}
async function run(action:string,impl:(form:FormData)=>Promise<AdminState>,form:FormData):Promise<AdminState>{
 try{return await impl(form);}catch(error){
  unstable_rethrow(error);
  // Name already in the pool (exact match after local normalization): warn and link the existing field.
  const e=error as {code?:string;detail?:string};
  if(e?.code==='YA011'&&e.detail&&UUID.test(e.detail))return {error:'Bu ad (ya da eş anlamlısı) havuzda zaten var; yeni alan eklenmedi. Gerekirse var olan alanı düzenleyin ya da birleştirin.',mevcut:e.detail};
  return {error:message(error,action)};
 }
}

// ---------------------------------------------------------------------------
// Cache: Next.js ISR at once, CDN copies of the pages that change, IndexNow where the address changed.
// ---------------------------------------------------------------------------
const fieldPaths=(...slugs:(string|null|undefined)[])=>[...new Set(slugs.filter((s):s is string=>Boolean(s)))].flatMap(s=>[`/tr/alan/${s}`,`/en/field/${s}`]);
function refreshFields(paths:string[]){
 invalidateNetwork();revalidateEverything();revalidatePath(ADMIN_PATH,'layout');
 after(async()=>{await Promise.all([purgeCdn(['/tr','/en','/tr/kesfet','/en/explore',...paths]),notifyIndexNow(paths),requestSemanticRefresh()]);});
}
function refreshAnnouncements(items:{id:string;text:string}[]){
 revalidateAnnouncements();revalidatePath(ADMIN_PATH,'layout');
 after(async()=>{const paths=announcementIndexNowPaths(items);await Promise.all([notifyIndexNow(paths),purgeCdn([...paths,'/tr/duyurular/rss.xml','/en/announcements/rss.xml','/sitemaps/duyurular.xml'])]);});
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
async function loginImpl(form:FormData):Promise<AdminState>{
 if((await headers()).get('origin')!==appOrigin())throw new UserError('İstek kaynağı geçersiz.','Request origin is invalid.');
 const result=await attemptLogin(text(form,'kullanici',64),text(form,'sifre',1024));
 if(!result.ok)return {error:result.message};
 await setSessionCookie(result.token);
 redirect(ADMIN_PATH);
}
export async function login(_state:AdminState,form:FormData):Promise<AdminState>{return run('login',loginImpl,form);}
export async function logout():Promise<void>{
 if((await headers()).get('origin')!==appOrigin())redirect(ADMIN_PATH+'/giris');
 const admin=await currentAdmin();if(admin)await endSession(admin);
 redirect(ADMIN_PATH+'/giris');
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
type FieldResult={once?:Record<string,unknown>;sonra?:Record<string,unknown>&{id?:string;ad_tr?:string;slug?:string};eski_slug?:string|null;yeni_slug?:string|null;kisi_sayisi?:number};

async function createAreaImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction();
 const result=await inAdminTransaction(admin,async client=>{
  const r=(await client.query<{r:FieldResult}>('SELECT yarenler_yonetici_alan_ekle($1::text,$2::text,$3::text[]) AS r',[adminAreaName(text(form,'ad_tr',200),'tr'),adminAreaName(text(form,'ad_en',200),'en'),lines(text(form,'es_anlamlilar',6000))])).rows[0].r;
  return {result:r,audit:{islem:'alan_ekle',hedefTur:'alan',hedefId:r.sonra?.id,hedefAd:r.sonra?.ad_tr,sonra:r.sonra}};
 });
 refreshFields(fieldPaths(result.sonra?.slug));
 redirect(`${ADMIN_PATH}/alanlar/${result.sonra?.id}?eklendi=1`);
}
async function editAreaImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id');
 const result=await inAdminTransaction(admin,async client=>{
  const r=(await client.query<{r:FieldResult}>('SELECT yarenler_yonetici_alan_duzenle($1::uuid,$2::text,$3::text,$4::text[]) AS r',[id,adminAreaName(text(form,'ad_tr',200),'tr'),adminAreaName(text(form,'ad_en',200),'en'),lines(text(form,'es_anlamlilar',6000))])).rows[0].r;
  return {result:r,audit:{islem:'alan_duzenle',hedefTur:'alan',hedefId:id,hedefAd:r.sonra?.ad_tr,once:r.once,sonra:r.sonra}};
 });
 refreshFields(fieldPaths(result.eski_slug,result.yeni_slug));
 return {ok:result.eski_slug&&result.yeni_slug&&result.eski_slug!==result.yeni_slug?`Kaydedildi. Adres değişti; eski adres /tr/alan/${result.eski_slug} yeni adrese 308 ile yönlenir.`:'Kaydedildi.'};
}
/** Step 1 ("ara"): candidates for the target. Step 2 ("birlestir"): the chosen target, after the second click. */
async function mergeAreaImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id');
 if(form.get('islem')!=='birlestir'){
  const query=text(form,'hedef',120).trim();if(query.length<2)return {error:'Hedef alanın adını, adresini ya da kimliğini yazın.'};
  const rows=await mergeCandidates(admin.config,query,id);
  if(!rows.length)return {error:`“${query}” için alan bulunamadı.`,sorgu:query};
  return {sorgu:query,adaylar:rows.map(r=>({id:r.id,ad:r.ad_tr||r.ad_en||r.id,kaynak:r.kaynak,kisi:r.kisi}))};
 }
 const target=uuid(form,'hedef_id');
 const result=await inAdminTransaction(admin,async client=>{
  const r=(await client.query<{r:FieldResult}>('SELECT yarenler_yonetici_alan_birlestir($1::uuid,$2::uuid) AS r',[id,target])).rows[0].r;
  const once=r.once as {kaynak?:{ad_tr?:string}}|undefined;
  return {result:r,audit:{islem:'alan_birlestir',hedefTur:'alan',hedefId:id,hedefAd:`${once?.kaynak?.ad_tr??''} > ${r.sonra?.ad_tr??''}`,once:r.once,sonra:r.sonra}};
 });
 refreshFields(fieldPaths(result.eski_slug,result.yeni_slug));
 redirect(`${ADMIN_PATH}/alanlar/${target}?birlesti=1`);
}
async function deleteAreaImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id');
 const result=await inAdminTransaction(admin,async client=>{
  const r=(await client.query<{r:FieldResult}>('SELECT yarenler_yonetici_alan_sil($1::uuid) AS r',[id])).rows[0].r;
  const once=r.once as {ad_tr?:string}|undefined;
  return {result:r,audit:{islem:'alan_sil',hedefTur:'alan',hedefId:id,hedefAd:once?.ad_tr,once:{...r.once,kisi_sayisi:r.kisi_sayisi}}};
 });
 refreshFields(fieldPaths(result.eski_slug));
 redirect(`${ADMIN_PATH}/alanlar?silindi=1`);
}
/** "Onaylandı" flag of a user or panel field (approved user fields may be indexed later). */
async function approveAreaImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id'),on=form.get('onayli')==='1';
 const result=await inAdminTransaction(admin,async client=>{
  const r=(await client.query<{r:{once:unknown;sonra:unknown;ad_tr:string|null;slug:string|null}}>('SELECT yarenler_yonetici_alan_onay($1::uuid,$2::boolean) AS r',[id,on])).rows[0].r;
  return {result:r,audit:{islem:on?'alan_onayla':'alan_onay_kaldir',hedefTur:'alan',hedefId:id,hedefAd:r.ad_tr,once:r.once,sonra:r.sonra}};
 });
 refreshFields(fieldPaths(result.slug));
 return {ok:on?'Alan onaylandı.':'Onay kaldırıldı.'};
}
export async function createArea(_s:AdminState,form:FormData){return run('createArea',createAreaImpl,form);}
export async function approveArea(_s:AdminState,form:FormData){return run('approveArea',approveAreaImpl,form);}
export async function editArea(_s:AdminState,form:FormData){return run('editArea',editAreaImpl,form);}
export async function mergeArea(_s:AdminState,form:FormData){return run('mergeArea',mergeAreaImpl,form);}
export async function deleteArea(_s:AdminState,form:FormData){return run('deleteArea',deleteAreaImpl,form);}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
async function announcementImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id'),islem=text(form,'islem',20);
 if(!['kaldir','geri_al','uzat'].includes(islem))throw new UserError('İşlem geçersiz.','Invalid action.');
 const weeks=islem==='uzat'?Number(form.get('hafta')):null;
 if(islem==='uzat'&&(!Number.isInteger(weeks)||weeks!<1||weeks!>14))throw new UserError('Süre 1 ile 14 hafta arasında olmalı.','Duration must be 1 to 14 weeks.');
 const result=await inAdminTransaction(admin,async client=>{
  const r=(await client.query<{r:{once:unknown;sonra:unknown;kisa_kimlik:string;metin:string}}>('SELECT yarenler_yonetici_duyuru($1::uuid,$2::text,$3::int) AS r',[id,islem,weeks])).rows[0].r;
  return {result:r,audit:{islem:'duyuru_'+islem,hedefTur:'duyuru',hedefId:r.kisa_kimlik,hedefAd:r.metin.slice(0,120),once:r.once,sonra:r.sonra}};
 });
 refreshAnnouncements([{id:result.kisa_kimlik,text:result.metin}]);
 return {ok:islem==='kaldir'?'Duyuru kaldırıldı.':islem==='geri_al'?'Duyuru yeniden yayında.':'Süre uzatıldı.'};
}
export async function announcementAction(_s:AdminState,form:FormData){return run('announcement',announcementImpl,form);}

// ---------------------------------------------------------------------------
// Profiles, restrictions, ownership claims
// ---------------------------------------------------------------------------
async function visibilityImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id'),hide=form.get('islem')==='gizle';
 const {result,announcements}=await inAdminTransaction(admin,async client=>{
  const r=(await client.query<{r:{once:unknown;sonra:unknown;kisa_kimlik:string;ad:string}}>('SELECT yarenler_yonetici_profil($1::uuid,$2::boolean) AS r',[id,hide])).rows[0].r;
  const live=(await client.query<{kisa_kimlik:string;yayin_metni:string}>("SELECT kisa_kimlik,yayin_metni FROM announcement WHERE sahip_id=$1::uuid AND durum='yayinda' AND bitis>now()",[id])).rows;
  return {result:{result:r,announcements:live.map(a=>({id:a.kisa_kimlik,text:a.yayin_metni}))},audit:{islem:hide?'profil_gizle':'profil_goster',hedefTur:'profil',hedefId:r.kisa_kimlik,hedefAd:r.ad,once:r.once,sonra:r.sonra}};
 });
 invalidateNetwork();revalidateEverything();
 const paths=[personPath(result.kisa_kimlik,result.ad),personPath(result.kisa_kimlik,result.ad,'en')];
 refreshAnnouncements(announcements);
 after(async()=>{await Promise.all([purgeCdn([...paths,'/tr','/en','/tr/kesfet','/en/explore']),notifyIndexNow(paths)]);});
 return {ok:hide?'Profil gizlendi; duyuruları da görünmez.':'Profil yeniden görünür.'};
}
async function restrictImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id');
 const alan=form.get('alan_ekleme')==='on',duyuru=form.get('duyuru')==='on';
 await inAdminTransaction(admin,async client=>{
  const r=(await client.query<{r:{once:unknown;sonra:unknown;ad:string}}>('SELECT yarenler_yonetici_kisitla($1::uuid,$2::boolean,$3::boolean,$4::text) AS r',[id,alan,duyuru,text(form,'sebep',600)])).rows[0].r;
  return {result:r,audit:{islem:alan||duyuru?'kisitla':'kisit_kaldir',hedefTur:'profil',hedefId:id,hedefAd:r.ad,once:r.once,sonra:r.sonra}};
 });
 revalidatePath(ADMIN_PATH,'layout');
 return {ok:alan||duyuru?'Kısıtlama kaydedildi.':'Kısıtlama kaldırıldı.'};
}
/**
 * Ownership claim (0009): "onayla" binds the ORCID iD of the request to the profile (an explicit manual decision;
 * no automatic claim by name similarity), evidence "yonetici"; "reddet" closes it; "not" only saves the note.
 */
async function claimImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id'),karar=text(form,'karar',10);
 if(!['onayla','reddet','not'].includes(karar))throw new UserError('Karar geçersiz.','Invalid decision.');
 const r=await inAdminTransaction(admin,async client=>{
  const row=(await client.query<{r:{once:unknown;sonra:unknown;kisa_kimlik:string;ad:string;orcid:string}}>('SELECT yarenler_yonetici_talep($1::uuid,$2::text,$3::text) AS r',[id,karar,text(form,'not',1200)])).rows[0].r;
  return {result:row,audit:{islem:karar==='onayla'?'talep_onayla':karar==='reddet'?'talep_reddet':'talep_not',hedefTur:'talep',hedefId:id,hedefAd:`${row.orcid} > ${row.ad}`,once:row.once,sonra:row.sonra}};
 });
 revalidatePath(ADMIN_PATH,'layout');
 if(karar==='onayla'){
  // The profile now shows the ORCID iD and counts as claimed.
  invalidateNetwork();revalidateEverything();
  const paths=[personPath(r.kisa_kimlik,r.ad),personPath(r.kisa_kimlik,r.ad,'en')];
  after(async()=>{await Promise.all([purgeCdn(paths),notifyIndexNow(paths)]);});
 }
 return {ok:karar==='onayla'?`Talep onaylandı; ${r.orcid} artık bu profile bağlı (kanıt: yönetici).`:karar==='reddet'?'Talep reddedildi.':'Not kaydedildi.'};
}
export async function profileVisibility(_s:AdminState,form:FormData){return run('profileVisibility',visibilityImpl,form);}
export async function restrictPerson(_s:AdminState,form:FormData){return run('restrictPerson',restrictImpl,form);}
export async function claimAction(_s:AdminState,form:FormData){return run('claim',claimImpl,form);}

// ---------------------------------------------------------------------------
// Violations and bans (migration 0016)
// ---------------------------------------------------------------------------
const ORCID=/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
/** Reason of a ban action (required for giving and lifting; recorded in the audit log). */
function reason(form:FormData){const r=text(form,'gerekce',600).replace(/\s+/g,' ').trim();if(r.length<3||r.length>500)throw new UserError('Gerekçe 3 ile 500 karakter arasında olmalı.','The reason must be 3 to 500 characters.');return r;}
/** Announcement ban of a person: give or reset ("ver", 1-365 days) or lift ("kaldir"). */
async function announcementBanImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id'),islem=text(form,'islem',10),gerekce=reason(form);
 if(!['kaldir','ver'].includes(islem))throw new UserError('İşlem geçersiz.','Invalid action.');
 const days=islem==='ver'?Number(form.get('gun')):null;
 if(islem==='ver'&&(!Number.isInteger(days)||days!<1||days!>365))throw new UserError('Süre 1 ile 365 gün arasında olmalı.','Duration must be 1 to 365 days.');
 const r=await inAdminTransaction(admin,async client=>{
  const row=(await client.query<{r:{once:unknown;sonra:unknown;ad:string}}>('SELECT yarenler_yonetici_duyuru_yasagi($1::uuid,$2::text,$3::int,$4::text) AS r',[id,islem,days,gerekce])).rows[0].r;
  return {result:row,audit:{islem:islem==='kaldir'?'duyuru_yasagi_kaldir':'duyuru_yasagi_ver',hedefTur:'profil',hedefId:id,hedefAd:row.ad,once:row.once,sonra:{...(row.sonra as object|null),gerekce}}};
 });
 revalidatePath(ADMIN_PATH,'layout');
 return {ok:islem==='kaldir'?`${r.ad}: duyuru yasağı kaldırıldı.`:`${r.ad}: duyuru yasağı ${days} gün sonra bitecek.`};
}
/**
 * Platform ban by profile ("person") or ORCID iD, indefinite or timed: sign-in refused, sessions deleted, no
 * registration again with the same ORCID iD or profile, announcements taken down, profile optionally hidden,
 * profile editing, new fields and announcements closed. Lifting restores a profile hidden by the ban.
 */
async function platformBanImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),ban=form.get('islem')==='yasakla',gerekce=reason(form);
 const person=form.get('person')?uuid(form,'person'):null,orcid=text(form,'orcid',30).trim().toUpperCase()||null;
 if(!person&&!orcid)throw new UserError('Profil ya da ORCID iD gerekli.','A profile or an ORCID iD is required.');
 if(orcid&&!ORCID.test(orcid))throw new UserError('ORCID iD biçimi geçersiz (0000-0000-0000-0000).','Invalid ORCID iD.');
 const gunRaw=String(form.get('gun')||''),gun=gunRaw?Number(gunRaw):null;
 if(ban&&gun!==null&&(!Number.isInteger(gun)||gun<1||gun>3650))throw new UserError('Süre geçersiz.','Invalid duration.');
 const r=await inAdminTransaction(admin,async client=>{
  const row=(await client.query<{r:{id:string;once:unknown;sonra:{profil_gizlendi?:boolean}|null;ad:string|null;kisa_kimlik:string|null;orcid:string|null;profil_geri?:boolean;duyurular:{kisa_kimlik:string;metin:string}[]}}>('SELECT yarenler_yonetici_platform_yasagi($1::uuid,$2::text,$3::boolean,$4::int,$5::text,$6::boolean) AS r',[person,orcid,ban,ban?gun:null,gerekce,form.get('profil_gizle')==='on'])).rows[0].r;
  return {result:row,audit:{islem:ban?'platform_yasakla':'platform_yasagi_kaldir',hedefTur:person?'profil':'orcid',hedefId:person||row.orcid||orcid,hedefAd:row.ad,once:row.once,sonra:row.sonra?{...row.sonra}:{gerekce}}};
 });
 revalidatePath(ADMIN_PATH,'layout');
 refreshAnnouncements(r.duyurular.map(a=>({id:a.kisa_kimlik,text:a.metin})));
 if(r.kisa_kimlik&&r.ad&&(r.sonra?.profil_gizlendi||r.profil_geri)){
  // The profile was hidden or shown again.
  invalidateNetwork();revalidateEverything();
  const paths=[personPath(r.kisa_kimlik,r.ad),personPath(r.kisa_kimlik,r.ad,'en')];
  after(async()=>{await Promise.all([purgeCdn([...paths,'/tr','/en','/tr/kesfet','/en/explore']),notifyIndexNow(paths)]);});
 }
 const who=r.ad||r.orcid||orcid;
 return {ok:ban?`${who} platformdan yasaklandı${gun?` (${gun} gün)`:' (süresiz)'}; oturumları silindi, ${r.duyurular.length} duyurusu kaldırıldı${r.sonra?.profil_gizlendi?', profili gizlendi':''}.`:`${who} için platform yasağı kaldırıldı.`};
}
export async function announcementBan(_s:AdminState,form:FormData){return run('announcementBan',announcementBanImpl,form);}
export async function platformBan(_s:AdminState,form:FormData){return run('platformBan',platformBanImpl,form);}

async function resolveAppealImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id');
 await inAdminTransaction(admin,async client=>{
  const row=(await client.query<{r:{once:unknown;sonra:unknown;person_id:string}}>('SELECT yarenler_itiraz_sonuclandir($1::uuid,$2::text,$3::text) AS r',[id,text(form,'karar',10),text(form,'yanit',2001)])).rows[0].r;
  return {result:row,audit:{islem:'itiraz_sonuclandir',hedefTur:'itiraz',hedefId:id,once:row.once,sonra:row.sonra}};
 });
 revalidatePath('/yonetici/itirazlar');revalidatePath('/tr/itiraz');revalidatePath('/en/appeal');
 redirect('/yonetici/itirazlar?durum='+encodeURIComponent(text(form,'karar',10)));
}
export async function resolveAppeal(_state:AdminState,form:FormData):Promise<AdminState>{return run('resolve_appeal',resolveAppealImpl,form);}

async function institutionStatusImpl(form:FormData):Promise<AdminState>{
 const admin=await adminAction(),id=uuid(form,'id'),status=text(form,'status',20),reason=text(form,'reason',1000).trim();
 if(reason.length<20||!['bekliyor','kabul','ret'].includes(status))throw new UserError('Durum ve en az 20 karakterlik inceleme gerekçesi gerekli.','Status and review reason are required.');
 if(status==='kabul'&&form.get('verified')!=='on')throw new UserError('İmza, kurumsal adres, temsil yetkisi ve karşılıklı mutabakat teyidi gerekli.','Verify signature, institutional address, authority and mutual agreement.');
 await inAdminTransaction(admin,async client=>{const r=(await client.query('SELECT yarenler_kurum_durum($1::uuid,$2::text) d',[id,status])).rows[0].d;return {result:r,audit:{islem:'kurum_inceleme',hedefTur:'kurum_basvurusu',hedefId:id,once:{durum:r.once},sonra:{durum:r.sonra,gerekce:reason}}};});
 revalidatePath('/yonetici/kurumlar');return {ok:'İnceleme durumu kaydedildi. Kaynak erişimi ayrıca yetkili kapsamla tanımlanır.'};
}
export async function institutionStatus(_state:AdminState,form:FormData):Promise<AdminState>{return run('institutionStatus',institutionStatusImpl,form);}
