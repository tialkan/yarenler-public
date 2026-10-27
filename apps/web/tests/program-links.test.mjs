import {test} from 'node:test';
import assert from 'node:assert/strict';
import {programLinks,safeOfficialUrl} from '../src/server/program-links.ts';
test('program codes map to verified official pages only',()=>{
 const links=programLinks('TÜBİTAK 3005 projem için merkez bankası dijital paraları üzerine çalışan bir hoca arıyorum');
 assert.deepEqual(links.map(l=>l.id),['3005','cbdc']);
 assert.ok(links.every(l=>safeOfficialUrl(l.url)));
 assert.deepEqual(programLinks('1002-B ve 2209-B başvurusu').map(l=>l.id),['1002-b','2209-b']);
 assert.deepEqual(programLinks('Horizon Europe ve Erasmus+ ortaklığı').map(l=>l.id),['horizon','erasmus']);
 assert.deepEqual(programLinks('Telefon 5551001234, oda 10015'),[]);
 assert.equal(safeOfficialUrl('http://tubitak.gov.tr/x'),false);
 assert.equal(safeOfficialUrl('https://tubitak.gov.tr.evil.com/x'),false);
});
