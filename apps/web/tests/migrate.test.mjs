import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrate,parseMigration,pendingMigrations,versionOf,roleOf,LOCK_KEY} from '../scripts/migrate-lib.mjs';

const files={
 '0001_init.sql':'-- migrate:up\nCREATE TABLE a(id int);\n-- migrate:down\nDROP TABLE a;\n',
 '0002_more.sql':'-- migrate:up\nCREATE TABLE b(id int);\n\n-- migrate:down\nDROP TABLE b;\n',
};
/** Fake pg client: records statements, answers the lock probe and schema_migrations. */
function fakeClient({lockAfter=0,applied=[],failOn=null}={}){
 const calls=[];let probes=0;
 return {calls,query:async(text,values)=>{calls.push(text.trim().split('\n')[0]);
  if(text.startsWith('SELECT pg_try_advisory_xact_lock')){assert.deepEqual(values,[LOCK_KEY]);return {rows:[{locked:probes++>=lockAfter}]};}
  if(text.startsWith('SELECT version FROM schema_migrations'))return {rows:applied.map(version=>({version}))};
  if(failOn&&text.includes(failOn))throw Object.assign(new Error('relation already exists'),{code:'42P07'});
  return {rows:[]};}};
}
const read=async file=>files[file];

test('applies pending migrations in order, up sections only, inside one locked transaction',async()=>{
 const client=fakeClient();const log=[];
 const done=await migrate({client,files:['0002_more.sql','0001_init.sql','README.md'],read,log:e=>log.push(e)});
 assert.deepEqual(done,['0001_init.sql','0002_more.sql']);
 assert.equal(client.calls[0],'BEGIN');assert.match(client.calls[1],/pg_try_advisory_xact_lock/);
 const lockAt=client.calls.findIndex(c=>c.includes('advisory')),firstDdl=client.calls.indexOf('CREATE TABLE a(id int);');
 assert.ok(lockAt<client.calls.findIndex(c=>c.startsWith('SELECT version'))&&lockAt<firstDdl,'lock is taken before reading or changing the schema');
 assert.ok(client.calls.some(c=>/SET LOCAL lock_timeout/.test(c)));
 assert.ok(!client.calls.some(c=>/DROP TABLE/.test(c)),'down sections never run');
 assert.equal(client.calls.at(-1),'COMMIT');assert.equal(log.filter(e=>e.event==='migration_executed').length,2);
});
test('skips applied versions and commits without DDL when nothing is pending',async()=>{
 const client=fakeClient({applied:['0001','0002']});
 assert.deepEqual(await migrate({client,files:Object.keys(files),read}),[]);
 assert.ok(!client.calls.some(c=>c.startsWith('CREATE TABLE a')));assert.equal(client.calls.at(-1),'COMMIT');
});
test('waits while another instance holds the lock, then proceeds',async()=>{
 const client=fakeClient({lockAfter:2,applied:['0001','0002']});let slept=0;
 await migrate({client,files:Object.keys(files),read,sleep:async()=>{slept++;},pollMs:1});
 assert.equal(slept,2);assert.equal(client.calls.filter(c=>c.includes('advisory')).length,3);
});
test('gives up after the lock wait limit and rolls back',async()=>{
 const client=fakeClient({lockAfter:Infinity});let t=0;
 await assert.rejects(migrate({client,files:Object.keys(files),read,sleep:async()=>{t+=1000;},now:()=>t,lockWaitMs:3000}),/kilidi/);
 assert.equal(client.calls.at(-1),'ROLLBACK');assert.ok(!client.calls.some(c=>c.startsWith('CREATE TABLE a')));
});
test('a failing migration rolls everything back and rethrows',async()=>{
 const client=fakeClient({failOn:'CREATE TABLE b'});
 await assert.rejects(migrate({client,files:Object.keys(files),read}),{code:'42P07'});
 assert.equal(client.calls.at(-1),'ROLLBACK');assert.ok(!client.calls.includes('COMMIT'));
});
test('transaction:false migrations are refused at start',async()=>{
 const client=fakeClient();
 await assert.rejects(migrate({client,files:['0003_idx.sql'],read:async()=>'-- migrate:up transaction:false\nCREATE INDEX CONCURRENTLY x ON a(id);\n'}),/transaction:false/);
 assert.equal(client.calls.at(-1),'ROLLBACK');
});
test('parsing keeps only the up section and validates the format',()=>{
 assert.deepEqual(parseMigration('-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 2;','x'),{sql:'SELECT 1;',transaction:true});
 assert.equal(parseMigration('-- migrate:up\r\nSELECT 1;\r\n','x').sql,'SELECT 1;');
 assert.throws(()=>parseMigration('SELECT 1;','0009_x.sql'),/migrate:up/);
 assert.throws(()=>parseMigration('-- migrate:up\n\n-- migrate:down\nDROP TABLE a;','x'),/boş/);
});
test('versions follow dbmate (prefix before the first underscore) and duplicates are rejected',()=>{
 assert.equal(versionOf('0008_canonical_areas.sql'),'0008');assert.equal(versionOf('notes.sql'),null);
 assert.deepEqual(pendingMigrations(['0010_b.sql','0009_a.sql'],new Set(['0009'])),[{version:'0010',file:'0010_b.sql'}]);
 assert.throws(()=>pendingMigrations(['0009_a.sql','0009_b.sql'],new Set()),/iki dosyada/);
});
test('the role name is read from the connection URL without exposing the password',()=>{
 assert.equal(roleOf('postgres://yarenler_web:secret@db:5432/yarenler'),'yarenler_web');assert.equal(roleOf('not a url'),null);
});
test('every repository migration has an up section',async()=>{
 const {readdir,readFile}=await import('node:fs/promises');const dir=new URL('../../../db/migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql'))){const m=parseMigration(await readFile(new URL(file,dir),'utf8'),file);assert.ok(m.sql.length>0);assert.ok(!/^--\s*migrate:down/m.test(m.sql),file);assert.ok(m.transaction,file);}
});
