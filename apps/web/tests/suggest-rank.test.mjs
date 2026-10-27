import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankSuggestions,prefixMatches} from '../src/server/suggest-rank.ts';
const person=(label,id=label)=>({kind:'person',id,label,detail:'',url:''});
const field=(label)=>({kind:'field',id:label,label,detail:'',url:''});
test('a typed person name never pulls folding-only field matches',()=>{
 const result=rankSuggestions('Örnek Araştırmacı',[person('Örnek Araştırmacı')],[field('İslam Tarihi'),field('Tarih')]);
 assert.deepEqual(result.map(r=>r.label),['Örnek Araştırmacı']);
});
test('name prefix matches are listed above field suggestions',()=>{
 const result=rankSuggestions('yapay',[person('Ali Yapay'),person('Veli Kaya')],[field('Yapay Zekâ')]);
 assert.equal(result[0].label,'Ali Yapay');assert.equal(result[1].label,'Yapay Zekâ');assert.equal(result.length,2);
});
test('Turkish folding still matches dotted and dotless letters at word starts',()=>{
 assert.equal(prefixMatches('İŞLETME','isle'),true);
 assert.equal(prefixMatches('Işık Fiziği','isik'),true);
 assert.equal(prefixMatches('İslam Tarihi','tarık'),false);
});
test('field suggestions are dropped when enough people match by name',()=>{
 const result=rankSuggestions('ahmet',[person('Ahmet A'),person('Ahmet B'),person('Ahmet C')],[field('Ahmet Yesevi Çalışmaları')]);
 assert.equal(result.every(r=>r.kind==='person'),true);
});
test('an exact name is first and field-only people follow when nobody matches by name',()=>{
 assert.equal(rankSuggestions('Ayşe Kara',[person('Ayşe Karaca'),person('Ayşe Kara')],[])[0].label,'Ayşe Kara');
 const fallback=rankSuggestions('robotik',[person('Mehmet Demir')],[field('Robotik')]);
 assert.deepEqual(fallback.map(r=>r.label),['Robotik','Mehmet Demir']);
});
