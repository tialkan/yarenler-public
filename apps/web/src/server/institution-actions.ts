'use server';
import {headers} from 'next/headers';
import {createHash,createHmac} from 'node:crypto';
import {redirect,unstable_rethrow} from 'next/navigation';
import {memberAccess} from './access';
import {authDb} from './auth';
import {clientIp,uploadNetwork} from './client-ip';
import {checkProtocolPdf,MAX_PROTOCOL_BYTES} from './protocol-pdf';
import {formLang,actionErrorMessage,UserError,type ActionState} from './action-errors';
async function submit(form:FormData){
 const {session}=await memberAccess('kayit'),lang=formLang(form),h=await headers(),ip=clientIp(n=>h.get(n)),salt=process.env.UPLOAD_RATE_SECRET;
 if(!ip||!salt)throw new UserError('Güvenli yükleme şu anda kullanılamıyor. Lütfen daha sonra yeniden deneyin.','Secure upload is unavailable; please try again later.');
 const institution=String(form.get('institution')||'').trim(),email=String(form.get('email')||'').trim().toLowerCase(),rawUrl=String(form.get('avesis')||'').trim();
 let url:URL;try{url=new URL(rawUrl);}catch{throw new UserError('Kurumunuzun AVESİS ana adresini yazın.','Enter the institution’s AVESİS base address.');}
 const domain=email.split('@')[1]||'';
 if(institution.length<3||institution.length>300||email.length>254||!/^[-\w.+]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(email)||['gmail.com','outlook.com','hotmail.com','yahoo.com','proton.me','protonmail.com','icloud.com','yandex.com','mail.com','live.com'].includes(domain)||!/^https:\/\/avesis\.[a-z0-9.-]+\/?$/.test(url.toString())||form.get('authority')!=='on'||form.get('privacy')!=='on')throw new UserError('Kurum, kurumsal e-posta, AVESİS adresi ve zorunlu onayları kontrol edin.','Check the institution, institutional email, AVESİS address and required confirmations.');
 const file=form.get('pdf');if(!(file instanceof File)||file.type!=='application/pdf'||!file.name.toLowerCase().endsWith('.pdf')||file.size>MAX_PROTOCOL_BYTES)throw new UserError('Yalnız en fazla 8 MB boyutunda PDF kabul edilir.','Only PDF files up to 8 MB are accepted.');
 // HMAC changes with the Türkiye calendar day: no durable IP tracking across days.
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const hash=createHmac('sha256',salt).update(day+':'+uploadNetwork(ip)).digest('hex');
 try{await authDb().query('SELECT yarenler_kurum_yukleme_ac($1::uuid,$2::text)',[session.id,hash]);}catch(error){if((error as {code?:string}).code==='YA033')throw new UserError('Bugünkü sınır doldu veya çok sık denediniz. ORCID başına günde bir başvuru kabul edilir; ortak ağlarda ek güvenlik sınırları vardır.','The daily limit was reached or requests are too frequent. One application per ORCID iD per day; shared networks have additional abuse limits.');throw error;}
 const bytes=new Uint8Array(await file.arrayBuffer());if(!await checkProtocolPdf(bytes))throw new UserError('PDF okunamadı veya etkin içerik içeriyor. En fazla 30 sayfalık, şifresiz taranmış PDF yükleyin.','The PDF cannot be read or contains active content. Upload an unencrypted scanned PDF of at most 30 pages.');

 let id:string;
 try{id=(await authDb().query('SELECT yarenler_kurum_basvur($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::bytea,$7::text) AS id',[session.id,institution,email,url.toString(),hash,Buffer.from(bytes),createHash('sha256').update(bytes).digest('hex')])).rows[0].id;}
 catch(error){if(['23505','YA033'].includes((error as {code?:string}).code||''))throw new UserError('ORCID veya ortak ağ için bugünkü güvenlik sınırına ulaşıldı. Yarın yeniden deneyebilirsiniz.','The daily limit for this IP address or ORCID iD has been reached. Please try again tomorrow.');throw error;}
 void id;redirect((lang==='en'?'/en/institutional-participation':'/tr/kurumsal-katilim')+'?sent=1');
}
export async function submitInstitution(_state:ActionState,form:FormData):Promise<ActionState>{try{await submit(form);return null;}catch(error){unstable_rethrow(error);return {error:actionErrorMessage(error,formLang(form),{action:'submitInstitution'})};}}
