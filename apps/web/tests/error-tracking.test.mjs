import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDsn,dsnOrigin,buildEvent,envelope,createReporter,safePath} from '../src/server/error-tracking.ts';

const DSN='https://abc123@glitchtip.example.org/7';
test('DSN parsing supports GlitchTip and Sentry forms and rejects unsafe ones',()=>{
 assert.deepEqual(parseDsn(DSN),{publicKey:'abc123',origin:'https://glitchtip.example.org',projectId:'7',endpoint:'https://glitchtip.example.org/api/7/envelope/',publicDsn:'https://abc123@glitchtip.example.org/7'});
 assert.equal(parseDsn('https://key:secret@errors.example.org:8443/prefix/12').endpoint,'https://errors.example.org:8443/prefix/api/12/envelope/');
 assert.doesNotMatch(parseDsn('https://key:secret@errors.example.org/12').publicDsn,/secret/);
 for(const bad of [undefined,'','not a dsn','http://k@remote.example.org/1','https://glitchtip.example.org/7','https://k@glitchtip.example.org/abc'])assert.equal(parseDsn(bad),null,String(bad));
 assert.equal(parseDsn('http://k@localhost:8000/1').origin,'http://localhost:8000');
});
test('CSP origin exists only for a valid DSN',()=>{assert.equal(dsnOrigin(DSN),'https://glitchtip.example.org');assert.equal(dsnOrigin(undefined),null);assert.equal(dsnOrigin('garbage'),null);});
test('events carry no personal data: path without query, redacted message, no headers or user',()=>{
 const error=Object.assign(new Error('insert failed for ali@aybu.edu.tr 0000-0000-0000-1100'),{code:'42P08'});
 const event=buildEvent(error,{kind:'action',action:'publishAnnouncement',path:'/tr/profilim?token=abc&email=x@y.z',method:'POST'},{environment:'production',release:'abc1234',now:1000});
 const text=JSON.stringify(event);
 assert.doesNotMatch(text,/aybu\.edu\.tr|1825|token=|x@y\.z/);
 assert.equal(event.request.url,'/tr/profilim');assert.equal(event.tags.code,'42P08');assert.equal(event.tags.action,'publishAnnouncement');
 assert.equal(event.release,'abc1234');assert.equal(event.timestamp,1);assert.match(event.event_id,/^[0-9a-f]{32}$/);
 for(const key of ['user','contexts','breadcrumbs'])assert.ok(!(key in event));assert.ok(!('headers' in event.request)&&!('cookies' in event.request)&&!('query_string' in event.request));
 assert.ok(event.exception.values[0].stacktrace.frames.length>0);
 assert.equal(safePath('https://yarenler.org/tr/a/x?y=1#z'),'/tr/a/x');
});
test('the envelope has a header, an item header and the event',()=>{const lines=envelope(buildEvent(new Error('x'),{kind:'request'}),parseDsn(DSN)).trim().split('\n');assert.equal(lines.length,3);assert.equal(JSON.parse(lines[0]).dsn,'https://abc123@glitchtip.example.org/7');assert.deepEqual(JSON.parse(lines[1]),{type:'event'});});
test('without a DSN the reporter stays silent',async()=>{let calls=0;const report=createReporter({dsn:undefined,fetch:async()=>{calls++;}});assert.equal(await report(new Error('x'),{kind:'request'}),false);assert.equal(calls,0);});
test('with a DSN the reporter posts once per error, rate limited, and swallows network failures',async()=>{
 const posts=[];let t=0;const report=createReporter({dsn:DSN,fetch:async(url,init)=>{posts.push({url,init});},now:()=>t,perMinute:2});
 assert.equal(await report(new Error('a'),{kind:'request',route:'/x'}),true);
 assert.equal(posts[0].url,'https://glitchtip.example.org/api/7/envelope/');assert.match(posts[0].init.headers['X-Sentry-Auth'],/sentry_key=abc123/);assert.equal(posts[0].init.headers['Content-Type'],'application/x-sentry-envelope');assert.equal(posts[0].init.credentials,'omit');
 assert.equal(await report(new Error('a'),{kind:'request',route:'/x'}),false,'duplicate within the dedupe window');
 assert.equal(await report(new Error('b'),{kind:'request'}),true);assert.equal(await report(new Error('c'),{kind:'request'}),false,'per minute limit');
 t+=61000;assert.equal(await report(new Error('d'),{kind:'request'}),true);
 const failing=createReporter({dsn:DSN,fetch:async()=>{throw new Error('network down');}});assert.equal(await failing(new Error('x'),{kind:'request'}),false);
});
test('browser reports use query string auth and a simple content type',async()=>{const posts=[];const report=createReporter({dsn:DSN,platform:'javascript',fetch:async(url,init)=>{posts.push({url,init});}});await report(new Error('x'),{kind:'client',path:'/tr'});assert.match(posts[0].url,/\/api\/7\/envelope\/\?sentry_version=7&.*sentry_key=abc123$/);assert.equal(posts[0].init.headers['Content-Type'],'text/plain;charset=UTF-8');assert.ok(!('X-Sentry-Auth' in posts[0].init.headers));assert.equal(posts[0].init.keepalive,true);});
