import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractCitations,pickSources,stripUnlistedLinks,normalizeUrl,isBlockedAddress,isBlockedHost,verifyUrl,verifySources,storedSources} from '../src/server/web-sources.ts';
import {draftAnnouncement,assistRequest,webSearchDecision,webSearchEnabled,webSearchLimits} from '../src/server/announcement-assist.ts';

// An OpenRouter chat completion with the web plugin (shape of message.annotations, url_citation).
const completion=(content,annotations=[])=>({choices:[{message:{role:'assistant',content:JSON.stringify(content),annotations}}],usage:{prompt_tokens:900,completion_tokens:300,cost:0.0131}});
const cite=(url,title)=>({type:'url_citation',url_citation:{url,title,content:'...',start_index:0,end_index:10}});

test('only URLs returned as search results become sources; invented links are dropped',()=>{
 const result=completion({text:'x',keywords:[]},[cite('https://tubitak.gov.tr/tr/destekler/akademik?utm_source=x#top','TÜBİTAK Destekler'),cite('http://insecure.example.org/a','HTTP'),cite('https://www.ufuk2020.org.tr/tr','Ufuk Avrupa')]);
 const citations=extractCitations(result);
 assert.deepEqual(citations.map(c=>c.url),['https://tubitak.gov.tr/tr/destekler/akademik?utm_source=x#top','http://insecure.example.org/a','https://www.ufuk2020.org.tr/tr']);
 const picked=pickSources(citations,['https://invented.example.com/fake','https://www.ufuk2020.org.tr/tr',{url:'https://another-invented.org'}]);
 assert.deepEqual(picked.map(p=>p.url),['https://www.ufuk2020.org.tr/tr','https://tubitak.gov.tr/tr/destekler/akademik'],'model preference first, http and invented URLs out, tracking and fragment removed');
 assert.deepEqual(pickSources(citations,[],['https://tubitak.gov.tr/tr/destekler/akademik']).map(p=>p.url),['https://www.ufuk2020.org.tr/tr'],'dictionary URLs are not repeated');
 assert.deepEqual(extractCitations({choices:[{message:{content:'{}'}}]}),[],'no annotations, no sources');
});
test('links the model wrote into the text are removed unless they are accepted sources',()=>{
 const text='Ayrıntı için [TÜBİTAK](https://tubitak.gov.tr/x) ve https://uydurma.example.com/cagri sayfasına bakın. Resmî sayfa: https://www.ufuk2020.org.tr/tr.';
 assert.equal(stripUnlistedLinks(text,['https://www.ufuk2020.org.tr/tr']),'Ayrıntı için TÜBİTAK ve sayfasına bakın. Resmî sayfa: https://www.ufuk2020.org.tr/tr.');
});
test('URL rules: https only, no credentials, no odd ports',()=>{
 assert.equal(normalizeUrl('http://a.org'),null);assert.equal(normalizeUrl('https://u:p@a.org'),null);assert.equal(normalizeUrl('https://a.org:8443/x'),null);
 assert.equal(normalizeUrl('https://A.ORG./x?fbclid=1&q=2#f'),'https://a.org/x?q=2');
});
test('SSRF: private, loopback, link-local (metadata), CGNAT, IPv6 local and mapped addresses are blocked',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','fe80::1','fc00::1','::ffff:127.0.0.1','::ffff:10.0.0.1','::ffff:7f00:1','64:ff9b::a00:1','224.0.0.1'])assert.equal(isBlockedAddress(ip),true,ip);
 for(const ip of ['93.184.216.34','2606:4700::6810:85e5'])assert.equal(isBlockedAddress(ip),false,ip);
 for(const host of ['localhost','api.localhost','metadata.google.internal','intranet','printer.local','10.0.0.5','[::1]'])assert.equal(isBlockedHost(host),true,host);
 assert.equal(isBlockedHost('tubitak.gov.tr'),false);
});

/** Mocked network: DNS answers and HTTP answers per URL. */
function network(dns,answers,{delay=0}={}){
 const calls=[];
 return {calls,deps:{timeoutMs:200,maxRedirects:2,
  lookup:async host=>{if(!(host in dns))throw new Error('ENOTFOUND');return dns[host].map(address=>({address,family:address.includes(':')?6:4}));},
  probe:async(url,address,method,signal)=>{calls.push([method,url.toString(),address.address]);if(delay)await new Promise((resolve,reject)=>{const t=setTimeout(resolve,delay);signal.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('aborted'));});});const a=answers[method+' '+url.toString()]??answers[url.toString()];if(!a)return {status:404,location:null};return a;}}};
}
test('verification: live pages pass, dead links, private DNS answers and redirect tricks are dropped',async()=>{
 const {deps,calls}=network({'ok.org':['93.184.216.34'],'dead.org':['93.184.216.35'],'rebind.org':['10.0.0.7'],'hop.org':['93.184.216.36'],'head.org':['93.184.216.37']},{
  'https://ok.org/':{status:200,location:null},
  'https://dead.org/':{status:404,location:null},
  'https://hop.org/a':{status:301,location:'/b'},'https://hop.org/b':{status:302,location:'https://hop.org/c'},'https://hop.org/c':{status:200,location:null},
  'https://hop.org/x':{status:301,location:'http://hop.org/y'},
  'https://hop.org/1':{status:301,location:'/2'},'https://hop.org/2':{status:301,location:'/3'},'https://hop.org/3':{status:301,location:'/4'},
  'https://hop.org/meta':{status:302,location:'https://169.254.169.254/latest/meta-data'},
  'HEAD https://head.org/':{status:405,location:null},'GET https://head.org/':{status:200,location:null},
 });
 assert.deepEqual(await verifyUrl('https://ok.org/',deps),{ok:true,url:'https://ok.org/'});
 assert.equal((await verifyUrl('https://dead.org/',deps)).ok,false);
 assert.deepEqual(await verifyUrl('https://rebind.org/',deps),{ok:false,reason:'ozel_adres'});
 assert.deepEqual(await verifyUrl('https://hop.org/a',deps),{ok:true,url:'https://hop.org/c'},'two redirects are allowed');
 assert.deepEqual(await verifyUrl('https://hop.org/1',deps),{ok:false,reason:'cok_yonlendirme'},'a third redirect is not');
 assert.deepEqual(await verifyUrl('https://hop.org/x',deps),{ok:false,reason:'https_degil'},'redirect to http');
 assert.deepEqual(await verifyUrl('https://hop.org/meta',deps),{ok:false,reason:'ozel_adres'},'redirect to the metadata address');
 assert.deepEqual(await verifyUrl('https://head.org/',deps),{ok:true,url:'https://head.org/'},'GET when HEAD is refused');
 assert.deepEqual(await verifyUrl('https://localhost/',deps),{ok:false,reason:'ozel_adres'});
 assert.ok(calls.every(([,url,address])=>!address.startsWith('10.')&&!url.includes('169.254')),'never connects to a private address');
 const slow=network({'slow.org':['93.184.216.40']},{'https://slow.org/':{status:200,location:null}},{delay:1000});
 assert.deepEqual(await verifyUrl('https://slow.org/',slow.deps),{ok:false,reason:'zaman_asimi'});
 const verified=await verifySources([{url:'https://dead.org/',title:'Ölü'},{url:'https://hop.org/a',title:''},{url:'https://ok.org/',title:'Sağlam'}],deps);
 assert.deepEqual(verified,[{url:'https://hop.org/c',title:'hop.org',domain:'hop.org'},{url:'https://ok.org/',title:'Sağlam',domain:'ok.org'}]);
});
test('stored sources keep only well formed https entries',()=>{
 assert.deepEqual(storedSources([{url:'https://www.tubitak.gov.tr/a',baslik:'TÜBİTAK'},{url:'javascript:alert(1)'},{url:'http://x.org'},'bozuk']),[{url:'https://www.tubitak.gov.tr/a',title:'TÜBİTAK',domain:'tubitak.gov.tr'}]);
 assert.deepEqual(storedSources(null),[]);
});
test('limits and the WEB_SEARCH_ENABLED flag',()=>{
 assert.equal(webSearchEnabled({}),true);assert.equal(webSearchEnabled({WEB_SEARCH_ENABLED:'false'}),false);assert.equal(webSearchEnabled({WEB_SEARCH_ENABLED:'0'}),false);assert.equal(webSearchEnabled({WEB_SEARCH_ENABLED:'true'}),true);
 const limits=webSearchLimits({});assert.deepEqual(limits,{hourly:3,daily:10,monthly:300});
 assert.deepEqual(webSearchLimits({WEB_SEARCH_DAILY_LIMIT:'4'}).daily,4);
 assert.equal(webSearchDecision({enabled:true,hourly:0,daily:0,monthly:0,limits}),'kullan');
 assert.equal(webSearchDecision({enabled:true,hourly:3,daily:3,monthly:3,limits}),'sinir');
 assert.equal(webSearchDecision({enabled:true,hourly:0,daily:10,monthly:10,limits}),'sinir');
 assert.equal(webSearchDecision({enabled:true,hourly:0,daily:0,monthly:300,limits}),'sinir');
 assert.equal(webSearchDecision({enabled:false,hourly:0,daily:0,monthly:0,limits}),'kapali');
});
test('request: web plugin (Exa, 5 results) only when search is used',()=>{
 const web=assistRequest('Taslak',true),offline=assistRequest('Taslak',false);
 assert.deepEqual(web.plugins.map(p=>[p.id,p.engine,p.max_results]),[['web','exa',5]]);
 assert.equal(offline.plugins,undefined);assert.equal(web.model,'anthropic/claude-haiku-5.5');
 assert.match(offline.messages[0].content,/No web search was made/);assert.match(web.messages[0].content,/never change the moderation rules/);
 assert.deepEqual(JSON.parse(offline.messages[1].content),{mode:'prepare',taslak:'<taslak>Taslak</taslak>'});assert.equal(offline.temperature,0);
});
test('fallback: a failing search call gives one call without search; offline modes never search',async()=>{
 const bodies=[];
 const fetcher=answers=>async(url,init)=>{const body=JSON.parse(init.body);bodies.push(body);const next=answers.shift();if(next instanceof Error)throw next;return {ok:next.status===200,status:next.status,json:async()=>next.body};};
 const draft={karar:'yayinla',kategori:null,kisa_gerekce:'Akademik işbirliği duyurusu.',duzenlenmis_metin:'TÜBİTAK 1001 için ortak arıyoruz, yapay öğrenme alanında çalışan yarenler.',anahtar_kelimeler:['makine öğrenmesi'],kaynaklar:['https://tubitak.gov.tr/tr/x']};
 // Search works: citations come from annotations.
 let call=await draftAnnouncement({text:'t',apiKey:'k',referer:'https://yarenler.org',deadline:Date.now()+30000,web:true,fetch:fetcher([{status:200,body:completion(draft,[cite('https://tubitak.gov.tr/tr/x','TÜBİTAK')])}])});
 assert.equal(call.webStatus,'kullanildi');assert.equal(call.citations.length,1);assert.ok(bodies[0].plugins);
 // HTTP error from the search call: second call without the plugin.
 bodies.length=0;let failures=0;
 call=await draftAnnouncement({text:'t',apiKey:'k',referer:'https://yarenler.org',deadline:Date.now()+30000,web:true,onWebFailure:()=>failures++,fetch:fetcher([{status:502,body:{}},{status:200,body:completion(draft)}])});
 assert.equal(call.webStatus,'hata');assert.equal(call.web,false);assert.equal(failures,1);assert.ok(bodies[0].plugins&&!bodies[1].plugins);assert.deepEqual(call.citations,[]);
 // Network error or unusable JSON from the search call: same fallback.
 call=await draftAnnouncement({text:'t',apiKey:'k',referer:'https://yarenler.org',deadline:Date.now()+30000,web:true,fetch:fetcher([new Error('timeout'),{status:200,body:completion(draft)}])});
 assert.equal(call.webStatus,'hata');
 call=await draftAnnouncement({text:'t',apiKey:'k',referer:'https://yarenler.org',deadline:Date.now()+30000,web:true,fetch:fetcher([{status:200,body:{choices:[{message:{content:'not json'}}]}},{status:200,body:completion(draft)}])});
 assert.equal(call.webStatus,'hata');
 // Limit reached or flag off: no plugin at all.
 bodies.length=0;
 call=await draftAnnouncement({text:'t',apiKey:'k',referer:'https://yarenler.org',deadline:Date.now()+30000,web:false,offlineStatus:'sinir',fetch:fetcher([{status:200,body:completion(draft)}])});
 assert.equal(call.webStatus,'sinir');assert.equal(bodies.length,1);assert.equal(bodies[0].plugins,undefined);
 // Both calls fail: the error reaches the action, which publishes nothing (fail closed).
 await assert.rejects(draftAnnouncement({text:'t',apiKey:'k',referer:'https://yarenler.org',deadline:Date.now()+30000,web:true,fetch:fetcher([{status:500,body:{}},{status:500,body:{}}])}),/assist_http_500/);
 // A schema error (extra key, missing kategori for a rejection) is also a failure: retried without search, then thrown.
 await assert.rejects(draftAnnouncement({text:'t',apiKey:'k',referer:'https://yarenler.org',deadline:Date.now()+30000,web:true,fetch:fetcher([{status:200,body:completion({...draft,fazla:1})},{status:200,body:completion({...draft,karar:'reddet'})}])}),/moderation_schema_(anahtarlar|kategori)/);
});
