import 'server-only';
import {headers} from 'next/headers';
import {UserError} from './action-errors';
import {appOrigin,authDb,sessionWithBan,type Session} from './auth';
import {MESSAGES,banMessage,platformMessage,type BanInfo,type PlatformBan} from './announcement-moderation';
import {AREA_RESTRICTED} from './area-intake';

/**
 * The single access check of member server actions and APIs (migration 0016). Every action that changes
 * something calls requireMember first:
 *  - all scopes: same-origin request, signed-in ORCID session, no platform ban (person or ORCID level; the polite
 *    notice names the end date). The ban also deletes sessions and the ORCID callback refuses sign-in.
 *  - 'profil' and 'sil': a linked profile (profile editing, own announcement and profile removal);
 *  - 'kayit': registration and reactivation (no profile yet; the claimed profile is checked by the caller);
 *  - 'duyuru': plus no announcement ban and no panel restriction (the database repeats this: YA021, YA022, YA005);
 *  - 'alan': plus no announcement ban and no panel restriction on new fields (YA004).
 */
export type Scope='profil'|'sil'|'kayit'|'duyuru'|'alan';
export type MemberAccess={session:Session;personId:string|null};
type Gate={platform:PlatformBan|null;yasak:BanInfo|null;kisitli:boolean;kisitli_alan:boolean};
const banned=(ban:PlatformBan)=>new UserError(platformMessage(ban,'tr'),platformMessage(ban,'en'));

export async function memberAccess(scope:Scope,o:{checkOrigin?:boolean}={}):Promise<MemberAccess>{
 if(o.checkOrigin!==false&&(await headers()).get('origin')!==appOrigin())throw new UserError('İstek kaynağı geçersiz.','Request origin is invalid.');
 const row=await sessionWithBan();
 if(!row)throw new UserError('Oturum gerekli. Lütfen ORCID ile giriş yapın.','Please sign in with ORCID.');
 if(row.yasak)throw banned(row.yasak);
 const {yasak:_ban,...session}=row;
 if(scope==='kayit')return {session,personId:session.person_id};
 if(!session.person_id)throw new UserError('Bu işlem için önce profilinizi oluşturun.','Please create your profile first.');
 if(scope==='duyuru'||scope==='alan'){
  const g=(await authDb().query<{d:Gate}>('SELECT yarenler_duyuru_durumu($1::uuid) AS d',[session.person_id])).rows[0].d;
  if(g.platform)throw banned(g.platform);
  if(g.yasak)throw new UserError(banMessage(g.yasak,'tr'),banMessage(g.yasak,'en'));
  if(scope==='duyuru'&&g.kisitli)throw new UserError(MESSAGES.restricted.tr,MESSAGES.restricted.en);
  if(scope==='alan'&&g.kisitli_alan)throw new UserError(AREA_RESTRICTED.tr,AREA_RESTRICTED.en);
 }
 return {session,personId:session.person_id};
}
/** requireMember for actions that need the linked profile id. */
export async function requireMember(scope:Exclude<Scope,'kayit'>,o?:{checkOrigin?:boolean}){const a=await memberAccess(scope,o);return {session:a.session,personId:a.personId!};}
