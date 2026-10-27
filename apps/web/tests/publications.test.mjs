import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupCounts,publicationLink,publicationMeta,recentPublications,workNodes} from '../src/server/publications.ts';
import {profilePage,jsonLd} from '../src/server/structured-data.ts';
import {personIndexable} from '../src/server/seo-rules.ts';

const P=(over={})=>({baslik:'Başlık',yil:2024,tur:'makale',kaynak_adi:'Örnek Dergisi',doi:null,openalex_id:null,avesis_url:null,sira:0,...over});

test('counts by type: books and chapters together, rare types under Diğer',()=>{
 const c=groupCounts([{tur:'bildiri',count:15},{tur:'makale',count:20},{tur:'kitap',count:4},{tur:'kitap_bolumu',count:3},{tur:'ansiklopedi_bolumu',count:1},{tur:'bilinmeyen',count:2},{tur:null,count:1}],'tr');
 assert.equal(c.total,46);
 assert.deepEqual(c.groups.map(g=>[g.label,g.count]),[['Makale',20],['Bildiri',15],['Kitap ve bölüm',7],['Diğer',4]]);
 assert.deepEqual(groupCounts([{tur:'makale',count:1}],'en').groups,[{key:'makale',count:1,label:'Articles'}]);
 assert.deepEqual(groupCounts([],'tr'),{total:0,groups:[]});
});

test('link preference: DOI, then OpenAlex, then the AVESİS publication page, else none',()=>{
 assert.deepEqual(publicationLink({doi:'10.1000/a(b)c',openalex_id:'W1',avesis_url:'https://avesis.aybu.edu.tr/yayin/x'}),{href:'https://doi.org/10.1000/a(b)c',kind:'DOI'});
 assert.deepEqual(publicationLink({doi:null,openalex_id:'W4386858042',avesis_url:null}),{href:'https://openalex.org/W4386858042',kind:'OpenAlex'});
 assert.equal(publicationLink({doi:null,openalex_id:null,avesis_url:'https://avesis.aybu.edu.tr/yayin/c9d15fe9-cde4-5394-a6fb-51228f6d4674/x'}).kind,'AVESİS');
 assert.equal(publicationLink({doi:'not-a-doi',openalex_id:null,avesis_url:'https://example.org/yayin/1'}),null);
 assert.equal(publicationLink({doi:'10.1000/x y',openalex_id:null,avesis_url:null}),null);
});

test('meta line and recent order: year first, unknown years last, then source order',()=>{
 assert.equal(publicationMeta(P()),'2024 · Örnek Dergisi');
 assert.equal(publicationMeta(P({yil:null})),'Örnek Dergisi');
 assert.equal(publicationMeta(P({kaynak_adi:null})),'2024');
 const rows=[P({baslik:'a',yil:2020,sira:0}),P({baslik:'b',yil:null,sira:1}),P({baslik:'c',yil:2025,sira:5}),P({baslik:'d',yil:2025,sira:2}),P({baslik:'e',yil:2019}),P({baslik:'f',yil:2018})];
 assert.deepEqual(recentPublications(rows).map(r=>r.baslik),['d','c','a','e','f']);
});

test('JSON-LD: works point to the person, articles name their journal, count as WriteAction',()=>{
 const id='https://yarenler.org/tr/a/x#person';
 const nodes=workNodes([P({doi:'10.1000/z'}),P({tur:'bildiri',kaynak_adi:'Kongre'}),P({tur:'kitap',yil:null})],id);
 assert.equal(nodes[0]['@type'],'ScholarlyArticle');assert.deepEqual(nodes[0].author,{'@id':id});
 assert.deepEqual(nodes[0].isPartOf,{'@type':'Periodical',name:'Örnek Dergisi'});assert.equal(nodes[0].sameAs,'https://doi.org/10.1000/z');
 assert.deepEqual(nodes[1].publication,{'@type':'PublicationEvent',name:'Kongre'});
 assert.equal(nodes[2]['@type'],'CreativeWork');
 const page=JSON.parse(jsonLd(profilePage({base:'https://yarenler.org',url:'https://yarenler.org/tr/a/x',lang:'tr',name:'Ad',institution:null,knowsAbout:[],sameAs:[],crumbs:[],publicationCount:42,works:nodes})));
 const person=page['@graph'].find(n=>n['@type']==='Person');
 assert.equal(person.agentInteractionStatistic.userInteractionCount,42);
 assert.equal(page['@graph'].filter(n=>n.author?.['@id']===id).length,3);
 assert.equal(nodes[2].datePublished,undefined);
 const none=JSON.parse(jsonLd(profilePage({base:'https://yarenler.org',url:'https://yarenler.org/tr/a/y',lang:'tr',name:'Ad',institution:null,knowsAbout:[],sameAs:[],crumbs:[]})));
 assert.equal(none['@graph'].find(n=>n['@type']==='Person').agentInteractionStatistic,undefined);
});

test('a Turkish profile with publications is always indexable',()=>{
 assert.equal(personIndexable('tr',{hasUnit:false,unitEn:null,fields:[],hasTitle:false,titleEn:null,publications:12}),true);
 assert.equal(personIndexable('en',{hasUnit:true,unitEn:null,fields:[],hasTitle:false,titleEn:null,publications:12}),false);
});

test('TR Dizin links are fixed-host and identifier-only, with existing link priority preserved',()=>{
 assert.deepEqual(publicationLink(P({trdizin_id:'12345'})),{href:'https://search.trdizin.gov.tr/tr/yayin/detay/12345',kind:'TR Dizin'});
 assert.equal(publicationLink(P({trdizin_id:'123/redirect'})),null);
 assert.equal(publicationLink(P({trdizin_id:'123',doi:'10.1234/a'})).kind,'DOI');
 assert.equal(workNodes([P({trdizin_id:'123'})],'person')[0].url,'https://search.trdizin.gov.tr/tr/yayin/detay/123');
});
