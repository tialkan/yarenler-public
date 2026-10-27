'use server';
import {headers} from 'next/headers';
import {after} from 'next/server';
import {revalidatePath} from 'next/cache';
import {unstable_rethrow} from 'next/navigation';
import {UserError,actionErrorMessage,formLang,logServerError,type Lang} from './action-errors';
import {appOrigin,authDb} from './auth';
import {reportError} from './error-report';
import {openRouterKey} from './llm';
import {clientIp,userAgent} from './client-ip';
import {ASSIST_MODEL,draftAnnouncement,webSearchDecision,webSearchEnabled,webSearchLimits,type AssistCall} from './announcement-assist';
import {pickSources,stripUnlistedLinks,verifySources,normalizeUrl} from './web-sources';
import {sourceVerifier} from './web-probe';
import {programLinks} from './program-links';
import {AI_BUDGET_MS,ANNOUNCEMENT_MAX_WEEKS,ANNOUNCEMENT_MIN_WEEKS,BAN_DAYS,DAILY_AI_CALL_CAP,HOURLY_AI_CALL_CAP,PUBLISH_DEADLINE_MS} from './announcement-limits';
import {MESSAGES,banMessage,outcomeOf,platformMessage,professionalAnnouncement,rejectionMessage,sanitizeReason,screenAnnouncement,severeMessage,type Outcome,type PublishCandidate,type PublishState} from './announcement-moderation';
import {announcementGate,cleanupViolations} from './announcement-gate';
import {announcementCandidates} from './announcement-candidates';
import {requireMember} from './access';
import {revalidateAnnouncements,announcementIndexNowPaths} from './revalidate';
import {announcementPath,announcementTitle} from './announcement-text';
import {purgeCdn} from './cdn-purge';
import {notifyIndexNow} from './indexnow';

/** Bans and the daily allowance from the database (migration 0016) as a message; null for anything else. */
async function limitState(error:unknown,personId:string,lang:Lang):Promise<PublishState>{
 const e=error as {code?:string;detail?:string};
 switch(e?.code){
  case 'YA021':return {durum:'yasak',mesaj:platformMessage({bitis:e.detail||null},lang)};
  case 'YA022':{const gate=await announcementGate(personId).catch(()=>null);return {durum:'yasak',mesaj:gate?.yasak?banMessage(gate.yasak,lang):MESSAGES.restricted[lang]};}
  case 'YA005':return {durum:'yasak',mesaj:MESSAGES.restricted[lang]};
  case 'YA023':return {durum:'sinir',mesaj:MESSAGES.usedToday[lang]};
  default:return null;
 }
}
const RESULT_SQL='SELECT yarenler_duyuru_denetim_sonucu($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::uuid,$7::text,$8::text,$9::inet,$10::text,$11::int) AS r';
type Result={yasak:{bitis:string}|null;ihlal:string|null};
type Db={query:ReturnType<typeof authDb>['query']};

/**
 * "Yapay Zekâ Desteğiyle Yayımla": one server action, in this order, within PUBLISH_DEADLINE_MS:
 *  (a) central access check (session, platform ban), format check (length, links), then bans and the daily
 *      attempt in the database (atomic; no AI call when closed);
 *  (b) one AI call that edits and moderates with a strict JSON schema, with live web search when allowed
 *      (sources verified by the server); any failure or timeout publishes nothing and frees the attempt;
 *  (c) "yayinla": the announcement is inserted with the attempt in one transaction (ham_metin = the author's
 *      text, yayin_metni = the edit when it passes the meaning guard), verified sources are stored, potential
 *      collaborators are computed, pages are revalidated, the CDN is purged and IndexNow is notified;
 *      "reddet" and "agir_ihlal" are recorded as violations (IP, User-Agent summary), the latter with a ban.
 */
async function publishImpl(form:FormData):Promise<PublishState>{
 const started=Date.now(),deadline=started+PUBLISH_DEADLINE_MS;
 const lang=formLang(form),{personId,session}=await requireMember('profil');
 const h=await headers(),pool=authDb();
 const target=String(form.get('revision')||'');
 if(target&&!/^[0-9a-f-]{36}$/.test(target))throw new UserError('Geçersiz duyuru.','Invalid announcement.');
 const skills=[...new Set(form.getAll('skills').map(String))];
 if(skills.length>3||skills.some(id=>!/^[-0-9a-f]{36}$/.test(id)))throw new UserError('En fazla üç geçerli yetkinlik seçin.','Choose up to three valid skills.');
 if(skills.length&&(await pool.query('SELECT id FROM research_area WHERE id=ANY($1::uuid[])',[skills])).rowCount!==skills.length)throw new UserError('Yetkinliği alan havuzundan seçin.','Choose skills from the field catalog.');
 const weeks=Number(form.get('weeks'));
 if(!Number.isInteger(weeks)||weeks<ANNOUNCEMENT_MIN_WEEKS||weeks>ANNOUNCEMENT_MAX_WEEKS)throw new UserError('Yayın süresi 1 ile 14 hafta arasında olmalı.','The duration must be 1 to 14 weeks.');
 const screen=screenAnnouncement(form.get('text'));
 if(!screen.ok)return {durum:'gecersiz',mesaj:screen.message[lang]};
 const text=screen.text,ip=clientIp(name=>h.get(name)),ua=userAgent(name=>h.get(name));

 let attempt:string;
 try{attempt=(await pool.query<{id:string}>('SELECT yarenler_duyuru_rezervasyon($1::uuid,$2::uuid) AS id',[personId,target||null])).rows[0].id;}
 catch(error){const closed=await limitState(error,personId,lang);if(closed)return closed;throw error;}
 const result=(durum:Outcome|'hata',o:{kategori?:string|null;gerekce?:string|null;duyuru?:string|null;metin?:string|null}={},db:Db=pool)=>{
  const violation=durum==='agir_ihlal';
  return db.query<{r:Result}>(RESULT_SQL,[attempt,personId,durum,o.kategori??null,o.gerekce??null,o.duyuru??null,violation?o.metin??null:null,ASSIST_MODEL,violation?ip:null,violation?ua:null,BAN_DAYS]).then(r=>r.rows[0].r);
 };
 // Fail closed: nothing is published and the attempt does not use the daily allowance.
 const unavailable=async(event:string,error?:unknown):Promise<PublishState>=>{logServerError(event,error??new Error(event));await result('hata').catch(e=>logServerError('announcement_attempt_close_failed',e));return {durum:'hata',mesaj:MESSAGES.unavailable[lang]};};

 const prior=(await pool.query<{n:number}>("SELECT yarenler_duyuru_onceki_deneme($1::uuid) AS n",[personId])).rows[0].n;
 const revisionMode=Boolean(target)||prior>0;
 const apiKey=openRouterKey();if(!apiKey)return unavailable('announcement_ai_unconfigured');
 // Monthly budget, daily model call cap and the web search decision under one lock; reservations are written first.
 const enabled=webSearchEnabled(process.env)&&programLinks(text).length>0;let logId='',searchId:string|null=null,decision:'kullan'|'kapali'|'sinir'='kapali';
 const client=await pool.connect();let closed:string|null=null;
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('yarenler_ai_budget'::text))");
  const configured=Number(process.env.LLM_MONTHLY_BUDGET_USD||5),budget=Number.isFinite(configured)?Math.max(0,Math.min(configured,5)):0;
  const spent=Number((await client.query<{spent:string}>("SELECT COALESCE(sum(maliyet_usd),0)::text AS spent FROM ai_call_log WHERE olusturma>=date_trunc('month',now())")).rows[0].spent);
  const calls=(await client.query<{n:number}>("SELECT count(*)::int AS n FROM ai_call_log WHERE person_id=$1::uuid AND amac='duyuru_guclendirme'::text AND olusturma>now()-interval '1 day'",[personId])).rows[0].n;
  const hourly=(await client.query<{n:number}>("SELECT count(*)::int AS n FROM ai_call_log WHERE person_id=$1 AND amac='duyuru_guclendirme' AND olusturma>now()-interval '1 hour'",[personId])).rows[0].n;
  if(spent+.02>budget||calls>=DAILY_AI_CALL_CAP||hourly>=HOURLY_AI_CALL_CAP)closed=(calls>=DAILY_AI_CALL_CAP||hourly>=HOURLY_AI_CALL_CAP)?'announcement_ai_call_cap':'announcement_ai_budget';
  if(closed){await client.query('ROLLBACK');}else{
  if(enabled){
   const used=(await client.query<{saat:number;gun:number;ay:number}>("SELECT count(*) FILTER (WHERE person_id=$1::uuid AND olusturma>now()-interval '1 hour')::int AS saat,count(*) FILTER (WHERE person_id=$1::uuid AND olusturma>now()-interval '1 day')::int AS gun,count(*) FILTER (WHERE olusturma>=date_trunc('month',now()))::int AS ay FROM web_arama_kaydi WHERE olusturma>=least(date_trunc('month',now()),now()-interval '1 day')",[personId])).rows[0];
   decision=webSearchDecision({enabled,hourly:used.saat,daily:used.gun,monthly:used.ay,limits:webSearchLimits(process.env)});
   if(decision==='kullan')searchId=(await client.query<{id:string}>('INSERT INTO web_arama_kaydi(person_id) VALUES($1::uuid) RETURNING id',[personId])).rows[0].id;
  }
  logId=(await client.query<{id:string}>("INSERT INTO ai_call_log(amac,saglayici,model,girdi_token,cikti_token,maliyet_usd,person_id,basarili) VALUES('duyuru_guclendirme'::text,'openrouter'::text,$1::text,0,0,$2::numeric,$3::uuid,false) RETURNING id",[ASSIST_MODEL,searchId?.02:.01,personId])).rows[0].id;
  await client.query('COMMIT');}
 }catch(error){await client.query('ROLLBACK').catch(()=>{});return unavailable('announcement_budget_failed',error);}
 finally{client.release();}
 if(closed){await result('hata');return {durum:'hata',mesaj:lang==='tr'?'Yapay zekâ kullanım sınırına ulaşıldı. Daha sonra yeniden deneyin; bu işlem içerik hakkınızı kullanmadı.':'The AI usage limit was reached. Try again later; this did not use your content allowance.'};}

 let call:AssistCall;
 try{
  call=await draftAnnouncement({text,revision:revisionMode,apiKey,referer:appOrigin(),web:Boolean(searchId),deadline:started+AI_BUDGET_MS,offlineStatus:decision==='sinir'?'sinir':'kapali',fetch:fetch as never,
   onWebFailure:error=>logServerError('announcement_web_search_failed',error)});
 }catch(error){
  if(searchId)await pool.query("UPDATE web_arama_kaydi SET durum='hata'::text WHERE id=$1::uuid AND durum='baslatildi'::text",[searchId]).catch(()=>{});
  after(()=>reportError(error,{kind:'action',action:'publishWithAi'}));
  return unavailable('announcement_review_failed',error);
 }
 const usage=(call.result.usage||{}) as {prompt_tokens?:number;completion_tokens?:number;cost?:number};
 await pool.query('UPDATE ai_call_log SET girdi_token=$1::int,cikti_token=$2::int,maliyet_usd=$3::numeric,basarili=true WHERE id=$4::uuid',[Number(usage.prompt_tokens||0),Number(usage.completion_tokens||0),Math.max(0,Number(usage.cost)||(call.web?.02:.01)),logId]).catch(error=>logServerError('ai_call_log_update_failed',error));
 const review=call.draft,outcome=outcomeOf(review.karar);

 if(outcome!=='kabul'){
  if(searchId)await pool.query("UPDATE web_arama_kaydi SET durum='tamam'::text,sonuc_sayisi=$2::int WHERE id=$1::uuid",[searchId,call.citations.length]).catch(()=>{});
  const reason=sanitizeReason(review.kisa_gerekce);
  const r=await result(outcome,{kategori:review.kategori,gerekce:reason,metin:text});
  after(()=>cleanupViolations());
  if(outcome==='agir_ihlal'&&r.yasak)return {durum:'yasak',mesaj:severeMessage(review.kategori,r.yasak.bitis,lang)};
  const gate=await announcementGate(personId);
  return {durum:gate.hakKullanildi?'sinir':'ret',mesaj:rejectionMessage(review.kategori,reason,lang,gate.hakKullanildi)};
 }

 // Accepted. Sources: verified search results that are not already in the official programme dictionary.
 const web=call.web?await verifySources(pickSources(call.citations,review.kaynaklar,programLinks(text).map(d=>d.url)),sourceVerifier):[];
 if(searchId)await pool.query("UPDATE web_arama_kaydi SET durum=$2::text,sonuc_sayisi=$3::int,dogrulanan_sayisi=$4::int WHERE id=$1::uuid",[searchId,call.web?'tamam':'hata',call.citations.length,web.length]).catch(error=>logServerError('web_search_log_failed',error));
 // The edit keeps only the draft's own links; it is used only when it stays a minimal correction
 // Concrete numbers and contact details are checked in code; semantic factuality remains a model limitation.
 const ownLinks=(text.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi)||[]).map(u=>u.replace(/[.,;:!?]+$/,'')).filter(u=>normalizeUrl(u));
 const edited=stripUnlistedLinks(review.duzenlenmis_metin.normalize('NFC'),ownLinks);
 const professional=revisionMode?text:professionalAnnouncement(text,edited,lang);
 if(!professional)return unavailable('announcement_edit_invalid');
 const published=professional;
 const kaynaklar=web.map(w=>({url:w.url,baslik:w.title.slice(0,200),alan_adi:w.domain,tur:'web'}));

 const tx=await pool.connect();let created:{id:string;kisa_kimlik:string;yayin_metni:string};
 try{
  await tx.query('BEGIN');
  if(target){
   await tx.query('SELECT yarenler_duyuru_revize($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text[])',[attempt,personId,published,JSON.stringify(kaynaklar),review.anahtar_kelimeler]);
   created=(await tx.query<{id:string;kisa_kimlik:string;yayin_metni:string}>('SELECT id,kisa_kimlik,yayin_metni FROM announcement WHERE id=$1::uuid',[target])).rows[0];
  }else{
  created=(await tx.query<{id:string;kisa_kimlik:string;yayin_metni:string}>('INSERT INTO announcement(sahip_id,ham_metin,yayin_metni,sure_hafta,bitis,kaynaklar,anahtar_kelimeler) VALUES($1::uuid,$2::text,$3::text,$4::int,now()+make_interval(weeks => $4::int),$5::jsonb,$6::text[]) RETURNING id,kisa_kimlik,yayin_metni',[personId,text,published,weeks,JSON.stringify(kaynaklar),review.anahtar_kelimeler])).rows[0];
  }
  await tx.query('SELECT yarenler_duyuru_yetkinlik($1::uuid,$2::uuid,$3::uuid[])',[session.id,created.id,skills]);
  await result('kabul',{duyuru:created.id},tx);
  await tx.query('COMMIT');
 }catch(error){
  await tx.query('ROLLBACK').catch(()=>{});tx.release();
  await result('hata').catch(()=>{});
  const closed=await limitState(error,personId,lang);if(closed)return closed;
  throw error;
 }
 tx.release();
 const item={id:String(created.kisa_kimlik),text:String(created.yayin_metni)};
 revalidateAnnouncements();for(const route of ['/[lang]/profilim','/[lang]/my-profile'])revalidatePath(route,'page');
 after(async()=>{const paths=announcementIndexNowPaths([item]);await Promise.all([notifyIndexNow(paths),purgeCdn([...paths,'/tr/duyurular/rss.xml','/en/announcements/rss.xml','/sitemaps/duyurular.xml']),cleanupViolations()]);});
 // Potential collaborators with the time that is left; the announcement is already published.
 let adaylar:PublishCandidate[]|null=null;
 try{
  const author=(await pool.query<{kisa_kimlik:string}>('SELECT kisa_kimlik FROM person WHERE id=$1::uuid',[personId])).rows[0]?.kisa_kimlik??null;
  if(author)adaylar=await withTimeout(announcementCandidates({text:item.text,keywords:review.anahtar_kelimeler,skills,author,lang,timeoutMs:Math.max(1500,deadline-Date.now())}),Math.max(2000,deadline-Date.now()));
 }catch(error){logServerError('announcement_candidates_failed',error);}
 return {durum:'yayinlandi',id:item.id,url:announcementPath(lang,item.id,item.text),baslik:announcementTitle(item.text),duzeltildi:published!==text,adaylar};
}
function withTimeout<T>(work:Promise<T>,ms:number):Promise<T>{return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('timeout')),ms);work.then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}

/** useActionState entry. Next.js control flow is rethrown; other errors become a safe alert. */
export async function publishWithAi(_state:PublishState,form:FormData):Promise<PublishState>{
 try{return await publishImpl(form);}
 catch(error){unstable_rethrow(error);return {durum:'hata',mesaj:actionErrorMessage(error,formLang(form),{action:'publishWithAi',report:failure=>after(()=>reportError(failure,{kind:'action',action:'publishWithAi'}))})};}
}
