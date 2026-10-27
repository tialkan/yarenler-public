import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UserError,actionErrorMessage,GENERIC_ERROR,formLang,logServerError} from '../src/server/action-errors.ts';
import {redact,describeError} from '../src/server/redact.ts';
import {clampAnnouncement,textLength,ANNOUNCEMENT_MAX} from '../src/server/announcement-limits.ts';
const pgError=(code,message,detail)=>Object.assign(new Error(message),{code,detail});

test('user errors are shown in the form language and not logged',()=>{
 const lines=[];const error=new UserError('Oturum gerekli.','Please sign in with ORCID.');
 assert.equal(actionErrorMessage(error,'tr',{log:l=>lines.push(l)}),'Oturum gerekli.');
 assert.equal(actionErrorMessage(error,'en',{log:l=>lines.push(l)}),'Please sign in with ORCID.');
 assert.equal(lines.length,0);
});
test('unexpected database errors show a generic message and log a structured line without details',()=>{
 const lines=[],reported=[];
 const error=pgError('42P08','inconsistent types deduced for parameter $3','Key (orcid)=(0000-0000-0000-1100) already exists.');
 const message=actionErrorMessage(error,'tr',{action:'publishAnnouncement',log:l=>lines.push(l),report:e=>reported.push(e)});
 assert.equal(message,GENERIC_ERROR.tr);assert.doesNotMatch(message,/parameter|42P08/);
 assert.equal(lines.length,1);const entry=JSON.parse(lines[0]);
 assert.equal(entry.level,'error');assert.equal(entry.event,'server_action_failed');assert.equal(entry.action,'publishAnnouncement');assert.equal(entry.error.code,'42P08');
 assert.doesNotMatch(lines[0],/0000-0000-0000-1100/);assert.equal(reported[0],error);
 assert.equal(actionErrorMessage(new Error('boom'),'en',{log:()=>{}}),GENERIC_ERROR.en);
});
test('known constraint violations map to safe messages',()=>{
 assert.equal(actionErrorMessage(pgError('23505','duplicate key value violates unique constraint "person_orcid_key"'),'tr',{log:()=>{}}),'Bu kayıt zaten var.');
 assert.match(actionErrorMessage(pgError('23514','new row violates check constraint'),'en',{log:()=>{}}),/does not meet the rules/);
});
test('a failing reporter never changes the response',()=>{assert.equal(actionErrorMessage(new Error('x'),'tr',{log:()=>{},report:()=>{throw new Error('down');}}),GENERIC_ERROR.tr);});
test('form language falls back to Turkish',()=>{const f=new FormData();assert.equal(formLang(f),'tr');f.set('lang','en');assert.equal(formLang(f),'en');});
test('redaction removes e-mail, ORCID, credentials and tokens',()=>{
 const out=redact('mail ali.veli@aybu.edu.tr orcid 0000-0000-0000-1120 postgres://web:s3cret@db:5432/x Bearer abc.def token '+'a'.repeat(48)+' '+'f'.repeat(64));
 assert.doesNotMatch(out,/aybu\.edu\.tr|1825|s3cret|abc\.def|aaaa|ffff/);assert.match(out,/\[email\].*\[orcid\].*\[credentials\]@db/);
 assert.equal(redact('x'.repeat(10),5),'xxxxx…');
 const d=describeError(Object.assign(new Error('fail for ali@x.org'),{code:'XX000',digest:'123'}));assert.equal(d.code,'XX000');assert.equal(d.digest,'123');assert.match(d.message,/\[email\]/);
 assert.equal(describeError('plain').message,'plain');
});
test('logServerError writes one JSON line with context',()=>{let line='';logServerError('route_failed',new Error('no'),{route:'/api/x'},l=>{line=l;});const e=JSON.parse(line);assert.equal(e.route,'/api/x');assert.equal(e.error.message,'no');});
test('announcement text counts characters like PostgreSQL and is clamped to 5000',()=>{
 assert.equal(textLength('çğ😀'),3);
 const long=('Bu bir cümledir. ').repeat(400);const out=clampAnnouncement(long);
 assert.ok(textLength(out)<=ANNOUNCEMENT_MAX);assert.match(out,/\.$/);
 assert.equal(clampAnnouncement('  kısa metin  '),'kısa metin');
 assert.ok(textLength(clampAnnouncement('x'.repeat(6000)))===ANNOUNCEMENT_MAX);
});
