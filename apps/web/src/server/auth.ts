import 'server-only';
import {Pool} from 'pg';
import {cookies} from 'next/headers';
import {digest,validSessionToken} from './auth-security';
export {randomToken,digest,equalState} from './auth-security';
const globalAuth=globalThis as unknown as {authPool?:Pool};
export function authDb(){if(!process.env.AUTH_DATABASE_URL)throw new Error('Kimlik veritabanı yapılandırılmadı');return globalAuth.authPool??=new Pool({connectionString:process.env.AUTH_DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:8000});}
export function authConfigured(){return Boolean(process.env.ORCID_CLIENT_ID&&process.env.ORCID_CLIENT_SECRET&&process.env.AUTH_DATABASE_URL);}
export const sessionName='__Host-yarenler-session',stateName='__Host-yarenler-oauth';
export const secureCookie={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/'};
export function appOrigin(){const url=new URL(process.env.PUBLIC_BASE_URL||'https://yarenler.org');if(url.protocol!=='https:'||url.hostname!=='yarenler.org')throw new Error('Geçersiz kimlik dönüş adresi');return url.origin;}
export function orcidOrigin(){return process.env.ORCID_ENV==='sandbox'?'https://sandbox.orcid.org':'https://orcid.org';}
export type Session={id:string;orcid:string;gorunen_ad:string;person_id:string|null};
/** The signed-in session with its platform ban state (migration 0016), or null. Use access.ts in actions. */
export async function sessionWithBan():Promise<(Session&{yasak:{bitis:string|null}|null})|null>{const token=(await cookies()).get(sessionName)?.value;if(!token||!validSessionToken(token))return null;const result=await authDb().query<Session&{yasak:{bitis:string|null}|null}>('SELECT id,orcid,gorunen_ad,person_id,yarenler_platform_yasagi(person_id,orcid) AS yasak FROM orcid_session WHERE belirtec_ozeti=$1::bytea AND bitis>now()',[digest(token)]);return result.rows[0]||null;}
/** The signed-in session; a platform banned account has none (its sessions are also deleted by the ban). */
export async function currentSession():Promise<Session|null>{const row=await sessionWithBan();if(!row||row.yasak)return null;const {yasak:_ban,...session}=row;return session;}
