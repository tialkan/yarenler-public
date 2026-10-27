import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isFrameworkScript,inlineScripts,scriptHashes,buildCsp,cspForHtml,sha256,dsnOrigin} from '../scripts/csp-lib.mjs';
import {cacheControl} from '../scripts/front-server.mjs';
const boot='(self.__next_f=self.__next_f||[]).push([0])';
const flight='self.__next_f.push([1,"1:\\"$Sreact.fragment\\"\\n2:I[1,[],\\"default\\"]\\n\\u003c/script\\u003e"])';
const turbopack='(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":["static/chunks/3gb74wfetd4kx.js"],"runtimeModuleIds":[94553]});';
test('framework inline scripts are recognised',()=>{
 for(const code of [boot,flight,boot+';self.__next_f.push([2,null])','self.__next_f.push([3,"QUJD"])',turbopack])assert.equal(isFrameworkScript(code),true,code);
});
test('anything else is rejected, including code smuggled around a valid payload',()=>{
 for(const code of ['alert(1)','self.__next_f.push([1,"a"]);alert(1)','self.__next_f.push([1,"a"]);alert(1);self.__next_f.push([1,"b"])','self.__next_f.push(alert(1))','self.__next_f.push({"a":1})','self.__next_f.push([1,"a"],alert(1))',boot+';alert(1)','(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":["https://evil.example/x.js"]});','(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":[],"x":alert(1)});'])assert.equal(isFrameworkScript(code),false,code);
});
test('only executable inline scripts are hashed; external and JSON-LD scripts are skipped',()=>{
 const html=`<head><script src="/_next/static/chunks/a.js" async=""></script><script type="application/ld+json">{"@type":"WebSite"}</script></head><body><script>${boot}</script><script>${flight}</script><script id="_R_">${turbopack}</script><script>alert(1)</script></body>`;
 assert.deepEqual(inlineScripts(html),[boot,flight,turbopack,'alert(1)']);
 const {hashes,rejected}=scriptHashes(html);
 assert.equal(rejected,1);assert.deepEqual(hashes,[sha256(boot),sha256(flight),sha256(turbopack)]);
 const csp=cspForHtml(html);
 assert.ok(csp.includes(`'${sha256(flight)}'`));assert.ok(!csp.includes(sha256('alert(1)')));
});
test('production policy: no unsafe-inline/unsafe-eval in script-src, no nonce, strict defaults',()=>{
 const csp=buildCsp({hashes:['sha256-abc'],reportOrigin:'https://hata.yarenler.org'});
 const script=csp.split('; ').find(d=>d.startsWith('script-src'));
 assert.equal(script,"script-src 'self' 'sha256-abc'");
 assert.ok(!csp.includes('nonce-'));assert.ok(csp.includes("object-src 'none'"));assert.ok(csp.includes("frame-ancestors 'none'"));assert.ok(csp.includes("base-uri 'self'"));
 assert.ok(csp.includes("connect-src 'self' https://hata.yarenler.org"));
 assert.match(buildCsp({dev:true}),/'unsafe-eval'/);
 assert.equal(dsnOrigin('https://key@hata.yarenler.org/3'),'https://hata.yarenler.org');assert.equal(dsnOrigin('http://key@evil.example/3'),null);
});
test('CDN cache headers: ISR pages become public with a bounded stale window; API never stored',()=>{
 assert.equal(cacheControl('s-maxage=3600, stale-while-revalidate=31532400',200,'/tr/alan/x'),'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
 assert.equal(cacheControl('s-maxage=300, stale-while-revalidate=31535700',404,'/tr/a/x'),'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
 assert.equal(cacheControl('s-maxage=3600, stale-while-revalidate=10',404,'/tr/x'),'public, max-age=0, s-maxage=300, stale-while-revalidate=10');
 assert.equal(cacheControl('private, no-cache, no-store, max-age=0, must-revalidate',200,'/tr/profilim'),'no-store');
 assert.equal(cacheControl(undefined,200,'/api/suggest'),'private, no-store');
 assert.equal(cacheControl('private, no-store',200,'/api/session'),'private, no-store');
});

test('private appeals cannot acquire shared cache headers, even on errors',()=>{
 for(const path of ['/tr/itiraz','/en/appeal','/tr/itiraz/']){
  assert.equal(cacheControl('s-maxage=3600, stale-while-revalidate=60',200,path),'no-store');
  assert.equal(cacheControl('public, s-maxage=300',404,path),'no-store');
 }
});
