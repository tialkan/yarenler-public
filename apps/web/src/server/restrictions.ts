import 'server-only';
import {authDb} from './auth';
/**
 * Panel restriction of an account (migration 0014, kisi_kisitlamasi): adding new fields ('alan') or
 * publishing announcements ('duyuru'). The database enforces the same rule (YA004, YA005); this check
 * only answers early, before any AI call.
 */
export async function restricted(personId:string,kind:'alan'|'duyuru'){
 return Boolean((await authDb().query<{k:boolean}>('SELECT yarenler_kisitli($1::uuid,$2::text) AS k',[personId,kind])).rows[0]?.k);
}
