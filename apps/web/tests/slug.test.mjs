import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slugify,parseFieldParam,parseUnitParam,canonicalRedirect} from '../src/server/slug.ts';
test('Turkish letters become ASCII in addresses (ı→i, ş→s, ğ→g, ç→c, ö→o, ü→u, İ→i)',()=>{
 assert.equal(slugify('Ağız, Diş ve Çene Cerrahisi'),'agiz-dis-ve-cene-cerrahisi');
 assert.equal(slugify('IŞIK İŞLEME Üçgen Öğün'),'isik-isleme-ucgen-ogun');
 assert.equal(slugify('Türk Halk Müziği Anasanat Dalı'),'turk-halk-muzigi-anasanat-dali');
 assert.equal(slugify('Uluslararası İlişkiler (Soc)'),'uluslararasi-iliskiler-soc');
 assert.equal(slugify('  -- Fizik,Yüksek Enerji Fiziği -- '),'fizik-yuksek-enerji-fizigi');
 assert.equal(slugify('Âşık Veysel & Kültür'),'asik-veysel-kultur');
 assert.equal(slugify('Straße Æsir Øre'),'strasse-aesir-ore');
});
test('long names are cut at a word boundary, never mid-word',()=>{
 assert.equal(slugify('çok uzun bir başlık deneme',12),'cok-uzun-bir');
 assert.equal(slugify('abcdefghijklmnop',10),'abcdefghij');
 const long=slugify('Çok uzun bir başlık ile denenen alan adı ve bir sürü kelime içeren ifade burada duruyor ki kesilsin');
 assert.ok(long.length<=80,long);assert.ok(!long.endsWith('-'));assert.equal(long,'cok-uzun-bir-baslik-ile-denenen-alan-adi-ve-bir-suru-kelime-iceren-ifade-burada');
});
test('field addresses: legacy UUID form, stored slug, invalid input',()=>{
 assert.deepEqual(parseFieldParam('01a164c9-efc9-7b2c-9a1d-0123456789ab-beslenme-ve-dietetik'),{kind:'legacy',id:'01a164c9-efc9-7b2c-9a1d-0123456789ab'});
 assert.deepEqual(parseFieldParam('01a164c9-efc9-7b2c-9a1d-0123456789ab'),{kind:'legacy',id:'01a164c9-efc9-7b2c-9a1d-0123456789ab'});
 assert.deepEqual(parseFieldParam('beslenme-ve-dietetik'),{kind:'slug',slug:'beslenme-ve-dietetik'});
 assert.deepEqual(parseFieldParam('beslenme-ve-dietetik-3fa2c1'),{kind:'slug',slug:'beslenme-ve-dietetik-3fa2c1'});
 for(const bad of ['Beslenme','a--b','-a','a_b','x'.repeat(121),"a'; drop"])assert.equal(parseFieldParam(bad).kind,'invalid',bad);
});
test('unit addresses: old "birim-{hash}" form is recognised, new slugs pass',()=>{
 assert.deepEqual(parseUnitParam('birim-fce23899745c'),{kind:'legacy',slug:'birim-fce23899745c'});
 assert.deepEqual(parseUnitParam('tip-fakultesi'),{kind:'slug',slug:'tip-fakultesi'});
 assert.deepEqual(parseUnitParam('gida-muhendisligi-2'),{kind:'slug',slug:'gida-muhendisligi-2'});
 assert.equal(parseUnitParam('Tıp').kind,'invalid');
});
test('redirect mapping: only a different canonical slug redirects',()=>{
 assert.equal(canonicalRedirect('/tr/birim','birim-fce23899745c','tip-fakultesi'),'/tr/birim/tip-fakultesi');
 assert.equal(canonicalRedirect('/tr/alan','01a164c9-efc9-7b2c-9a1d-0123456789ab-beslenme','beslenme-ve-dietetik'),'/tr/alan/beslenme-ve-dietetik');
 assert.equal(canonicalRedirect('/tr/alan','beslenme-ve-dietetik','beslenme-ve-dietetik'),null);
 assert.equal(canonicalRedirect('/tr/alan','x',null),null);
});
