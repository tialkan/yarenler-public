import 'server-only';
import {db} from './db';
let cached:{at:number;value:string|null}|null=null;
/**
 * When the site's data was last imported: the newest finished import run (veri_aktarimi, migration 0013),
 * before the first recorded run the newest AVESİS profile update. Cached for five minutes; null if unknown.
 */
export async function dataUpdatedAt():Promise<string|null>{
 if(cached&&Date.now()-cached.at<300000)return cached.value;
 try{const {rows}=await db().query(`SELECT coalesce((SELECT max(bitis) FROM veri_aktarimi WHERE bitis IS NOT NULL),(SELECT max(guncelleme) FROM person WHERE kaynak='avesis'))::text AS at`);cached={at:Date.now(),value:rows[0]?.at||null};}
 catch{return cached?.value??null;}
 return cached.value;
}
