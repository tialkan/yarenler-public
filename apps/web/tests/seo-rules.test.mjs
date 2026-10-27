import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MIN_INDEXABLE_PEOPLE,fieldIndexable,unitIndexable,personIndexable,alternates,robots,sitemapPair} from '../src/server/seo-rules.ts';
import {titleEn,displayTitle} from '../src/server/titles.ts';
test('thin field and unit pages: fewer than 3 researchers is noindex, 3 is indexable',()=>{
 assert.equal(MIN_INDEXABLE_PEOPLE,3);
 assert.equal(fieldIndexable('tr',{people:2,nameEn:'X'}),false);
 assert.equal(fieldIndexable('tr',{people:3,nameEn:null}),true);
 assert.equal(unitIndexable('tr',{people:2,nameEn:null}),false);
 assert.equal(unitIndexable('tr',{people:40,nameEn:null}),true);
});
test('English copies are indexable only with a source English name',()=>{
 assert.equal(fieldIndexable('en',{people:10,nameEn:null}),false);
 assert.equal(fieldIndexable('en',{people:10,nameEn:'  '}),false);
 assert.equal(fieldIndexable('en',{people:10,nameEn:'Toxicology'}),true);
 assert.equal(fieldIndexable('en',{people:2,nameEn:'Toxicology'}),false);
 assert.equal(unitIndexable('en',{people:10,nameEn:null}),false);
});
test('person pages: Turkish always, English only when unit, every field and the title are English',()=>{
 const en=(o)=>personIndexable('en',{hasUnit:false,unitEn:null,fields:[],hasTitle:false,titleEn:null,...o});
 assert.equal(personIndexable('tr',{hasUnit:true,unitEn:null,fields:[{ad_tr:'A',ad_en:null}],hasTitle:true,titleEn:null}),true);
 assert.equal(en({}),true);
 assert.equal(en({hasUnit:true}),false);
 assert.equal(en({hasUnit:true,unitEn:'Faculty of Medicine'}),true);
 assert.equal(en({fields:[{ad_tr:'Toksikoloji',ad_en:'Toxicology'},{ad_tr:'Ağız',ad_en:null}]}),false);
 assert.equal(en({hasTitle:true,titleEn:titleEn('Doç. Dr.')}),true);
 assert.equal(en({hasTitle:true,titleEn:titleEn('Kendi yazdığım unvan')}),false);
});
test('academic titles: known YÖK forms only',()=>{
 assert.equal(titleEn('Dr. Öğr. Üyesi'),'Asst. Prof. Dr.');
 assert.equal(titleEn(' Arş.  Gör. '),'Res. Asst.');
 assert.equal(titleEn('Profesör'),null);
 assert.equal(displayTitle('Profesör','en'),'Profesör');
 assert.equal(displayTitle('Doç. Dr.','tr'),'Doç. Dr.');
});
test('hreflang pairs only when both versions are indexable; robots noindex keeps follow',()=>{
 const pair={tr:'/tr/alan/x',en:'/en/field/x'};
 assert.deepEqual(alternates('https://y.org','tr',pair,{tr:true,en:true}),{canonical:'https://y.org/tr/alan/x',languages:{tr:'https://y.org/tr/alan/x',en:'https://y.org/en/field/x','x-default':'https://y.org/tr/alan/x'}});
 assert.deepEqual(alternates('https://y.org','tr',pair,{tr:true,en:false}),{canonical:'https://y.org/tr/alan/x'});
 assert.deepEqual(alternates('https://y.org','en',pair,{tr:true,en:true},'?page=2').canonical,'https://y.org/en/field/x?page=2');
 assert.deepEqual(robots(false),{index:false,follow:true});
});
test('sitemap: noindex versions are left out and carry no hreflang',()=>{
 assert.deepEqual(sitemapPair('https://y.org','/tr/a','/en/a',{tr:true,en:false},'2026-10-23T00:00:00.000Z'),[{url:'https://y.org/tr/a',lastModified:'2026-10-23T00:00:00.000Z',alternates:undefined}]);
 assert.equal(sitemapPair('https://y.org','/tr/a','/en/a',{tr:false,en:false}).length,0);
 const both=sitemapPair('https://y.org','/tr/a','/en/a',{tr:true,en:true});
 assert.equal(both.length,2);assert.equal(both[1].alternates['x-default'],'https://y.org/tr/a');
});
