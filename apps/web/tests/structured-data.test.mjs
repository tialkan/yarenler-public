import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jsonLd,compact,organization,website,breadcrumb,profilePage,collectionPage,announcementArticle,webPage} from '../src/server/structured-data.ts';
const base='https://yarenler.org';
test('JSON-LD can never close its script element: "<", ">" and "&" are escaped, data round-trips',()=>{
 const evil='Ad </script><script>alert(1)</script> & "tırnak"   son';
 const out=jsonLd({name:evil,nested:[{x:'<!--'}]});
 assert.ok(!out.includes('<'));assert.ok(!out.includes('>'));assert.ok(!out.includes('&'));assert.ok(!/<\/script/i.test(out));assert.ok(!out.includes(' '));
 assert.deepEqual(JSON.parse(out),{name:evil,nested:[{x:'<!--'}]});
});
test('compact drops unknown facts (null, undefined, empty strings and lists)',()=>{
 assert.deepEqual(compact({a:null,b:undefined,c:'',d:[],e:[null,'x'],f:{g:null,h:1}}),{e:['x'],f:{h:1}});
});
test('root Organization has name, url and logo; WebSite has no SearchAction',()=>{
 const org=organization(base),site=website(base);
 assert.equal(org['@type'],'Organization');assert.equal(org.name,'Yarenler');assert.equal(org.url,base+'/tr');assert.equal(org.logo.url,base+'/icon-512.png');
 assert.equal(site['@type'],'WebSite');assert.equal(site.publisher['@id'],org['@id']);assert.equal('potentialAction' in site,false);
});
test('BreadcrumbList positions start at 1 and carry absolute item URLs',()=>{
 const b=breadcrumb([{name:'Yarenler',url:base+'/tr'},{name:'Keşfet',url:base+'/tr/kesfet'}]);
 assert.deepEqual(b.itemListElement.map(i=>[i.position,i.name,i.item]),[[1,'Yarenler',base+'/tr'],[2,'Keşfet',base+'/tr/kesfet']]);
});
test('ProfilePage: Person as mainEntity, real institution with ROR and unit, canonical field names',()=>{
 const url=base+'/tr/a/abc123-ayse-kara';
 const data=JSON.parse(jsonLd(profilePage({base,url,lang:'tr',name:'Örnek Araştırmacı',jobTitle:'Doç. Dr.',institution:{name:'Ankara Yıldırım Beyazıt Üniversitesi',ror:'05ryemn72',university:true},unit:'Bilgisayar Mühendisliği',knowsAbout:['Yapay Zekâ','Yapay Zekâ','Robotik'],sameAs:['https://avesis.aybu.edu.tr/ornek-kisi',null,'https://orcid.org/0000-0000-0000-1100'],dateModified:'2026-10-23T10:00:00.000Z',crumbs:[{name:'Yarenler',url:base+'/tr'},{name:'Örnek Araştırmacı',url}]})));
 const [page,person,crumbs]=data['@graph'];
 assert.equal(page['@type'],'ProfilePage');assert.equal(page.mainEntity['@id'],person['@id']);assert.equal(page.dateModified,'2026-10-23T10:00:00.000Z');
 assert.equal(person['@type'],'Person');assert.equal(person.jobTitle,'Doç. Dr.');
 assert.deepEqual(person.affiliation,{'@type':'CollegeOrUniversity',name:'Ankara Yıldırım Beyazıt Üniversitesi',sameAs:'https://ror.org/05ryemn72',department:{'@type':'Organization',name:'Bilgisayar Mühendisliği'}});
 assert.deepEqual(person.knowsAbout,['Yapay Zekâ','Robotik']);
 assert.deepEqual(person.sameAs,['https://avesis.aybu.edu.tr/ornek-kisi','https://orcid.org/0000-0000-0000-1100']);
 assert.equal(crumbs['@type'],'BreadcrumbList');
});
test('ORCID registrant outside AYBÜ: affiliation is the declared organisation, never AYBÜ',()=>{
 const data=profilePage({base,url:base+'/tr/a/x',lang:'en',name:'John Smith',institution:{name:'Example Research Institute',ror:null,university:false},knowsAbout:[],sameAs:[],crumbs:[]});
 const person=JSON.parse(jsonLd(data))['@graph'][1];
 assert.deepEqual(person.affiliation,{'@type':'Organization',name:'Example Research Institute'});
});
test('field and unit pages: CollectionPage with an ItemList of at most 50 researchers',()=>{
 const people=Array.from({length:70},(_,i)=>({name:'Kişi '+i,url:base+'/tr/a/k'+i}));
 const [page,crumbs]=JSON.parse(jsonLd(collectionPage({base,url:base+'/tr/alan/x',lang:'tr',name:'X',description:'d',total:70,people,crumbs:[{name:'Yarenler',url:base+'/tr'}]})))['@graph'];
 assert.equal(page['@type'],'CollectionPage');assert.equal(page.mainEntity['@type'],'ItemList');assert.equal(page.mainEntity.numberOfItems,70);
 assert.equal(page.mainEntity.itemListElement.length,50);assert.equal(page.mainEntity.itemListElement[0].position,1);assert.equal(page.mainEntity.itemListElement[49].name,'Kişi 49');
 assert.equal(crumbs.itemListElement.length,1);
});
test('announcement: Article with publication and expiry dates, Person author, Organization publisher',()=>{
 const url=base+'/tr/duyuru/99ef0cd324-baslik';
 const [article]=JSON.parse(jsonLd(announcementArticle({base,url,lang:'tr',headline:'Başlık',text:'Metin </script>',datePublished:'2026-10-01T00:00:00.000Z',expires:'2026-11-01T00:00:00.000Z',author:{name:'Örnek Araştırmacı',url:base+'/tr/a/x'},about:[{name:'Toksikoloji',url:base+'/tr/alan/toksikoloji'}],crumbs:[]})))['@graph'];
 assert.equal(article['@type'],'Article');assert.equal(article.datePublished,'2026-10-01T00:00:00.000Z');assert.equal(article.dateModified,'2026-10-01T00:00:00.000Z');assert.equal(article.expires,'2026-11-01T00:00:00.000Z');
 assert.deepEqual(article.author,{'@type':'Person',name:'Örnek Araştırmacı',url:base+'/tr/a/x'});assert.equal(article.publisher['@id'],base+'/#organization');
 assert.equal(article.articleBody,'Metin </script>');assert.equal(article.about[0].name,'Toksikoloji');
});
test('plain pages carry WebPage (or AboutPage) and a breadcrumb',()=>{
 const [page,crumbs]=webPage({base,url:base+'/tr/hakkinda',lang:'tr',name:'Hakkında',description:'d',type:'AboutPage',crumbs:[{name:'Yarenler',url:base+'/tr'},{name:'Hakkında',url:base+'/tr/hakkinda'}]})['@graph'];
 assert.equal(page['@type'],'AboutPage');assert.equal(crumbs.itemListElement[1].position,2);
});
