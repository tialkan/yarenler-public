import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanAreaInput,screenAreaName,localHeadingName,closeEnough,normalizeAiName,sanitizeEnglishName,sanitizeReason,parseAiContent,validateAiReview,decide,mergeCandidates,shortIds,buildAiMessages,aiCacheKey,newAreaAllowed,aiCheckAllowed,areaDbError,DAILY_NEW_AREA_LIMIT,AI_CHECKS_PER_HOUR,SYSTEM_PROMPT} from '../src/server/area-intake.ts';

const candidates=[{id:'0199a000-0000-7000-8000-000000000001',ad:'Bilgisayar Öğrenimi',ad_en:'Computer Learning'},{id:'0199a000-0000-7000-8000-000000000002',ad:'Yapay Zeka',ad_en:'Artificial Intelligence'}];
const review=(over={})=>({duzeltilmis_ad:'Kuantum Biyolojisi',ad_en:'Quantum Biology',karar:'yeni',mevcut_alan_id:null,kisa_gerekce:'Adaylardan hiçbiri aynı alan değil.',...over});

test('Normalizasyon: NFC, tireler, boşluklar; kontrol karakterleri ekranda reddedilir',()=>{
 assert.equal(cleanAreaInput('  Makine\u00A0 Öğrenmesi\t'),'Makine Öğrenmesi');
 assert.equal(cleanAreaInput('O\u0308lc\u0327me'),'Ölçme');
 assert.equal(cleanAreaInput('Sağlık\u2014Ekonomisi'),'Sağlık-Ekonomisi');
 assert.equal(cleanAreaInput(null),'');
 assert.equal(screenAreaName('Kuantum\u200BBiyolojisi').ok,false);
 assert.equal(screenAreaName('Kuantum\u0007Biyolojisi').code,'kontrol');
});

test('Normalizasyon: Türkçe başlık düzeni (text-case.ts bağlaçları), kısaltma korunur',()=>{
 assert.equal(localHeadingName('kuantum biyolojisi'),'Kuantum Biyolojisi');
 assert.equal(localHeadingName('istatistik ve veri bilimi'),'İstatistik ve Veri Bilimi');
 assert.equal(localHeadingName('İKLİM DEĞİŞİKLİĞİ İLE İLGİLİ POLİTİKALAR'),'İklim Değişikliği ile ilgili Politikalar');
 assert.equal(localHeadingName('ışık kirliliği'),'Işık Kirliliği');
 assert.equal(localHeadingName('MACHINE LEARNING'),'Machine Learning');
 assert.equal(localHeadingName('history of medicine'),'History of Medicine');
 assert.equal(localHeadingName('COVID-19 epidemiyolojisi'),'COVID-19 epidemiyolojisi');
 assert.equal(localHeadingName('GIS'),'GIS');
 assert.equal(localHeadingName('fMRI ile beyin haritalama.'),'fMRI ile beyin haritalama');
 assert.equal(localHeadingName('kentsel dönüşüm ve Afet Yönetimi'),'Kentsel dönüşüm ve Afet Yönetimi');
});

test('Yerel ön eleme: uzunluk 2-120, URL, e-posta, telefon, harfsiz, klavye gürültüsü',()=>{
 assert.equal(screenAreaName('a').code,'uzunluk');
 assert.equal(screenAreaName('x'.repeat(60)+' '+'y'.repeat(60)).code,'uzunluk');
 assert.equal(screenAreaName('ab').ok,true);
 assert.equal(screenAreaName('Ç'.repeat(2)+'a'.repeat(118)).code,'anlamsiz');
 assert.equal(screenAreaName('https://ornek.com').code,'url');
 assert.equal(screenAreaName('www.ornek.org.tr').code,'url');
 assert.equal(screenAreaName('ornek.com.tr indirim').code,'url');
 assert.equal(screenAreaName('ad.soyad@aybu.edu.tr').code,'eposta');
 assert.equal(screenAreaName('0 532 123 45 67').code,'telefon');
 assert.equal(screenAreaName('12345').code,'harf');
 assert.equal(screenAreaName('aaaaaa').code,'anlamsiz');
 assert.equal(screenAreaName('sdfghjkl').code,'anlamsiz');
 for(const ok of ['Kuantum Biyolojisi','COVID-19 Epidemiyolojisi','ISO 27001 Bilgi Güvenliği','C++ ile Gömülü Sistemler','Rhythm Analysis','Osmanlı Paleografyası','HPLC','Node.js Mimarileri']){const s=screenAreaName(ok);assert.equal(s.ok,true,ok);assert.equal(s.text,ok);}
 const message=screenAreaName('https://x.com').message;assert.ok(message.tr.length>10&&message.en.length>10);
});

test('JSON şema doğrulama: tam beş anahtar, doğru türler, karar ve aday kimliği tutarlı',()=>{
 const ids=shortIds(candidates);
 assert.deepEqual(ids,['1','2']);
 assert.equal(validateAiReview(review(),ids).ok,true);
 assert.equal(validateAiReview(review({karar:'mevcut',mevcut_alan_id:'2'}),ids).ok,true);
 assert.equal(validateAiReview(review({karar:'gecersiz',duzeltilmis_ad:''}),ids).ok,true);
 assert.equal(validateAiReview({...review(),fazla:1},ids).reason,'anahtarlar');
 const missing=review();delete missing.ad_en;assert.equal(validateAiReview(missing,ids).reason,'anahtarlar');
 assert.equal(validateAiReview(review({karar:'red'}),ids).reason,'karar');
 assert.equal(validateAiReview(review({karar:'mevcut',mevcut_alan_id:'3'}),ids).reason,'mevcut_alan_id');
 assert.equal(validateAiReview(review({karar:'mevcut',mevcut_alan_id:candidates[0].id}),ids).reason,'mevcut_alan_id');
 assert.equal(validateAiReview(review({mevcut_alan_id:'1'}),ids).reason,'mevcut_alan_id');
 assert.equal(validateAiReview(review({duzeltilmis_ad:'x'}),ids).reason,'duzeltilmis_ad');
 assert.equal(validateAiReview(review({duzeltilmis_ad:42}),ids).reason,'duzeltilmis_ad');
 assert.equal(validateAiReview(review({ad_en:7}),ids).reason,'ad_en');
 assert.equal(validateAiReview(review({kisa_gerekce:'x'.repeat(401)}),ids).reason,'kisa_gerekce');
 assert.equal(validateAiReview([],ids).ok,false);
 assert.equal(validateAiReview(null,ids).ok,false);
 assert.equal(validateAiReview('{"karar":"yeni"}',ids).ok,false);
});

test('Model çıktısı ayrıştırma: kod çiti temizlenir, JSON olmayan metin hata verir',()=>{
 assert.deepEqual(parseAiContent('```json\n{"a":1}\n```'),{a:1});
 assert.deepEqual(parseAiContent(' {"a":2} '),{a:2});
 assert.throws(()=>parseAiContent('Tabii, işte sonuç: yeni'));
 assert.throws(()=>parseAiContent(undefined));
});

test('Karar mantığı: yeni ve dar alanlar kabul, mevcut kısa kimlikten gerçek kimliğe, gecersiz gerekçeli',()=>{
 const yeni=decide('kuantum biyolojsi',candidates,{ok:true,value:review()});
 assert.deepEqual(yeni,{karar:'yeni',duzeltilmisAd:'Kuantum Biyolojisi',adEn:'Quantum Biology',mevcutId:null,gerekce:'Adaylardan hiçbiri aynı alan değil.',durum:'denetlendi',hata:null});
 const mevcut=decide('makine öğrenimi',candidates,{ok:true,value:review({duzeltilmis_ad:'Makine Öğrenimi',ad_en:'Machine Learning',karar:'mevcut',mevcut_alan_id:'1'})});
 assert.equal(mevcut.karar,'mevcut');assert.equal(mevcut.mevcutId,candidates[0].id);assert.equal(mevcut.duzeltilmisAd,'Makine Öğrenimi');
 const gecersiz=decide('çok ucuz kredi fırsatı',candidates,{ok:true,value:review({karar:'gecersiz',duzeltilmis_ad:'',ad_en:null,kisa_gerekce:'Bu metin bir reklam, araştırma alanı değil.'})});
 assert.equal(gecersiz.karar,'gecersiz');assert.equal(gecersiz.duzeltilmisAd,null);assert.equal(gecersiz.gerekce,'Bu metin bir reklam, araştırma alanı değil.');
 // A model that rewrites the field into something else is not trusted for the name.
 const drift=decide('deniz arkeolojisi',candidates,{ok:true,value:review({duzeltilmis_ad:'Yapay Zeka Etiği',ad_en:null})});
 assert.equal(drift.duzeltilmisAd,'Deniz Arkeolojisi');assert.equal(drift.karar,'yeni');
 // Turkish letters are not an English name.
 assert.equal(decide('kuantum biyolojisi',candidates,{ok:true,value:review({ad_en:'Kuantum Biyolojisi Çalışmaları'})}).adEn,null);
 // Heading case is applied to the model's name too.
 assert.equal(decide('tarım ve gıda politikası',candidates,{ok:true,value:review({duzeltilmis_ad:'Tarım Ve Gıda Politikası',ad_en:null})}).duzeltilmisAd,'Tarım ve Gıda Politikası');
});

test('AI hata yedeği: her hata yerel normalizasyonla yeni alan olur ve denetlenmedi işaretlenir',()=>{
 for(const reason of ['yapilandirma','butce','sinir','zaman_asimi','http','sema']){
  const d=decide('SÜRDÜRÜLEBİLİR TURİZM PLANLAMASI',candidates,{ok:false,reason});
  assert.deepEqual(d,{karar:'yeni',duzeltilmisAd:'Sürdürülebilir Turizm Planlaması',adEn:null,mevcutId:null,gerekce:null,durum:'denetlenmedi',hata:reason});
 }
});

test('Düzeltme yakınlığı, İngilizce ad ve gerekçe temizliği',()=>{
 assert.equal(closeEnough('makine ogrenmesi','Makine Öğrenmesi'),true);
 assert.equal(closeEnough('kuantum biyolojsi','Kuantum Biyolojisi'),true);
 assert.equal(closeEnough('yapay zeka','Yapay Zekâ'),true);
 assert.equal(closeEnough('deniz arkeolojisi','Yapay Zeka Etiği'),false);
 assert.equal(closeEnough('GIS','Gis'),true);
 assert.equal(closeEnough('GIS','CBS'),false);
 assert.equal(normalizeAiName(' "Kuantum Biyolojisi." '),'Kuantum Biyolojisi');
 assert.equal(normalizeAiName('deniz arkeolojisi'),'Deniz Arkeolojisi');
 assert.equal(normalizeAiName('SUALTI ARKEOLOJİSİ VE KORUMA'),'Sualtı Arkeolojisi ve Koruma');
 assert.equal(normalizeAiName('GIS'),'GIS');
 assert.equal(normalizeAiName('mRNA Aşı Teknolojileri'),'mRNA Aşı Teknolojileri');
 assert.equal(sanitizeEnglishName('Quantum Biology'),'Quantum Biology');
 assert.equal(sanitizeEnglishName('Kuantum Biyolojisi Çalışmaları'),null);
 assert.equal(sanitizeEnglishName(null),null);
 assert.equal(sanitizeEnglishName('x'),null);
 assert.equal(sanitizeReason('Ayrıntı için https://ornek.com adresine bakın.'),'Ayrıntı için adresine bakın.');
 assert.ok(sanitizeReason('uzun '.repeat(80)).length<=161);
 assert.equal(sanitizeReason(5),null);
});

test('Adaylar: sözcüksel önce, anlamsal eklenir, tekrar yok, en çok 10',()=>{
 const a=(id)=>({id,ad:id,ad_en:null});
 assert.deepEqual(mergeCandidates([a('x'),a('y')],[a('y'),a('z')]).map(c=>c.id),['x','y','z']);
 assert.deepEqual(mergeCandidates([a('x'),a('y'),a('w')],[a('z')]).map(c=>c.id),['x','z','y','w']);
 assert.equal(mergeCandidates(Array.from({length:8},(_,i)=>a('l'+i)),Array.from({length:8},(_,i)=>a('s'+i))).length,10);
 assert.deepEqual(mergeCandidates([],[]),[]);
});

test('Model isteği: hocanın metni ve adaylar veri olarak gider, veritabanı kimliği gönderilmez; önbellek anahtarı',()=>{
 const messages=buildAiMessages('Kuantum biyolojisi',candidates);
 assert.equal(messages[0].role,'system');assert.equal(messages[0].content,SYSTEM_PROMPT);
 const data=JSON.parse(messages[1].content);
 assert.equal(data.girdi,'Kuantum biyolojisi');assert.deepEqual(data.adaylar.map(c=>c.id),['1','2']);
 assert.ok(!messages[1].content.includes(candidates[0].id));
 assert.match(SYSTEM_PROMPT,/Never reject a field because it is missing from the candidates or the catalog, or because it is too narrow or too new/);
 assert.ok(!/\u2014/.test(SYSTEM_PROMPT));
 const k1=aiCacheKey('m','Kuantum',['a','b']);
 assert.equal(k1,aiCacheKey('m','Kuantum',['a','b']));
 assert.notEqual(k1,aiCacheKey('m','Kuantum',['a']));
 assert.notEqual(k1,aiCacheKey('m','kuantum',['a','b']));
 assert.match(k1,/^[0-9a-f]{64}$/);
});

test('Oran sınırı ve veritabanı hata kodları',()=>{
 assert.equal(DAILY_NEW_AREA_LIMIT,10);
 assert.equal(newAreaAllowed(0),true);assert.equal(newAreaAllowed(9),true);assert.equal(newAreaAllowed(10),false);assert.equal(newAreaAllowed(25),false);
 assert.equal(aiCheckAllowed(AI_CHECKS_PER_HOUR-1),true);assert.equal(aiCheckAllowed(AI_CHECKS_PER_HOUR),false);
 assert.match(areaDbError('YA003').tr,/en fazla 10 yeni alan/);
 assert.ok(areaDbError('YA001').en.length>0);
 assert.ok(areaDbError('YA002'));
 assert.equal(areaDbError('23505'),null);
 assert.equal(areaDbError(undefined),null);
});
