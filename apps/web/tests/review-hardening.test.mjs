import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadNetwork} from '../src/server/client-ip.ts';
import {responseHeaders,cacheControl,isCompletedAction} from '../scripts/front-server.mjs';
import {assistRequest,draftAnnouncement} from '../src/server/announcement-assist.ts';
import {headingCase} from '../src/server/text-case.ts';

test('IPv6 privacy addresses share a /64 upload bucket; mapped IPv4 cannot evade IPv4 limits',()=>{
 assert.equal(uploadNetwork('2001:db8:1:2:1111:2222:3333:4444'),uploadNetwork('2001:db8:1:2::99'));
 assert.notEqual(uploadNetwork('2001:db8:1:2::1'),uploadNetwork('2001:db8:1:3::1'));
 assert.equal(uploadNetwork('::ffff:192.0.2.10'),uploadNetwork('192.0.2.10'));
 assert.equal(uploadNetwork('::ffff:c000:20a'),uploadNetwork('192.0.2.10'));
 assert.equal(uploadNetwork('not-an-address'),null);
});
test('session cookies, RSC, private paths and upstream failures never get CDN cache headers',()=>{
 for(const headers of [{'set-cookie':'secret','cache-control':'s-maxage=3600'},{'content-type':'text/x-component','cache-control':'s-maxage=3600'}])assert.match(responseHeaders({headers,statusCode:200},'/tr')['cache-control'],/no-store/);
 for(const path of ['/tr/profilim','/en/sign-in','/tr/kurumsal-katilim','/yonetici/kurumlar'])assert.match(cacheControl('s-maxage=3600',200,path),/no-store/);
 assert.equal(cacheControl('s-maxage=3600',500,'/tr'),'no-store');
 assert.equal(isCompletedAction({method:'POST',headers:{'next-action':'id'},complete:true}),true);
 assert.equal(isCompletedAction({method:'POST',headers:{'next-action':'id'},complete:false}),false);
 assert.equal(isCompletedAction({method:'GET',headers:{},complete:true}),false);
});
test('a hostile revision is still sent to moderation, not accepted merely because it is a revision',async()=>{
 let reviewed=false;const text='Spam ve saldırı içeren bir revizyon denemesi.';
 const call=await draftAnnouncement({text,revision:true,apiKey:'test-only',referer:'https://yarenler.org',web:false,deadline:Date.now()+20000,offlineStatus:'kapali',fetch:async(_url,init)=>{
  const request=JSON.parse(init.body);assert.equal(JSON.parse(request.messages[1].content).mode,'revision');assert.match(request.messages[0].content,/Moderation/);reviewed=true;
  return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({karar:'reddet',duzenlenmis_metin:text,kategori:'reklam_spam',kisa_gerekce:'Akademik çağrı kapsamına uygun değil.',kaynaklar:[],anahtar_kelimeler:[]})}}]})};
 }});assert.equal(reviewed,true);assert.equal(call.draft.karar,'reddet');assert.equal(JSON.parse(assistRequest(text,false,true).messages[1].content).mode,'revision');
});
test('known label corrections preserve meaning, program names and source identifiers',()=>{
 assert.equal(headingCase('Dijital Oyun Tasarimi Anasanat Dalı'),'Dijital Oyun Tasarımı Anasanat Dalı');
 assert.equal(headingCase('Uçak Teknolojisi Pr.'),'Uçak Teknolojisi Programı');
 assert.equal(headingCase('Bilgisayar Bilimi Yapay Zeka'),'Bilgisayar Bilimi Yapay Zeka');
});
