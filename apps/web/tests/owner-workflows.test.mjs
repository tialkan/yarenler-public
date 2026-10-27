import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';
import {checkProtocolPdf,MAX_PROTOCOL_BYTES} from '../src/server/protocol-pdf.ts';
import {preservesFacts,professionalAnnouncement,draftMessage,MEANING_RULE} from '../src/server/announcement-moderation.ts';
import {announcementTitle} from '../src/server/announcement-text.ts';
import {pickSources,storedSources} from '../src/server/web-sources.ts';
test('scanned PDF parser rejects renamed files, oversized files, active actions and attachments',async()=>{
 assert.equal(await checkProtocolPdf(Buffer.from('not PDF')),false);
 assert.equal(await checkProtocolPdf(Buffer.alloc(MAX_PROTOCOL_BYTES+1)),false);
 const d=await PDFDocument.create();d.addPage();assert.equal(await checkProtocolPdf(await d.save()),true);
 d.catalog.set(PDFName.of('OpenAction'),d.context.obj({S:'JavaScript',JS:PDFString.of('app.alert(1)')}));
 assert.equal(await checkProtocolPdf(await d.save()),false);
});
test('professional preparation keeps concrete facts and revision request asks for exact submitted text',()=>{
 const raw='TÜBİTAK 1001 projesi için CFD konusunda araştırmacı arıyorum.';
 const edited='CFD araştırması için akademik işbirliği\n\nTÜBİTAK 1001 başvurusu için CFD alanında çalışan araştırmacılarla birlikte çalışmak istiyorum.';
 assert.equal(preservesFacts(raw,edited),true);
 assert.equal(preservesFacts(raw,edited+' Son tarih 2027.'),false);
 assert.equal(preservesFacts(raw,edited+' https://uydurma.org'),false);
 assert.equal(JSON.parse(draftMessage(raw,true)).mode,'revision');assert.match(MEANING_RULE,/return it exactly unchanged/);
 assert.equal(announcementTitle(edited),'CFD araştırması için akademik işbirliği');
});
test('researcher pages and unrelated personnel pages never become announcement sources, including legacy records',()=>{
 const bad=['https://avesis.metu.edu.tr/kurtulus/projects','https://aybu.edu.tr/havacilik/tr/sayfa/1849/Akademik-Personel','https://example.org/professor'];
 assert.deepEqual(pickSources(bad.map(url=>({url,title:'Personal page'})),bad),[]);
 assert.deepEqual(storedSources(bad.map(url=>({url,baslik:'Personal page'}))),[]);
 assert.equal(pickSources([{url:'https://tubitak.gov.tr/tr/destekler/1001',title:'1001'}],[]).length,1);
});

test('a valid professional body always gets a complete title even if the model omits a heading',()=>{
 const draft='İstatistik ve sosyal ağ analizi alanlarında çalışan araştırmacılarla ortak çalışma yapmak istiyorum.';
 assert.equal(professionalAnnouncement(draft,draft,'tr'),'Akademik araştırma için işbirliği çağrısı\n\n'+draft);
 assert.equal(professionalAnnouncement(draft,draft+' Destek tutarı 9999 TL.','tr'),null);
});
