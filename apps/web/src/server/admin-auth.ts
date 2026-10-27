import 'server-only';
import {Pool,type PoolClient} from 'pg';
import {cookies,headers} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {appOrigin} from './auth';
import {digest,randomToken,validSessionToken} from './auth-security';
import {UserError,logServerError} from './action-errors';
import {ADMIN_COOKIE,ADMIN_PATH,SESSION_ABSOLUTE_MS,SESSION_IDLE_MS,adminConfigLogged,afterFailure,clientIp,ipAllowed,keyedDigest,loginGate,sameUsername,sessionFingerprint,verifyAdminPassword,type AdminConfig,type AttemptRow} from './admin-security';

/**
 * Panel (/yonetici) authentication. One user, configured only through runtime variables:
 *   YONETICI_KULLANICI, YONETICI_SIFRE (plain, at least 16 characters) or YONETICI_SIFRE_HASH (scrypt digest,
 *   preferred; scripts/admin-hash.mjs), ADMIN_DATABASE_URL (restricted yarenler_admin role), optional ADMIN_ALLOWED_IPS.
 * Missing or invalid configuration: every panel address answers 404 (a warning is logged once when incomplete or weak).
 * The session cookie (__Host-) is independent of the ORCID session.
 * Sessions are random tokens; only their SHA-256 is stored (yonetici_oturum).
 */
export type AdminContext={username:string;ipDigest:string|null;config:AdminConfig};

const g=globalThis as unknown as {yarenlerAdminPool?:Pool};
export function adminDb(config:AdminConfig){
 if(!g.yarenlerAdminPool){g.yarenlerAdminPool=new Pool({connectionString:config.databaseUrl,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:20000});g.yarenlerAdminPool.on('error',()=>console.error(JSON.stringify({level:'error',event:'admin_db_pool_error'})));}
 return g.yarenlerAdminPool;
}
export function panelConfig(){return adminConfigLogged(process.env);}

async function requestIp(){const h=await headers();return clientIp(name=>h.get(name));}
const ipDigestOf=(config:AdminConfig,ip:string|null)=>ip?keyedDigest(config,'ip:'+ip):null;

/** Panel on and address allowed, otherwise 404 (same answer as an unknown address). */
async function gate(){const config=panelConfig();if(!config)notFound();const ip=await requestIp();if(!ipAllowed(config.allowedIps,ip))notFound();return {config,ip};}

/** The signed in panel user, or null. Every call extends the idle window (30 minutes), never the absolute end (8 hours). */
export async function currentAdmin():Promise<AdminContext|null>{
 const {config,ip}=await gate();
 const token=(await cookies()).get(ADMIN_COOKIE)?.value;if(!token||!validSessionToken(token))return null;
 const row=(await adminDb(config).query<{kullanici:string}>('UPDATE yonetici_oturum SET son_kullanim=now() WHERE belirtec_ozeti=$1::bytea AND parmak_izi=$2::text AND bitis>now() AND son_kullanim>now()-make_interval(secs => $3::int) RETURNING kullanici',[digest(token),sessionFingerprint(config),SESSION_IDLE_MS/1000])).rows[0];
 if(!row||!sameUsername(row.kullanici,config.username))return null;
 return {username:config.username,ipDigest:ipDigestOf(config,ip),config};
}
/** For pages: 404 when off, the login page without a session. */
export async function requireAdmin():Promise<AdminContext>{const admin=await currentAdmin();if(!admin)redirect(ADMIN_PATH+'/giris');return admin;}

/** For server actions: same origin, panel on, valid session. */
export async function adminAction():Promise<AdminContext>{
 if((await headers()).get('origin')!==appOrigin())throw new UserError('İstek kaynağı geçersiz.','Request origin is invalid.');
 const admin=await currentAdmin();if(!admin)throw new UserError('Oturum sona erdi. Lütfen yeniden giriş yapın.','The session has ended. Please sign in again.');
 return admin;
}

export type AuditEntry={islem:string;hedefTur:string;hedefId?:string|null;hedefAd?:string|null;once?:unknown;sonra?:unknown};
export async function writeAudit(client:Pool|PoolClient,admin:Pick<AdminContext,'username'|'ipDigest'>,entry:AuditEntry){
 await client.query('INSERT INTO yonetici_islem(kullanici,islem,hedef_tur,hedef_id,hedef_ad,once,sonra,ip_ozeti) VALUES($1::text,$2::text,$3::text,$4::text,$5::text,$6::jsonb,$7::jsonb,$8::text)',
  [admin.username,entry.islem,entry.hedefTur,entry.hedefId?String(entry.hedefId).slice(0,100):null,entry.hedefAd?String(entry.hedefAd).slice(0,300):null,entry.once===undefined?null:JSON.stringify(entry.once),entry.sonra===undefined?null:JSON.stringify(entry.sonra),admin.ipDigest]);
}
/** Runs a change and its audit row in one transaction. */
export async function inAdminTransaction<T>(admin:AdminContext,work:(client:PoolClient)=>Promise<{result:T;audit:AuditEntry}>):Promise<T>{
 const client=await adminDb(admin.config).connect();
 try{await client.query('BEGIN');const {result,audit}=await work(client);await writeAudit(client,admin,audit);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export type LoginResult={ok:true;token:string}|{ok:false;message:string};
/**
 * One login attempt. All attempts are serialized with an advisory lock, so parallel requests cannot
 * bypass the counters. Locked or too early: the password is not evaluated. The user name is compared
 * in constant time and the scrypt derivation always runs.
 */
export async function attemptLogin(usernameInput:string,password:string):Promise<LoginResult>{
 const {config,ip}=await gate();
 const username=usernameInput.slice(0,64),ipDigest=ipDigestOf(config,ip);
 const keys=['ip:'+keyedDigest(config,'ip:'+(ip||'bilinmiyor')),'kullanici:'+keyedDigest(config,'kullanici:'+username.normalize('NFC').toLocaleLowerCase('tr'))];
 const client=await adminDb(config).connect();let failures=0;
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('yarenler_yonetici_giris'))");
  const rows=(await client.query<AttemptRow&{anahtar:string}>('SELECT anahtar,hata_sayisi,son_hata,kilit_bitis,kilit_sayisi FROM yonetici_giris_denemesi WHERE anahtar=ANY($1::text[]) FOR UPDATE',[keys])).rows;
  const now=Date.now(),state=loginGate(rows,now);
  if(state.kind==='locked'){await client.query('COMMIT');return {ok:false,message:`Çok fazla hatalı deneme. Giriş ${new Date(state.until).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Istanbul'})} saatine kadar kapalı.`};}
  if(state.kind==='wait'){await client.query('COMMIT');return {ok:false,message:`Lütfen ${state.seconds} saniye bekleyip yeniden deneyin.`};}
  const nameOk=sameUsername(username,config.username),passwordOk=await verifyAdminPassword(password,config);
  if(nameOk&&passwordOk){
   await client.query('DELETE FROM yonetici_giris_denemesi WHERE anahtar=ANY($1::text[])',[keys]);
   await client.query('DELETE FROM yonetici_oturum WHERE bitis<=now() OR son_kullanim<=now()-make_interval(secs => $1::int)',[SESSION_IDLE_MS/1000]);
   const token=randomToken();
   await client.query("INSERT INTO yonetici_oturum(belirtec_ozeti,kullanici,parmak_izi,ip_ozeti,bitis) VALUES($1::bytea,$2::text,$3::text,$4::text,now()+make_interval(secs => $5::int))",[digest(token),config.username,sessionFingerprint(config),ipDigest,SESSION_ABSOLUTE_MS/1000]);
   await writeAudit(client,{username:config.username,ipDigest},{islem:'giris',hedefTur:'oturum'});
   await client.query('COMMIT');return {ok:true,token};
  }
  let locked=false,locks=0;
  for(const key of keys){
   const next=afterFailure(rows.find(r=>r.anahtar===key)||null,now);failures=Math.max(failures,next.hata_sayisi);if(next.kilit_bitis){locked=true;locks=Math.max(locks,next.kilit_sayisi);}
   await client.query('INSERT INTO yonetici_giris_denemesi(anahtar,hata_sayisi,son_hata,kilit_bitis,kilit_sayisi) VALUES($1::text,$2::int,$3::timestamptz,$4::timestamptz,$5::int) ON CONFLICT(anahtar) DO UPDATE SET hata_sayisi=excluded.hata_sayisi,son_hata=excluded.son_hata,kilit_bitis=excluded.kilit_bitis,kilit_sayisi=excluded.kilit_sayisi',[key,next.hata_sayisi,next.son_hata,next.kilit_bitis,next.kilit_sayisi]);
  }
  if(locked)await writeAudit(client,{username:config.username,ipDigest},{islem:'giris_kilidi',hedefTur:'oturum',sonra:{hata_sayisi:failures,kilit_sayisi:locks}});
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});logServerError('admin_login_failed',error);return {ok:false,message:'Giriş şu anda yapılamıyor. Lütfen biraz sonra yeniden deneyin.'};}
 finally{client.release();}
 // Growing delay on the answer itself (the counters above also block early retries).
 await sleep(Math.min(250*2**Math.max(0,failures-1),3000));
 return {ok:false,message:'Kullanıcı adı ya da şifre hatalı.'};
}

export async function setSessionCookie(token:string){(await cookies()).set(ADMIN_COOKIE,token,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:SESSION_ABSOLUTE_MS/1000});}
export async function endSession(admin:AdminContext){
 const store=await cookies(),token=store.get(ADMIN_COOKIE)?.value;
 if(token&&validSessionToken(token)){const pool=adminDb(admin.config);await pool.query('DELETE FROM yonetici_oturum WHERE belirtec_ozeti=$1::bytea',[digest(token)]);await writeAudit(pool,admin,{islem:'cikis',hedefTur:'oturum'});}
 store.set(ADMIN_COOKIE,'',{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:0});
}
