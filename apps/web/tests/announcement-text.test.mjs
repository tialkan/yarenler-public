import {test} from 'node:test';
import assert from 'node:assert/strict';
import {announcementTitle,announcementSlug,announcementPath,announcementIdFrom,announcementDescription,clip} from '../src/server/announcement-text.ts';
test('title is the first sentence, without the closing full stop',()=>{
 assert.equal(announcementTitle('TÜBİTAK 1001 projesi için derin öğrenme alanında ortak arıyorum. Meme kanseri taraması.'),'TÜBİTAK 1001 projesi için derin öğrenme alanında ortak arıyorum');
 assert.equal(announcementTitle('- Görüntü işleme ortağı arıyorum!\nAyrıntılar aşağıda.'),'Görüntü işleme ortağı arıyorum');
});
test('very short openings are joined with the next sentence; long titles are clipped at a word',()=>{
 assert.equal(announcementTitle('Merhaba. Sosyal ağ analizi için ortak arıyorum. Detaylar.'),'Merhaba. Sosyal ağ analizi için ortak arıyorum');
 const long=announcementTitle('Bu duyuru çok uzun bir ilk cümle içeriyor ve doksan karakteri aşan bir başlık üretmemesi için kelime sınırında kesilmesi gerekiyor elbette.');
 assert.ok([...long].length<=91,long);assert.ok(long.endsWith('…'));assert.ok(!/\s…$/.test(long));
 assert.equal(clip('kısa metin',50),'kısa metin');
});
test('address: /tr/duyuru/{id}-{slug} and /en/announcement/{id}-{slug}; id parsing',()=>{
 const text='Yapay zekâ ile göç çalışmaları için ortak arıyorum.';
 assert.equal(announcementSlug(text),'yapay-zeka-ile-goc-calismalari-icin-ortak-ariyorum');
 assert.equal(announcementPath('tr','99ef0cd324',text),'/tr/duyuru/99ef0cd324-yapay-zeka-ile-goc-calismalari-icin-ortak-ariyorum');
 assert.equal(announcementPath('en','99ef0cd324',text),'/en/announcement/99ef0cd324-yapay-zeka-ile-goc-calismalari-icin-ortak-ariyorum');
 assert.equal(announcementIdFrom('99ef0cd324-yapay-zeka'),'99ef0cd324');
 assert.equal(announcementIdFrom('99ef0cd324'),'99ef0cd324');
 assert.equal(announcementIdFrom('99EF0cd324-x'),null);
 assert.equal(announcementIdFrom('abc'),null);
 assert.ok([...announcementDescription('a '.repeat(200))].length<=156);
});
