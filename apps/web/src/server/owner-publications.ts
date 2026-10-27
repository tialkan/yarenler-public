'use server';
import {after} from 'next/server';
import {redirect,unstable_rethrow} from 'next/navigation';
import {requireMember} from './access';
import {authDb} from './auth';
import {actionErrorMessage,formLang,UserError,type ActionState} from './action-errors';
import {revalidateEverything} from './revalidate';
import {notifyProfile} from './indexnow';
import {invalidateNetwork} from './network';
async function update(form:FormData){
 const {session,personId}=await requireMember('profil'),lang=formLang(form);
 if(form.get('operation')==='visibility'){
  const id=String(form.get('publication')||'');if(!/^[0-9a-f-]{36}$/.test(id))throw new UserError('Geçersiz yayın.','Invalid publication.');
  await authDb().query('SELECT yarenler_yayin_sec($1::uuid,$2::uuid,$3::boolean)',[session.id,id,form.get('visible')==='true']);
 }else{
  const title=String(form.get('title')||'').trim(),year=String(form.get('year')||''),venue=String(form.get('venue')||'').trim();
  let doi=String(form.get('doi')||'').trim().replace(/^https?:\/\/(?:dx\.)?doi.org\//i,'').toLowerCase();doi=doi.replace(/^doi:\s*/i,'');
  if(title.length<5||title.length>2000||venue.length>300||(year&&(!/^\d{4}$/.test(year)||Number(year)<1900||Number(year)>2100))||(doi&&!/^10\.\d{4,9}\/\S{1,280}$/.test(doi))||form.get('confirm')!=='on')throw new UserError('Yayın bilgilerini kontrol edin ve yazarı olduğunuzu doğrulayın.','Check the publication details and confirm your authorship.');
  await authDb().query('SELECT yarenler_yayin_ekle($1::uuid,$2::text,$3::int,$4::text,$5::text,$6::text)',[session.id,title,year?Number(year):null,String(form.get('type')||''),doi||null,venue||null]);
 }
 invalidateNetwork();revalidateEverything();after(async()=>{await notifyProfile(personId);if(process.env.SEMANTIC_URL)await fetch(process.env.SEMANTIC_URL+'/refresh',{method:'POST',signal:AbortSignal.timeout(3000)}).catch(()=>{});});
 redirect((lang==='en'?'/en/my-profile':'/tr/profilim')+'?publications=1#yayinlarim');
}
export async function savePublication(_state:ActionState,form:FormData):Promise<ActionState>{try{await update(form);return null;}catch(error){unstable_rethrow(error);return {error:actionErrorMessage(error,formLang(form),{action:'savePublication'})};}}
