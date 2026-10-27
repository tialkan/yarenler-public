import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileTitle,profileDescription,fieldSummary,sentences,schemeList,unitSummary} from '../src/server/seo-text.ts';
test('profile title names the unit after AYBÜ, or the declared institution outside AYBÜ',()=>{
 assert.equal(profileTitle('Ayşe Kara','Bilgisayar Mühendisliği'),'Ayşe Kara · AYBÜ Bilgisayar Mühendisliği');
 assert.equal(profileTitle('Ayşe Kara',null),'Ayşe Kara · AYBÜ');
 assert.equal(profileTitle('John Smith',null,{name:'University of Oxford',outside:true}),'John Smith · University of Oxford');
});
test('profile descriptions are natural sentences in Turkish and English',()=>{
 assert.equal(profileDescription({lang:'tr',name:'Ayşe Kara',title:'Prof. Dr.',unit:'Bilgisayar Mühendisliği',fields:['Yapay Zekâ','Robotik']}),'Prof. Dr. Ayşe Kara, AYBÜ Bilgisayar Mühendisliği bölümünde çalışıyor. Çalışma alanları: Yapay Zekâ, Robotik. Ortak alanlardan potansiyel işbirlikleri.');
 assert.equal(profileDescription({lang:'en',name:'Ayşe Kara',title:'Prof. Dr.',unit:'Bilgisayar Mühendisliği',fields:['Robotics']}),'Prof. Dr. Ayşe Kara works in Bilgisayar Mühendisliği at AYBU. Research field: Robotics. Potential collaborations through shared fields.');
 assert.equal(profileDescription({lang:'tr',name:'Ali Veli',unit:'Tıp Fakültesi',fields:['Kardiyoloji']}),'Ali Veli, AYBÜ Tıp Fakültesi bünyesinde çalışıyor. Çalışma alanı: Kardiyoloji. Ortak alanlardan potansiyel işbirlikleri.');
 assert.equal(profileDescription({lang:'tr',name:'Ali Veli',title:'Arş. Gör.',fields:[]}),'Arş. Gör. Ali Veli, AYBÜ’de çalışıyor. Ortak alanlardan potansiyel işbirlikleri.');
 assert.match(profileDescription({lang:'tr',name:'John Smith',institution:{name:'University of Oxford',outside:true},fields:['History']}),/^John Smith, University of Oxford bünyesinde çalışıyor\./);
 assert.match(profileDescription({lang:'en',name:'John Smith',institution:{name:'University of Oxford',outside:true},fields:[]}),/^John Smith works at University of Oxford\./);
});
test('descriptions stay within 160 characters, prefer fields over the tagline and never double full stops',()=>{
 const long=profileDescription({lang:'tr',name:'Çok Uzun Adlı Bir Araştırmacı',title:'Dr. Öğr. Üyesi',unit:'Ağız, Diş ve Çene Cerrahisi Anabilim Dalı',fields:['Diş Hekimliği, Oral Cerrahi ve Tıp','Ağız, Diş ve Çene Cerrahisi Uygulamaları','Sağlık Bilimleri','Biyomalzeme']});
 assert.ok([...long].length<=160,long);
 const fields=profileDescription({lang:'tr',name:'Ayşe Kara',title:'Doç. Dr.',unit:'Bilgisayar Mühendisliği',fields:['Yapay Zekâ','Makine Öğrenmesi','Doğal Dil İşleme','Bilgi Sistemleri']});
 assert.match(fields,/Doğal Dil İşleme\.$/);assert.doesNotMatch(fields,/Bilgi Sistemleri/);
 assert.match(profileDescription({lang:'tr',name:'A',fields:['Diş Hekimliği, Oral Cerrahi ve Tıp','Tıp']}),/Tıp; Tıp/);
 assert.ok(!/\.\./.test(profileDescription({lang:'tr',name:'A',title:'Doç. Dr.',unit:'Tıp.',fields:['Kardiyoloji.']})));
 assert.equal(sentences(['a.','',null,'b']),'a. b.');
});
test('field summary uses only counted facts',()=>{
 const s=fieldSummary('tr',{name:'Robotik',schemes:['avesis'],people:12,units:3,topUnit:'Mühendislik Fakültesi'});
 assert.match(s,/12 araştırmacının/);assert.match(s,/3 farklı birime/);assert.match(s,/Mühendislik Fakültesi/);
 assert.doesNotMatch(fieldSummary('tr',{name:'X',people:1,units:1}),/birim|Kaynak/);
});
test('merged source classifications are listed readably in a fixed order',()=>{
 assert.equal(schemeList(['scopus','avesis','wos','avesis',null]),'AVESİS, WoS, Scopus');
 assert.doesNotMatch(fieldSummary('tr',{name:'R',schemes:['wos','scopus','avesis'],people:2,units:1}),/Kaynak:/);
 assert.doesNotMatch(fieldSummary('en',{name:'R',schemes:['openalex'],people:2,units:1}),/Source:/);
});
test('unit paragraph: researcher count, frequent fields and related units, from data only',()=>{
 assert.equal(unitSummary('tr',{name:'Diş Hekimliği Fakültesi',people:143,topFields:['Klinik Tıp','Ortodonti','Pedodonti'],related:['İç Hastalıkları']}),"Diş Hekimliği Fakültesi, Yarenler'de 143 araştırmacıyla yer alıyor. En sık çalışma alanları: Klinik Tıp, Ortodonti ve Pedodonti. Alan ortaklığı en yüksek birim: İç Hastalıkları.");
 assert.equal(unitSummary('en',{name:'Tıp Fakültesi',people:1,topFields:['Anatomy'],related:[]}),'Tıp Fakültesi has 1 researcher on Yarenler. Most frequent research field: Anatomy.');
 assert.equal(unitSummary('tr',{name:'X',people:5,topFields:['Ağız, Diş ve Çene','Kardiyoloji'],related:[]}),"X, Yarenler'de 5 araştırmacıyla yer alıyor. En sık çalışma alanları: Ağız, Diş ve Çene; Kardiyoloji.");
});
