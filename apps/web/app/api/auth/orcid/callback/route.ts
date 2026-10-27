import {NextRequest,NextResponse} from 'next/server';
import {appOrigin,orcidOrigin,authConfigured,authDb,randomToken,digest,equalState,stateName,sessionName,secureCookie} from '@/server/auth';
export async function GET(request:NextRequest){
 const [expected,language]=request.cookies.get(stateName)?.value.split('.')||[],lang=language==='en'?'en':'tr';
 const fail=(error:string)=>{const res=NextResponse.redirect(new URL(`/${lang}/${lang==='tr'?'giris':'sign-in'}?error=${error}`,appOrigin()));res.cookies.set(stateName,'',{...secureCookie,maxAge:0});res.headers.set('Cache-Control','no-store');return res;};
 const state=request.nextUrl.searchParams.get('state')||'',code=request.nextUrl.searchParams.get('code');
 if(!authConfigured())return fail('configuration');if(!expected||!state||!equalState(expected,state))return fail('state');if(request.nextUrl.searchParams.has('error'))return fail('cancelled');if(!code||code.length>2048)return fail('code');
 try{
  const tokenResponse=await fetch(orcidOrigin()+'/oauth/token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.ORCID_CLIENT_ID!,client_secret:process.env.ORCID_CLIENT_SECRET!,grant_type:'authorization_code',code,redirect_uri:appOrigin()+'/api/auth/orcid/callback'}),signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!tokenResponse.ok)return fail('provider');const identity=await tokenResponse.json();if(typeof identity.orcid!=='string'||!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(identity.orcid)||typeof identity.access_token!=='string')return fail('identity');
  // The ORCID token response authenticates identity. Never link accounts by name.
  const pool=authDb(),token=randomToken(),name=typeof identity.name==='string'?identity.name.slice(0,250):identity.orcid;
  // Platform ban (migration 0016): the ORCID iD may not sign in or register again.
  if((await pool.query<{b:boolean}>('SELECT yarenler_orcid_yasakli($1::text) AS b',[identity.orcid])).rows[0]?.b)return fail('banned');
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM orcid_session WHERE bitis<now()');const found=await client.query('SELECT id FROM person WHERE orcid=$1 AND aktif=true',[identity.orcid]);const personId=found.rows[0]?.id||null;
   if(personId)await client.query('UPDATE person SET sahiplenildi=true,sahiplenme_tarihi=COALESCE(sahiplenme_tarihi,now()),guncelleme=now() WHERE id=$1',[personId]);
   await client.query("INSERT INTO orcid_session(orcid,gorunen_ad,person_id,belirtec_ozeti,bitis) VALUES($1,$2,$3,$4,now()+interval '7 days')",[identity.orcid,name,personId,digest(token)]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  const response=NextResponse.redirect(new URL(`/${lang}/${lang==='tr'?'profilim':'my-profile'}`,appOrigin()));response.cookies.set(sessionName,token,{...secureCookie,maxAge:7*86400});response.cookies.set(stateName,'',{...secureCookie,maxAge:0});response.headers.set('Cache-Control','no-store');return response;
 }catch{console.error('ORCID kimlik doğrulama işlemi tamamlanamadı');return fail('provider');}
}
