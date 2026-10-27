import {test} from 'node:test';
import assert from 'node:assert/strict';
import {featuredFields,focusCluster,FEATURED_FIELD_LIMIT} from '../src/server/home-facts.ts';
import {pairTieBreak} from '../src/server/research-matching.ts';

const f=(name,people,en=null)=>({id:name,slug:name.toLowerCase(),ad_tr:name,ad_en:en,people});

test('featured fields: by people, broad and thin fields left out, at most twelve',()=>{
 const rows=[f('Sağlık Bilimleri',400),f('Temel Bilimler (Sci)',300),{...f('Sosyal Bilimler',350),broad:true},f('Yapay Zeka',37),f('Ekonomi',23),f('Kriptoloji',2),f('İç Hastalıkları',23),f('Genel Cerrahi',30),f('Mühendislik ve Teknoloji',250)];
 assert.deepEqual(featuredFields(rows).map(r=>r.ad_tr),['Yapay Zeka','Ekonomi','İç Hastalıkları']);
 const many=Array.from({length:30},(_,i)=>f('Alan '+String(i).padStart(2,'0'),50-i));
 assert.equal(featuredFields(many).length,FEATURED_FIELD_LIMIT);
 assert.equal(featuredFields(many)[0].ad_tr,'Alan 00');
});

test('featured fields: equal counts in Turkish order, a repeated name counts once',()=>{
 const rows=[f('Çevre Mühendisliği',10),f('Cerrahi',10),f('Ölçme',10),f('cerrahi',9)];
 assert.deepEqual(featuredFields(rows).map(r=>r.ad_tr),['Cerrahi','Çevre Mühendisliği','Ölçme']);
});

test('focus: the readable cluster whose members are most linked to each other',()=>{
 const L=(s,t,score=70)=>({source:s,target:t,score});
 // hub has 12 links (too many to read); c1 has 4 neighbours, 3 links among them; c2 has 4 neighbours, none linked.
 const links=[...Array.from({length:12},(_,i)=>L('hub','h'+i)),L('c1','a'),L('c1','b'),L('c1','c'),L('c1','d'),L('a','b'),L('b','c'),L('c','d'),L('c2','x'),L('c2','y'),L('c2','z'),L('c2','w')];
 const focus=focusCluster(links);
 assert.equal(focus.center,'c1');
 assert.deepEqual(focus.members,['a','b','c','d']);
 assert.equal(focus.internal,3);
 assert.deepEqual(focusCluster(links),focus);
 assert.equal(focusCluster([L('a','b')]),null);
});

test('equal scores do not favour names starting with A',()=>{
 assert.equal(pairTieBreak('x','y'),pairTieBreak('y','x'));
 const order=['aaaa','bbbb','cccc','dddd','eeee','ffff'].sort((p,q)=>pairTieBreak('zz',p)-pairTieBreak('zz',q));
 assert.notDeepEqual(order,['aaaa','bbbb','cccc','dddd','eeee','ffff']);
});
