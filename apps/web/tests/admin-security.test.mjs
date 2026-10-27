import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,parseHash} from '../scripts/admin-hash-lib.mjs';
import {cacheControl,responseHeaders,isPanel} from '../scripts/front-server.mjs';
import {RESTRICTED_ROLES} from '../scripts/migrate-lib.mjs';
import {adminConfig,readAdminConfig,verifyAdminPassword,adminAreaName,clientIp,ipAllowed,loginGate,afterFailure,waitSeconds,lockDuration,sessionValid,sessionFingerprint,keyedDigest,sameUsername,isAdminPath,ADMIN_COOKIE,LOCK_AFTER,LOCK_MS,LOCK_MAX_MS,SESSION_IDLE_MS,SESSION_ABSOLUTE_MS} from '../src/server/admin-security.ts';

const fast={ln:14,r:8,p:1};
test('password digest: scrypt format without "$", verifies, rejects other passwords and plain values',async()=>{
 const hash=await hashPassword('doğru-at-pil-zımba',fast);
 assert.match(hash,/^scrypt:14:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/);assert.ok(!hash.includes('$'));
 assert.equal(await verifyPassword('doğru-at-pil-zımba',hash),true);
 assert.equal(await verifyPassword('doğru-at-pil-zımbA',hash),false);
 assert.equal(await verifyPassword('doğru-at-pil-zımba','doğru-at-pil-zımba'),false,'a plain password is never a valid digest');
 assert.equal(parseHash('scrypt:30:8:1:'+'A'.repeat(22)+':'+'B'.repeat(43)),null,'cost out of bounds');
 await assert.rejects(hashPassword('on-bes-karakter'),/en az 16/);
 const defaults=await hashPassword('yeterince-uzun-sifre');assert.match(defaults,/^scrypt:15:8:3:/);
});
test('configuration: nothing set is 404 without a warning; plain password under 16 characters stays closed with a warning; the digest is preferred',async()=>{
 const hash=await hashPassword('yeterince-uzun-sifre',fast),db='postgres://x';
 assert.deepEqual(readAdminConfig({}),{config:null,warning:null});
 const short=readAdminConfig({YONETICI_KULLANICI:'y',YONETICI_SIFRE:'on-bes-karakter',ADMIN_DATABASE_URL:db});
 assert.equal(short.config,null);assert.match(short.warning,/16 karakterden kısa/);assert.ok(!short.warning.includes('on-bes-karakter'),'the warning never contains the password');
 assert.equal(adminConfig({YONETICI_KULLANICI:'y',YONETICI_SIFRE:'ğ'.repeat(15),ADMIN_DATABASE_URL:db}),null,'characters are counted, not bytes');
 assert.match(readAdminConfig({YONETICI_KULLANICI:'y',YONETICI_SIFRE:'onalti-karakterli',}).warning,/ADMIN_DATABASE_URL/);
 assert.match(readAdminConfig({YONETICI_SIFRE:'onalti-karakterli',ADMIN_DATABASE_URL:db}).warning,/YONETICI_KULLANICI/);
 assert.match(readAdminConfig({YONETICI_KULLANICI:'y',YONETICI_SIFRE_HASH:'duz-sifre-olmaz',YONETICI_SIFRE:'onalti-karakterli',ADMIN_DATABASE_URL:db}).warning,/geçerli bir scrypt/,'an invalid digest closes the panel, it never falls back');
 const plain=adminConfig({YONETICI_KULLANICI:' yonetici ',YONETICI_SIFRE:'onalti-karakterli',ADMIN_DATABASE_URL:db});
 assert.equal(plain.username,'yonetici');assert.equal(plain.secret.kind,'plain');assert.match(plain.secretId,/^plain:[0-9a-f]{64}$/);assert.ok(!plain.secretId.includes('onalti'));
 const hashed=adminConfig({YONETICI_KULLANICI:'yonetici',YONETICI_SIFRE:'baska-bir-duz-sifre',YONETICI_SIFRE_HASH:hash,ADMIN_DATABASE_URL:db,ADMIN_ALLOWED_IPS:' 203.0.113.7 '});
 assert.deepEqual({kind:hashed.secret.kind,id:hashed.secretId,ips:hashed.allowedIps},{kind:'hash',id:hash,ips:'203.0.113.7'});
 assert.equal(await verifyAdminPassword('yeterince-uzun-sifre',hashed),true);
 assert.equal(await verifyAdminPassword('baska-bir-duz-sifre',hashed),false,'with a digest the plain variable is ignored');
 assert.equal(await verifyAdminPassword('onalti-karakterli',plain),true);
 assert.equal(await verifyAdminPassword('onalti-karakterlİ',plain),false);
 assert.equal(await verifyAdminPassword('',plain),false);
});
test('session cookie: __Host- prefix, 8 hours, separate from the ORCID session',async()=>{
 assert.equal(ADMIN_COOKIE,'__Host-yarenler-yonetici');assert.equal(SESSION_ABSOLUTE_MS,8*3600e3);
 const {readFile}=await import('node:fs/promises');const auth=await readFile(new URL('../src/server/auth.ts',import.meta.url),'utf8');
 assert.ok(auth.includes("sessionName='__Host-yarenler-session'")&&!auth.includes(ADMIN_COOKIE),'the ORCID session uses its own cookie');
});
test('client address and the optional allow list (IPv4, IPv6, CIDR)',()=>{
 const h=o=>name=>o[name];
 // CF-Connecting-IP counts only when the peer is Cloudflare (client-ip.ts); otherwise the peer address.
 assert.equal(clientIp(h({'cf-connecting-ip':'203.0.113.7','x-forwarded-for':'172.64.1.1'})),'203.0.113.7');
 assert.equal(clientIp(h({'cf-connecting-ip':'203.0.113.7','x-forwarded-for':'10.0.0.1'})),'10.0.0.1');
 assert.equal(clientIp(h({'x-forwarded-for':'198.51.100.2, 10.0.0.1'})),'10.0.0.1');
 assert.equal(clientIp(h({'cf-connecting-ip':'not-an-ip'})),null);
 assert.equal(ipAllowed(null,'1.2.3.4'),true);
 assert.equal(ipAllowed('203.0.113.7, 2001:db8::/48','203.0.113.7'),true);
 assert.equal(ipAllowed('203.0.113.7, 2001:db8::/48','2001:db8:0:1::5'),true);
 assert.equal(ipAllowed('203.0.113.0/24','203.0.114.1'),false);
 assert.equal(ipAllowed('203.0.113.7',null),false);
 assert.equal(ipAllowed('bozuk, 999.1.1.1','1.2.3.4'),false,'a list without a valid entry closes the panel');
});
test('brute force: lock after 5 failures for 15 minutes, short waits before, longer locks when it repeats',()=>{
 const t=Date.parse('2026-10-24T10:00:00Z');
 assert.equal(LOCK_AFTER,5);assert.equal(LOCK_MS,15*60e3);
 assert.deepEqual([1,2,3,4].map(waitSeconds),[0,0,1,2]);
 assert.deepEqual([1,2,3,4,10].map(lockDuration),[LOCK_MS,2*LOCK_MS,4*LOCK_MS,8*LOCK_MS,LOCK_MAX_MS]);
 let row=null;for(let i=0;i<LOCK_AFTER-1;i++){row=afterFailure(row,t);assert.equal(row.kilit_bitis,null);}
 assert.equal(row.hata_sayisi,4);
 assert.deepEqual(loginGate([row],t+500),{kind:'wait',seconds:2});
 assert.deepEqual(loginGate([row],t+2000),{kind:'ok'});
 row=afterFailure(row,t+2000);assert.equal(row.hata_sayisi,5);assert.equal(row.kilit_sayisi,1);assert.equal(row.kilit_bitis.getTime(),t+2000+LOCK_MS);
 assert.equal(loginGate([row],t+60000).kind,'locked');
 assert.deepEqual(loginGate([{hata_sayisi:0,son_hata:null,kilit_bitis:null},row],t+60000),{kind:'locked',until:t+2000+LOCK_MS},'either the IP or the user name counter locks');
 const after=t+2000+LOCK_MS+1;assert.deepEqual(loginGate([row],after),{kind:'ok'});
 let next=afterFailure(row,after);assert.equal(next.hata_sayisi,1,'a new round after the lock');assert.equal(next.kilit_sayisi,1,'the earlier lock is remembered');
 for(let i=0;i<LOCK_AFTER-1;i++)next=afterFailure(next,after+i*5000);
 assert.equal(next.kilit_sayisi,2);assert.equal(next.kilit_bitis.getTime()-(after+(LOCK_AFTER-2)*5000),2*LOCK_MS,'the second lock lasts twice as long');
 assert.equal(afterFailure({...next,kilit_bitis:new Date(t)},t+3*86400e3).kilit_sayisi,0,'locks older than a day are forgotten');
 assert.equal(afterFailure({hata_sayisi:4,son_hata:new Date(t),kilit_bitis:null},t+2*3600*1000).hata_sayisi,1,'old failures are forgotten');
});
test('sessions: 8 hour absolute end, 30 minute idle, invalid after the digest or user name changes',()=>{
 const now=Date.parse('2026-10-24T12:00:00Z'),fp=sessionFingerprint({username:'y',secretId:'scrypt:a'});
 const row={bitis:new Date(now+3600e3),son_kullanim:new Date(now-60e3),parmak_izi:fp};
 assert.equal(sessionValid(row,now,fp),true);
 assert.equal(sessionValid({...row,son_kullanim:new Date(now-SESSION_IDLE_MS)},now,fp),false);
 assert.equal(sessionValid({...row,bitis:new Date(now)},now,fp),false);
 assert.equal(sessionValid(row,now,sessionFingerprint({username:'y',secretId:'scrypt:b'})),false);
 assert.equal(sessionValid(row,now,sessionFingerprint({username:'z',secretId:'scrypt:a'})),false);
 assert.match(keyedDigest({secretId:'scrypt:a'},'ip:1.2.3.4'),/^[0-9a-f]{64}$/);
 assert.notEqual(keyedDigest({secretId:'scrypt:a'},'ip:1.2.3.4'),keyedDigest({secretId:'scrypt:b'},'ip:1.2.3.4'));
 assert.equal(sameUsername('yonetici','yonetici'),true);assert.equal(sameUsername('yonetic','yonetici'),false);
});
test('panel responses are outside the public cache (ADR 0007) and never indexed',()=>{
 for(const p of ['/yonetici','/yonetici/alanlar','/yonetici/giris'])assert.ok(isAdminPath(p)&&isPanel(p));
 for(const p of ['/yoneticiler','/tr/yonetici-x','/tr'])assert.ok(!isAdminPath(p)&&!isPanel(p));
 // Even an ISR style header or a 404 from the panel path is never stored.
 assert.equal(cacheControl('s-maxage=3600, stale-while-revalidate=31532400',200,'/yonetici'),'no-store');
 assert.equal(cacheControl('s-maxage=300, stale-while-revalidate=10',404,'/yonetici/alanlar'),'no-store');
 assert.equal(cacheControl(undefined,200,'/yonetici/giris'),'no-store');
 const out=responseHeaders({statusCode:200,headers:{'cache-control':'public, s-maxage=60','cdn-cache-control':'max-age=60'}},'/yonetici');
 assert.equal(out['cache-control'],'no-store');assert.equal(out['x-robots-tag'],'noindex, nofollow');assert.equal(out['cdn-cache-control'],undefined);
 assert.equal(responseHeaders({statusCode:200,headers:{}},'/tr')['x-robots-tag'],undefined);
});
test('the panel role cannot run migrations',()=>{assert.ok(RESTRICTED_ROLES.includes('yarenler_admin'));});
test('robots.txt does not name the panel (no path disclosure) and the sitemap never lists it',async()=>{
 const {default:robots}=await import('../app/robots.ts');
 const previous=process.env.INDEXABLE;process.env.INDEXABLE='true';
 try{assert.ok(!JSON.stringify(robots()).includes('yonetici'));}finally{if(previous===undefined)delete process.env.INDEXABLE;else process.env.INDEXABLE=previous;}
 const {readFile}=await import('node:fs/promises');
 assert.ok(!(await readFile(new URL('../src/server/sitemap.ts',import.meta.url),'utf8')).includes('yonetici'));
 const {routeRequest}=await import('../src/server/routing.ts');
 assert.deepEqual(routeRequest('/yonetici/alanlar',new URLSearchParams('page=2')),{kind:'next'},'no ISR rewrite for panel addresses');
});
test('field names typed in the panel: spaces, Turkish capital, heading case',()=>{
 assert.equal(adminAreaName('  ilaç   tasarımı ve  sentezi ','tr'),'İlaç tasarımı ve sentezi');
 assert.equal(adminAreaName('Ağız, Diş Ve Çene Cerrahisi','tr'),'Ağız, Diş ve Çene Cerrahisi');
 assert.equal(adminAreaName('information Retrieval And Search','en'),'Information Retrieval and Search');
 assert.equal(adminAreaName('ısı transferi','tr'),'Isı transferi');
 assert.equal(adminAreaName('a\u0000b\tc','tr'),'A b c');
 assert.equal(adminAreaName('   ','tr'),'');
 assert.equal(adminAreaName('Çevre Mühendisliği'.normalize('NFD'),'tr'),'Çevre Mühendisliği','NFC');
});
