import {test} from 'node:test';
import assert from 'node:assert/strict';
import {headingCase} from '../src/server/text-case.ts';
test('Turkish connectors stay lower case except as the first word',()=>{
 assert.equal(headingCase('Ağız, Diş Ve Çene Cerrahisi'),'Ağız, Diş ve Çene Cerrahisi');
 assert.equal(headingCase('Diş Hekimliği Oral Cerrahi Ve Tıp'),'Diş Hekimliği Oral Cerrahi ve Tıp');
 assert.equal(headingCase('İnsan Ve Toplum Bilimleri Fakültesi'),'İnsan ve Toplum Bilimleri Fakültesi');
 assert.equal(headingCase('Bilgisayar İle Öğretim'),'Bilgisayar ile Öğretim');
 assert.equal(headingCase('Kamu Yönetimi Ya Da Siyaset Bilimi'),'Kamu Yönetimi ya da Siyaset Bilimi');
 assert.equal(headingCase('Fizik Veya Kimya'),'Fizik veya Kimya');
 assert.equal(headingCase('Eğitim İçin Teknoloji'),'Eğitim için Teknoloji');
 assert.equal(headingCase('Göç İle İlgili Çalışmalar'),'Göç ile ilgili Çalışmalar');
 assert.equal(headingCase('Ve Sonrası'),'Ve Sonrası');
});
test('English connectors stay lower case except as the first word',()=>{
 assert.equal(headingCase('Science And Technology Of Materials'),'Science and Technology of Materials');
 assert.equal(headingCase('Studies In Education For All'),'Studies in Education for All');
 assert.equal(headingCase('In Vitro Studies'),'In Vitro Studies');
});
test('only whole connector words change; other letters, acronyms and punctuation are kept',()=>{
 for(const kept of ['Venedik Tarihi','Vergi Hukuku','AR-GE VE İNOVASYON','Inovasyon Yönetimi','Forensic Science','Ofis Yönetimi','Andragoji'])assert.equal(headingCase(kept),kept);
 assert.equal(headingCase('Tarih Ve, Coğrafya'),'Tarih ve, Coğrafya');
 assert.equal(headingCase('A Ve Ve B'),'A ve ve B');
 assert.equal(headingCase('Diş Ve Çene Cerrahisi Ve'),'Diş ve Çene Cerrahisi ve');
 assert.equal(headingCase(null),null);assert.equal(headingCase(undefined),undefined);
 const once=headingCase('Ağız, Diş Ve Çene Cerrahisi');assert.equal(headingCase(once),once,'idempotent');
});
