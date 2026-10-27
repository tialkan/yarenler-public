import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rssFeed,xml} from '../src/server/rss.ts';
/** Minimal well-formedness check: balanced tags, no stray "&" or "<" in text. */
function wellFormed(doc){
 const body=doc.replace(/^<\?xml[^?]*\?>\s*/,'');const stack=[];const re=/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g;let m;let rest=body;
 while((m=re.exec(body))){rest='';if(m[5]!==undefined){if(/&(?!(amp|lt|gt|quot|apos);)/.test(m[5])||m[5].includes('<'))return 'bad text: '+m[5].slice(0,40);continue;}
  if(/&(?!(amp|lt|gt|quot|apos);)/.test(m[3]))return 'bad attribute';
  if(m[4])continue;if(m[1]){if(stack.pop()!==m[2])return 'unbalanced '+m[2];}else stack.push(m[2]);}
 return stack.length?'unclosed '+stack.join(','):rest===''?true:'trailing';
}
const items=[{title:'TÜBİTAK 1001 için ortak <aranıyor> & "hızlı"',link:'https://yarenler.org/tr/duyuru/99ef0cd324-tubitak',guid:'https://yarenler.org/tr/duyuru/99ef0cd324-tubitak',description:'Metin </script>\u0001 & devamı',pubDate:new Date('2026-10-23T10:00:00Z'),creator:'Ayşe Kara'}];
test('RSS 2.0 feed is well-formed XML with channel, self link and items',()=>{
 const doc=rssFeed({title:'Yarenler · Duyurular',link:'https://yarenler.org/tr/duyurular',self:'https://yarenler.org/tr/duyurular/rss.xml',description:'Ortak proje fikirleri',language:'tr',items});
 assert.equal(wellFormed(doc),true);
 assert.match(doc,/^<\?xml version="1.0" encoding="UTF-8"\?>/);
 assert.match(doc,/<rss version="2.0" xmlns:atom="http:\/\/www.w3.org\/2005\/Atom" xmlns:dc="http:\/\/purl.org\/dc\/elements\/1.1\/">/);
 for(const tag of ['title','link','description','language','lastBuildDate'])assert.match(doc,new RegExp(`<channel>.*<${tag}>`,'s'));
 assert.match(doc,/<atom:link href="https:\/\/yarenler.org\/tr\/duyurular\/rss.xml" rel="self" type="application\/rss\+xml"\/>/);
 assert.match(doc,/<language>tr-TR<\/language>/);
 assert.match(doc,/<pubDate>Fri, 23 Oct 2026 10:00:00 GMT<\/pubDate>/);
 assert.match(doc,/<guid isPermaLink="true">https:\/\/yarenler.org\/tr\/duyuru\/99ef0cd324-tubitak<\/guid>/);
 assert.match(doc,/<dc:creator>Ayşe Kara<\/dc:creator>/);
 assert.ok(!doc.includes('\u0001'));assert.ok(!doc.includes('</script>'));
});
test('an empty feed is still valid',()=>{assert.equal(wellFormed(rssFeed({title:'t',link:'l',self:'s',description:'d',language:'en',items:[]})),true);});
test('xml() escapes the five XML entities and drops control characters',()=>{assert.equal(xml(`a&b<c>d"e'f\u0007`),'a&amp;b&lt;c&gt;d&quot;e&apos;f');});
