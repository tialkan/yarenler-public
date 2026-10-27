/**
 * Applies pending db/migrations ("up" only).
 *   node scripts/migrate.mjs             manual: MIGRATION_DATABASE_URL, otherwise DATABASE_URL
 *   node scripts/migrate.mjs --on-start  container start: only MIGRATION_DATABASE_URL; if it is
 *                                        missing the step is logged and skipped. Any failure exits 1
 *                                        so the new container never starts on a half-known schema.
 */
import pg from 'pg';
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {migrate,roleOf,RESTRICTED_ROLES} from './migrate-lib.mjs';
const onStart=process.argv.includes('--on-start');
const log=entry=>console.log(JSON.stringify({level:'info',time:new Date().toISOString(),...entry}));
const fail=(event,message)=>{console.error(JSON.stringify({level:'error',time:new Date().toISOString(),event,message}));process.exit(1);};
const url=process.env.MIGRATION_DATABASE_URL||(onStart?'':process.env.DATABASE_URL||'');
if(!url){
 if(onStart){log({level:'warn',event:'migrations_skipped',message:'MIGRATION_DATABASE_URL tanımlı değil; açılış göçleri atlandı. Şemayı elle güncel tutun.'});process.exit(0);}
 fail('migrations_not_configured','MIGRATION_DATABASE_URL ya da DATABASE_URL gerekli.');
}
const role=roleOf(url);
if(role&&RESTRICTED_ROLES.includes(role))fail('migrations_restricted_role',`Göç bağlantısı kısıtlı uygulama rolüyle (${role}) yapılandırılmış; tablo sahibi rolün adresi gerekli.`);
const directory=fileURLToPath(new URL('../../../db/migrations/',import.meta.url));
const client=new pg.Client({connectionString:url,application_name:'yarenler-migrate',connectionTimeoutMillis:15000});
try{
 await client.connect();
 const files=(await readdir(directory)).filter(file=>file.endsWith('.sql'));
 const applied=await migrate({client,files,read:file=>readFile(directory+file,'utf8'),log});
 log({event:'migrations_done',applied:applied.length,files:applied});
}catch(error){
 // Never print the connection string; pg errors carry no credentials.
 console.error(JSON.stringify({level:'error',time:new Date().toISOString(),event:'migrations_failed',rolled_back:true,message:error instanceof Error?error.message:String(error),code:error?.code||null}));
 process.exitCode=1;
}finally{await client.end().catch(()=>{});}
