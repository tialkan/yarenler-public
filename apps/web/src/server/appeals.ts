'use server';
import {revalidatePath} from 'next/cache';
import {redirect,unstable_rethrow} from 'next/navigation';
import {requireMember} from './access';
import {authDb} from './auth';
import {actionErrorMessage,formLang,UserError,type ActionState} from './action-errors';
export async function submitAppeal(_state:ActionState,form:FormData):Promise<ActionState>{
 const lang=formLang(form),path=lang==='tr'?'/tr/itiraz':'/en/appeal';
 try{
  const {session}=await requireMember('profil');
  const violation=String(form.get('violation')||'');
  if(violation&&!/^[0-9a-f-]{36}$/.test(violation))throw new UserError('Karar kaydı geçersiz.','Invalid decision record.');
  const message=String(form.get('message')||'').trim();
  if([...message].length<20||[...message].length>3000)throw new UserError('Açıklama 20 ile 3000 karakter arasında olmalı.','Please use between 20 and 3000 characters.');
  await authDb().query('SELECT yarenler_itiraz_ac($1::uuid,$2::uuid,$3::text,$4::text)',[session.id,violation||null,String(form.get('kind')),message]);
  revalidatePath(path);redirect(path+'?sent=1');
 }catch(error){
  unstable_rethrow(error);
  const code=(error as {code?:string}).code;
  const messages:Record<string,[string,string]>={YA030:['Oturumunuzu yenileyin.','Please sign in again.'],YA031:['Başvuru bilgilerini kontrol edin.','Please check the appeal details.'],YA032:['Bu konuda açık başvurunuz var; aşağıdan izleyebilirsiniz.','You already have an open appeal on this subject.'],YA033:['Bugünkü başvuru sınırına ulaştınız. Acil taleplerinizi tialkan@aybu.edu.tr adresine iletebilirsiniz.','Daily submission limit reached. For urgent requests, contact tialkan@aybu.edu.tr.']};
  if(code&&messages[code])return {error:messages[code][lang==='tr'?0:1]};
  return {error:actionErrorMessage(error,lang,{action:'appeal_submit'})};
 }
}
