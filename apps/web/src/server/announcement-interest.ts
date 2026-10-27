'use server';
import {unstable_rethrow} from 'next/navigation';
import {requireMember} from './access';
import {authDb} from './auth';
import {actionErrorMessage,formLang,UserError} from './action-errors';
export type InterestState={active:boolean;error?:string}|null;
export async function setAnnouncementInterest(_state:InterestState,form:FormData):Promise<InterestState>{
 try{const {session}=await requireMember('profil'),id=String(form.get('id')||''),active=form.get('active')==='true';if(!/^[0-9a-z]{6,12}$/.test(id))throw new UserError('Geçersiz duyuru.','Invalid announcement.');const row=await authDb().query('SELECT yarenler_duyuru_ilgi($1::uuid,$2::text,$3::boolean) active',[session.id,id,active]);return {active:row.rows[0].active};}
 catch(error){unstable_rethrow(error);if((error as {code?:string}).code==='YA033')return {active:false,error:formLang(form)==='tr'?'Bugünkü ilgi bildirim sınırına ulaştınız. Yarın yeniden deneyin.':'Today’s interest allowance is used. Please try again tomorrow.'};return {active:form.get('active')!=='true',error:actionErrorMessage(error,formLang(form),{action:'announcementInterest'})};}
}
