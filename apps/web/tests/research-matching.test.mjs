import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesResearchTerm,foldResearch,compare,broad} from '../src/server/research-matching.ts';
test('short field At is not evidence for information law or financial inclusion',()=>{
 assert.equal(matchesResearchTerm('At','information law'),false);
 assert.equal(matchesResearchTerm('At','financial inclusion'),false);
 assert.equal(matchesResearchTerm('Bankacılık ve Finans','bankacılık sektörü'),true);
 assert.equal(matchesResearchTerm('Bilişim Hukuku','bilişim'),true);
 assert.equal(matchesResearchTerm('Hukuk','horse breeding'),false);
});
test('Turkish normalization preserves concept boundaries',()=>{
 assert.equal(foldResearch('BİLİŞİM, Bankacılık'),'bilisim bankacilik');
 assert.equal(matchesResearchTerm('İktisat','iktisat araştırmaları'),true);
 assert.equal(matchesResearchTerm('Tıp','yatırım'),false);
});
test('broad categories alone cannot create a strong edge',()=>{
 const weights=new Map([['s',1],['x',4]]),names=new Map([['s','Sosyal ve Beşeri Bilimler'],['x','Kriptoloji']]);
 const broad={labels:new Set(['s']),weight:1};assert.equal(compare(broad,broad,weights,names).score,15);
 const specific={labels:new Set(['x']),weight:4};assert.equal(compare(specific,specific,weights,names).score,100);
 assert.equal(compare(specific,broad,weights,names),null);
 const mixed={labels:new Set(['s','x']),weight:5};assert.equal(compare(mixed,specific,weights,names).score,compare(specific,mixed,weights,names).score);
});
import {researchTokens,sameStem,tokenStatistics,rankTextMatches} from '../src/server/research-matching.ts';
test('generic words and institution phrases are not research evidence',()=>{
 assert.deepEqual(researchTokens('finansal teknoloji'),['finansal']);
 assert.deepEqual(researchTokens('İktisadi ve İdari Bilimler Fakültesi'),[]);
 assert.deepEqual(researchTokens('Polimer Teknolojisi'),['polimer']);
 assert.equal(sameStem('bankasi','bankacilik'),true);
 assert.equal(sameStem('kripto','kriptoloji'),false);
 assert.equal(sameStem('para','paralari'),true);
});
test('announcement ranking: CBDC request does not surface unrelated units, max three reasons',()=>{
 const filler=Array.from({length:60},(_,i)=>({id:'f'+i,labels:['Alan '+i+' Kimya','Mühendislik ve Teknoloji'],interests:[]}));
 const people=[...filler,
  {id:'hs',labels:['Besin Hijyeni ve Teknolojisi','Veteriner Bilimleri','Bitki ve Hayvan Bilimleri'],interests:[]},
  {id:'ch',labels:['Polimer Teknolojisi','Membran Teknolojisi','Elektrokimyasal Teknolojiler'],interests:[]},
  {id:'en',labels:['Isıl Sistemler','Hidrojen teknolojileri ve yakıt hücreleri'],interests:[]},
  {id:'bf',labels:['Bankacılık ve Finans','Para-Banka','Finans Ekonomisi','Finansman','İş Finansı'],interests:[]}];
 const text='TÜBİTAK 3005 projem için merkez bankası dijital paraları üzerine çalışması olan, tercihen İİBF\'den bir hoca arıyorum';
 const result=rankTextMatches(people,['finansal teknoloji','iktisadi ve idari bilimler fakültesi','ödeme sistemleri','merkez bankası dijital paraları',text],tokenStatistics(people),{text});
 assert.deepEqual(result.map(r=>r.id),['bf']);
 assert.ok(result[0].reasons.length<=3);
});
test('a field added by a researcher (one or two people) gets an IDF weight and links the people who share it',()=>{
 // Same weighting as network.ts corpus(): log((n+1)/(df+1))+1, broad labels x0.15.
 const people=[{id:'a',labels:['k','genel']},{id:'b',labels:['k','genel']},...Array.from({length:40},(_,i)=>({id:'f'+i,labels:['genel','x'+(i%5)]}))];
 const display=new Map([['k','Kuantum Biyolojisi'],['genel','Sosyal ve Beşeri Bilimler'],...Array.from({length:5},(_,i)=>['x'+i,'Alan '+i])]);
 const df=new Map();for(const p of people)for(const key of new Set(p.labels))df.set(key,(df.get(key)||0)+1);
 const weights=new Map([...df].map(([key,n])=>[key,(Math.log((people.length+1)/(n+1))+1)*(broad(display.get(key))?.15:1)]));
 assert.ok(weights.get('k')>weights.get('x0'));assert.ok(weights.get('k')>weights.get('genel'));
 const node=p=>({labels:new Set(p.labels),weight:p.labels.reduce((s,k)=>s+weights.get(k),0)});
 const match=compare(node(people[0]),node(people[1]),weights,display);
 assert.ok(match.score>=90);assert.equal(match.reasons[0],'Kuantum Biyolojisi');
 assert.ok(compare(node(people[0]),node(people[2]),weights,display).score<=15);
 // Text matching (announcements) finds the new label too.
 const text=[{id:'a',labels:['Kuantum Biyolojisi'],interests:[]},...Array.from({length:30},(_,i)=>({id:'t'+i,labels:['Organik Kimya '+i],interests:[]}))];
 assert.equal(rankTextMatches(text,['kuantum biyolojisi'],tokenStatistics(text),{})[0]?.id,'a');
});
test('a whole announcement as a query shows the matching field words, not the full text',()=>{
 const people=[{id:'a',labels:['Biyomedikal Görüntü İşleme','Kuantum Optiği'],interests:[]},...Array.from({length:60},(_,i)=>({id:'f'+i,labels:[['Tarih','Hidrolik','Mimarlık','Botanik'][i%4]],interests:[]}))];
 const text='Görüntü işleme ve sinyal analizi alanında TÜBİTAK projesi için ortak araştırmacı arıyoruz, ilgilenenler yazsın.';
 const [hit]=rankTextMatches(people,[text],tokenStatistics(people),{text});
 assert.equal(hit.id,'a');assert.equal(hit.reasons[0].term,'Görüntü İşleme');
});
