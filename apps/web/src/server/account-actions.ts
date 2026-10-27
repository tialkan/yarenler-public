'use server';
import {cookies,headers} from 'next/headers';
import {after} from 'next/server';
import {notifyIndexNow,notifyProfile} from './indexnow';
import {redirect,unstable_rethrow} from 'next/navigation';
import {UserError,actionErrorMessage,formLang,type ActionState} from './action-errors';
import {reportError} from './error-report';
import {invalidateNetwork} from './network';
import {revalidateEverything,revalidateAnnouncements,announcementIndexNowPaths} from './revalidate';
import {purgeCdn} from './cdn-purge';
import {authDb,sessionName,secureCookie,appOrigin,digest} from './auth';
import {randomBytes} from 'node:crypto';
import {registrationDraft,detectDuplicate,KVKK_VERSION} from './registration-sources';
import {declaredInstitution,shortSlug} from './registration';
import {memberAccess,requireMember} from './access';
async function verifyOrigin(){if((await headers()).get('origin')!==appOrigin())throw new UserError('İstek kaynağı geçersiz.','Request origin is invalid.');}
async function signOutImpl(form:FormData){await verifyOrigin();const cookie=await cookies(),token=cookie.get(sessionName)?.value;if(token)await authDb().query('DELETE FROM orcid_session WHERE belirtec_ozeti=$1',[digest(token)]);cookie.set(sessionName,'',{...secureCookie,maxAge:0});redirect(form.get('lang')==='en'?'/en':'/tr');}
async function saveProfileImpl(form:FormData){const {session}=await requireMember('profil');const title=String(form.get('title')||'').trim();if(title.length>120)throw new UserError('Unvan en fazla 120 karakter olabilir.','Title can be at most 120 characters.');const selected=form.getAll('areas').map(String);if(selected.length>100||selected.some(id=>!/^[-a-f0-9]{36}$/.test(id)))throw new UserError('Alan seçimi geçersiz.','The field selection is invalid.');const interests=form.getAll('interests').map(String);if(interests.length>100||interests.some(id=>!/^[-a-f0-9]{36}$/.test(id)))throw new UserError('İşbirliği alanı seçimi geçersiz.','The collaboration field selection is invalid.');const client=await authDb().connect();try{await client.query('BEGIN');await client.query("UPDATE person SET unvan=$1,unvan_kaynagi='kullanici',guncelleme=now() WHERE id=$2 AND orcid=$3",[title||null,session.person_id,session.orcid]);
 // A saved profile is authoritative: never reapply a removed pilot suggestion.
 await client.query('INSERT INTO profile_field_review(person_id) VALUES($1) ON CONFLICT DO NOTHING',[session.person_id]);
 await client.query("UPDATE research_area_suggestion SET status=CASE WHEN area_id=ANY($2::uuid[]) THEN 'accepted' ELSE 'dismissed' END WHERE person_id=$1",[session.person_id,selected]);
 await client.query('DELETE FROM person_research_area WHERE person_id=$1 AND NOT(area_id=ANY($2::uuid[]) OR coalesce((SELECT k.kanonik_id FROM research_area k WHERE k.id=area_id),area_id)=ANY($2::uuid[]))',[session.person_id,selected]);
 for(const id of selected)await client.query("INSERT INTO person_research_area(person_id,area_id,kaynak) SELECT $1::uuid,r.id,'kullanici' FROM research_area r WHERE r.id=$2::uuid AND NOT EXISTS(SELECT 1 FROM person_research_area x JOIN research_area s ON s.id=x.area_id WHERE x.person_id=$1::uuid AND s.id<>r.id AND s.kanonik_id=r.id) ON CONFLICT(person_id,area_id) DO UPDATE SET kaynak='kullanici'",[session.person_id,id]);await client.query('DELETE FROM person_collaboration_area WHERE person_id=$1 AND NOT(area_id=ANY($2::uuid[]) OR coalesce((SELECT k.kanonik_id FROM research_area k WHERE k.id=area_id),area_id)=ANY($2::uuid[]))',[session.person_id,interests]);for(const id of interests)await client.query('INSERT INTO person_collaboration_area(person_id,area_id) SELECT $1::uuid,r.id FROM research_area r WHERE r.id=$2::uuid AND NOT EXISTS(SELECT 1 FROM person_collaboration_area x JOIN research_area s ON s.id=x.area_id WHERE x.person_id=$1::uuid AND s.kanonik_id=r.id) ON CONFLICT DO NOTHING',[session.person_id,id]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}invalidateNetwork();revalidateEverything();after(()=>notifyProfile(session.person_id!));redirect(form.get('lang')==='en'?'/en/my-profile?saved=1':'/tr/profilim?saved=1');}
async function removeAnnouncementImpl(form:FormData){const {session}=await requireMember('sil');if(form.get('onay')!=='evet')throw new UserError('Silmek için onay gerekli.','Please confirm the deletion.');const id=String(form.get('id')||'');if(!/^[a-f0-9-]{36}$/.test(id))throw new UserError('Geçersiz duyuru.','Invalid announcement.');const removed=(await authDb().query("UPDATE announcement SET durum='kaldirildi'::text,guncelleme=now() WHERE id=$1::uuid AND sahip_id=$2::uuid AND durum<>'kaldirildi'::text RETURNING kisa_kimlik,yayin_metni",[id,session.person_id])).rows.map(r=>({id:String(r.kisa_kimlik),text:String(r.yayin_metni)}));revalidateAnnouncements();after(async()=>{const paths=announcementIndexNowPaths(removed);await Promise.all([notifyIndexNow(paths),purgeCdn([...paths,'/tr/duyurular/rss.xml','/en/announcements/rss.xml','/sitemaps/duyurular.xml'])]);});redirect(form.get('lang')==='en'?'/en/my-profile':'/tr/profilim');}

const profilePath=(form:FormData,query='')=>(form.get('lang')==='en'?'/en/my-profile':'/tr/profilim')+query;
function areaIds(form:FormData){const ids=[...new Set(form.getAll('areas').map(String))];if(ids.length>100||ids.some(id=>!/^[-a-f0-9]{36}$/.test(id)))throw new UserError('Alan seçimi geçersiz.','The field selection is invalid.');return ids;}
/**
 * ORCID self-registration for researchers without a profile. The person row is created first,
 * then the authenticated ORCID iD is attached in the same transaction; person.orcid is UNIQUE.
 */
async function registerProfileImpl(form:FormData){
 // Central check (access.ts): a platform banned ORCID iD or profile cannot register again.
 const {session}=await memberAccess('kayit');if(session.person_id)redirect(profilePath(form));
 if(form.get('kvkk')!=='on')redirect(profilePath(form,'?error=kvkk'));
 const draft=await registrationDraft(session.orcid,session.gorunen_ad);if(draft.removed)redirect(profilePath(form));if(!draft.name)redirect(profilePath(form,'?error=name'));if(draft.duplicate)redirect(profilePath(form));
 const title=String(form.get('title')||'').trim();if(title.length>120)throw new UserError('Unvan en fazla 120 karakter olabilir.','Title can be at most 120 characters.');
 const key=String(form.get('institution')||''),choice=draft.choices.find(c=>c.key===key)||null,declared=choice?null:declaredInstitution(form.get('kurum_beyan'));if(!choice&&!declared)redirect(profilePath(form,'?error=kurum'));
 const selected=areaIds(form);
 const duplicate=await detectDuplicate(session.orcid,draft.name.display,choice?[choice]:[{ror:null,openalexId:null,name:declared!}]);
 if(duplicate){await authDb().query('INSERT INTO profil_sahiplenme_talebi(orcid,person_id,neden) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[session.orcid,duplicate.personId,duplicate.reason]);await authDb().query('UPDATE orcid_kayit_taslagi SET veri=jsonb_set(veri,\'{duplicate}\',$2::jsonb) WHERE orcid=$1',[session.orcid,JSON.stringify(duplicate)]);redirect(profilePath(form));}
 const client=await authDb().connect();let personId:string;try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['orcid:'+session.orcid]);
  const existing=(await client.query('SELECT id FROM person WHERE orcid=$1',[session.orcid])).rows[0];
  if(existing){personId=existing.id;}else{
   let institutionId:string|null=null;
   if(choice){const found=(await client.query('SELECT id FROM institution WHERE ($1::text IS NOT NULL AND ror=$1) OR ($2::text IS NOT NULL AND openalex_id=$2) OR ($1::text IS NULL AND $2::text IS NULL AND ror IS NULL AND openalex_id IS NULL AND yarenler_katla(ad)=yarenler_katla($3) AND ulke IS NOT DISTINCT FROM $4) ORDER BY (ror IS NOT NULL) DESC LIMIT 1',[choice.ror,choice.openalexId,choice.name,choice.country])).rows[0];
    institutionId=found?.id||(await client.query('INSERT INTO institution(kisa_ad,ad,ulke,ror,openalex_id,kaynak,kanit) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[shortSlug(choice.name)+'-'+randomBytes(3).toString('hex'),choice.name,choice.country,choice.ror,choice.openalexId,choice.ror&&choice.origin==='orcid'?'ror':choice.origin,{kaynak:choice.origin,orcid:session.orcid,detay:choice.detail,tarih:new Date().toISOString()}])).rows[0].id;}
   const name=draft.name;const created=await client.query("INSERT INTO person(kisa_kimlik,institution_id,kurum_beyan,ad,soyad,gorunen_ad,unvan,unvan_kaynagi,kaynak,kvkk_onay,kvkk_metin_surumu) VALUES($1,$2,$3,$4,$5,$6,$7,'kullanici','orcid_kayit',now(),$8) RETURNING id",[randomBytes(5).toString('hex'),institutionId,declared,name.given||name.display,name.family||'',name.display,title||null,KVKK_VERSION]);personId=created.rows[0].id;
   // Then attach the ORCID iD verified by the OAuth token exchange.
   await client.query('UPDATE person SET orcid=$1,sahiplenildi=true,sahiplenme_tarihi=now(),guncelleme=now() WHERE id=$2',[session.orcid,personId]);
   await client.query("INSERT INTO person_identifier_resolution(person_id,orcid,source_url,evidence) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[personId,session.orcid,`https://pub.orcid.org/v3.0/${session.orcid}/person`,{kaynak:'orcid_oauth',openalex:draft.openalexAuthor,tarih:new Date().toISOString()}]);
   for(const id of selected)await client.query("INSERT INTO person_research_area(person_id,area_id,kaynak) SELECT $1::uuid,r.id,'kullanici' FROM research_area r WHERE r.id=$2::uuid ON CONFLICT DO NOTHING",[personId,id]);
   await client.query('INSERT INTO profile_field_review(person_id) VALUES($1) ON CONFLICT DO NOTHING',[personId]);}
  await client.query('UPDATE orcid_session SET person_id=$1 WHERE orcid=$2',[personId,session.orcid]);await client.query('DELETE FROM orcid_kayit_taslagi WHERE orcid=$1',[session.orcid]);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='23505')redirect(profilePath(form));throw error;}finally{client.release();}
 invalidateNetwork();revalidateEverything();after(()=>notifyProfile(personId));redirect(profilePath(form,'?created=1'));}

/** Owner removal. Self-registered profiles are deleted; AVESİS profiles are hidden and stay hidden on re-import. */
async function removeProfileImpl(form:FormData){const {session}=await requireMember('sil');if(form.get('confirm')!=='on')redirect(profilePath(form,'?error=confirm'));
 let removedAnnouncements:{id:string;text:string}[]=[];
 const client=await authDb().connect();try{await client.query('BEGIN');const row=(await client.query('SELECT kaynak FROM person WHERE id=$1 AND orcid=$2 FOR UPDATE',[session.person_id,session.orcid])).rows[0];if(!row)throw new UserError('Profil bulunamadı.','Profile not found.');
  if(row.kaynak==='orcid_kayit'){removedAnnouncements=(await client.query("SELECT kisa_kimlik,yayin_metni FROM announcement WHERE sahip_id=$1 AND durum='yayinda'",[session.person_id])).rows.map(r=>({id:String(r.kisa_kimlik),text:String(r.yayin_metni)}));await client.query('DELETE FROM person WHERE id=$1',[session.person_id]);}
  else{removedAnnouncements=(await client.query("UPDATE announcement SET durum='kaldirildi',guncelleme=now() WHERE sahip_id=$1 AND durum='yayinda' RETURNING kisa_kimlik,yayin_metni",[session.person_id])).rows.map(r=>({id:String(r.kisa_kimlik),text:String(r.yayin_metni)}));await client.query('UPDATE person SET aktif=false,kaldirma_tarihi=now(),guncelleme=now() WHERE id=$1',[session.person_id]);}
  await client.query('DELETE FROM orcid_session WHERE orcid=$1',[session.orcid]);await client.query('DELETE FROM orcid_kayit_taslagi WHERE orcid=$1',[session.orcid]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 (await cookies()).set(sessionName,'',{...secureCookie,maxAge:0});invalidateNetwork();revalidateEverything();after(async()=>{await notifyIndexNow(announcementIndexNowPaths(removedAnnouncements));});redirect(form.get('lang')==='en'?'/en?removed=1':'/tr?removed=1');}

/** A hidden AVESİS profile can be shown again by its verified owner. */
async function reactivateProfileImpl(form:FormData){const {session}=await memberAccess('kayit');const row=(await authDb().query('UPDATE person SET aktif=true,kaldirma_tarihi=NULL,guncelleme=now() WHERE orcid=$1 AND NOT aktif AND NOT yonetici_gizledi RETURNING id',[session.orcid])).rows[0];if(!row&&(await authDb().query('SELECT 1 FROM person WHERE orcid=$1 AND NOT aktif AND yonetici_gizledi',[session.orcid])).rowCount)throw new UserError('Bu profil yönetici tarafından gizlendi; yeniden açmak için Yarenler ile iletişime geçin.','This profile was hidden by the administrators; please contact Yarenler to restore it.');if(row)await authDb().query('UPDATE orcid_session SET person_id=$1 WHERE orcid=$2',[row.id,session.orcid]);invalidateNetwork();revalidateEverything();redirect(profilePath(form,'?saved=1'));}

/**
 * useActionState entry points. Redirects and other Next.js control flow are rethrown;
 * any other error becomes a user facing message (details stay in the server log).
 */
async function run(action:string,impl:(form:FormData)=>Promise<void>,form:FormData):Promise<ActionState>{try{await impl(form);return null;}catch(error){unstable_rethrow(error);return {error:actionErrorMessage(error,formLang(form),{action,report:failure=>after(()=>reportError(failure,{kind:'action',action}))})};}}
export async function signOut(_state:ActionState,form:FormData):Promise<ActionState>{return run('signOut',signOutImpl,form);}
export async function saveProfile(_state:ActionState,form:FormData):Promise<ActionState>{return run('saveProfile',saveProfileImpl,form);}
export async function removeAnnouncement(_state:ActionState,form:FormData):Promise<ActionState>{return run('removeAnnouncement',removeAnnouncementImpl,form);}
export async function registerProfile(_state:ActionState,form:FormData):Promise<ActionState>{return run('registerProfile',registerProfileImpl,form);}
export async function removeProfile(_state:ActionState,form:FormData):Promise<ActionState>{return run('removeProfile',removeProfileImpl,form);}
export async function reactivateProfile(_state:ActionState,form:FormData):Promise<ActionState>{return run('reactivateProfile',reactivateProfileImpl,form);}
