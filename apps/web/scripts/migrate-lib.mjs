/**
 * dbmate compatible migration runner (schema_migrations.version = file name prefix).
 * Only the "-- migrate:up" section runs; "-- migrate:down" is never executed here.
 * All pending migrations run in one transaction under a transaction-level advisory lock,
 * so parallel starts wait for each other and a failure leaves the schema unchanged.
 */
export const LOCK_KEY='yarenler_migrations';
/** Roles the application runs with; they cannot (and must not) run DDL. */
export const RESTRICTED_ROLES=['yarenler_web','yarenler_auth','yarenler_indexer','yarenler_maintenance','yarenler_admin'];

export function versionOf(file){const match=/^(\d+)_[^/]*\.sql$/.exec(file);return match?match[1]:null;}

export function parseMigration(text,file){
 const lines=text.split(/\r?\n/);const start=lines.findIndex(line=>/^--\s*migrate:up\b/.test(line));
 if(start<0)throw new Error(`Göç biçimi geçersiz, "-- migrate:up" yok: ${file}`);
 const options=lines[start].replace(/^--\s*migrate:up/,'').trim();
 const end=lines.findIndex((line,i)=>i>start&&/^--\s*migrate:down\b/.test(line));
 const sql=lines.slice(start+1,end<0?undefined:end).join('\n').trim();
 if(!sql)throw new Error(`Göçün up bölümü boş: ${file}`);
 return {sql,transaction:!/\btransaction:false\b/.test(options)};
}

export function pendingMigrations(files,applied){
 const seen=new Map();
 for(const file of files){const version=versionOf(file);if(!version)continue;if(seen.has(version))throw new Error(`Aynı göç sürümü iki dosyada: ${seen.get(version)}, ${file}`);seen.set(version,file);}
 return [...seen].sort(([a],[b])=>a<b?-1:a>b?1:0).filter(([version])=>!applied.has(version)).map(([version,file])=>({version,file}));
}

export function roleOf(url){try{return decodeURIComponent(new URL(url).username)||null;}catch{return null;}}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/**
 * client: a connected pg client (query(text, values) -> {rows}). read(file) -> SQL text.
 * Returns the applied file names. Throws (after ROLLBACK) on any failure.
 */
export async function migrate({client,files,read,log=()=>{},lockKey=LOCK_KEY,lockWaitMs=120000,pollMs=1000,sleep=wait,now=Date.now,lockTimeout='15s'}){
 await client.query('BEGIN');
 try{
  const deadline=now()+lockWaitMs;
  for(;;){
   const {rows}=await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1::text)) AS locked',[lockKey]);
   if(rows[0]?.locked)break;
   if(now()>=deadline)throw new Error(`Göç kilidi ${Math.round(lockWaitMs/1000)} saniyede alınamadı; başka bir göç sürüyor olabilir.`);
   log({event:'migration_lock_wait'});await sleep(pollMs);
  }
  // Do not queue behind long-running queries of the live app forever.
  await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(128) PRIMARY KEY)');
  const applied=new Set((await client.query('SELECT version FROM schema_migrations')).rows.map(row=>String(row.version)));
  const pending=pendingMigrations(files,applied),done=[];
  for(const {version,file} of pending){
   const {sql,transaction}=parseMigration(await read(file),file);
   if(!transaction)throw new Error(`"transaction:false" göçleri açılışta çalıştırılmaz, elle uygulayın: ${file}`);
   await client.query(sql);
   await client.query('INSERT INTO schema_migrations(version) VALUES($1::varchar)',[version]);
   done.push(file);log({event:'migration_executed',file});
  }
  await client.query('COMMIT');
  return done;
 }catch(error){
  try{await client.query('ROLLBACK');}catch{/* the original error matters */}
  throw error;
 }
}
