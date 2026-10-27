/**
 * Verified official program pages (checked 23 October 2026 on tubitak.gov.tr, ec.europa.eu, tcmb.gov.tr).
 * Links come only from this dictionary, never from model output. Add an entry only after checking the live official page.
 */
export type ProgramLink={id:string;label:string;url:string};
const T='https://tubitak.gov.tr/tr/';
const ENTRIES:{id:string;label:string;url:string;pattern:RegExp}[]=[
 {id:'1001',label:'TÜBİTAK 1001 Bilimsel ve Teknolojik Araştırma Projelerini Destekleme Programı',url:T+'destekler/akademik/ulusal-destek-programlari/1001-bilimsel-ve-teknolojik-arastirma-projelerini-destekleme-programi',pattern:/\b1001\b/},
 {id:'1002',label:'TÜBİTAK 1002-A Hızlı Destek Modülü',url:T+'destekler/akademik/ulusal-destek-programlari/1002-hizli-destek-modulu',pattern:/\b1002(?![- ]?b\b)/i},
 {id:'1002-b',label:'TÜBİTAK 1002-B Acil Destek Modülü',url:T+'destekler/akademik/ulusal-destek-programlari/1002-b-acil-destek-modulu',pattern:/\b1002[- ]?b\b/i},
 {id:'1003',label:'TÜBİTAK 1003 Öncelikli Alanlar Ar-Ge Projeleri Destekleme Programı',url:T+'destekler/akademik/ulusal-destek-programlari/1003-oncelikli-alanlar-ar-ge-projeleri-destekleme-programi',pattern:/\b1003\b/},
 {id:'1005',label:'TÜBİTAK 1005 Ulusal Yeni Fikirler ve Ürünler Araştırma Destek Programı',url:T+'destekler/akademik/ulusal-destek-programlari/1005-ulusal-yeni-fikirler-ve-urunler-arastirma-destek-programi',pattern:/\b1005\b/},
 {id:'1501',label:'TÜBİTAK 1501 Sanayi Ar-Ge Projeleri Destekleme Programı',url:T+'destekler/sanayi/ulusal-destek-programlari/1501-tubitak-sanayi-ar-ge-projeleri-destekleme-programi',pattern:/\b1501\b/},
 {id:'1505',label:'TÜBİTAK 1505 Üniversite-Sanayi İşbirliği Destek Programı',url:T+'destekler/sanayi/ulusal-destek-programlari/1505-universite-sanayi-isbirligi-destek-programi',pattern:/\b1505\b/},
 {id:'1507',label:'TÜBİTAK 1507 KOBİ Ar-Ge Başlangıç Destek Programı',url:T+'destekler/sanayi/ulusal-destek-programlari/1507-tubitak-kobi-ar-ge-baslangic-destek-programi',pattern:/\b1507\b/},
 {id:'2209',label:'TÜBİTAK 2209-A Üniversite Öğrencileri Araştırma Projeleri Destekleme Programı',url:T+'burslar/lisans-onlisans/destek-programlari/2209-universite-ogrencileri-arastirma-projeleri-destekleme-programi',pattern:/\b2209(?![- ]?b\b)/i},
 {id:'2209-b',label:'TÜBİTAK 2209-B Üniversite Öğrencileri Sanayiye Yönelik Araştırma Projeleri Desteği Programı',url:T+'burslar/lisans-onlisans/destek-programlari/2209-b-universite-ogrencileri-sanayiye-yonelik-arastirma-projeleri-destegi-programi',pattern:/\b2209[- ]?b\b/i},
 {id:'2219',label:'TÜBİTAK 2219 Yurt Dışı Doktora Sonrası Araştırma Burs Programı',url:T+'burslar/doktora-sonrasi/arastirma-burs-programlari/2219-yurt-disi-doktora-sonrasi-arastirma-burs-programi',pattern:/\b2219\b/},
 {id:'3001',label:'TÜBİTAK 3001 Başlangıç Ar-Ge Projeleri Destekleme Programı',url:T+'destekler/akademik/ulusal-destek-programlari/3001-baslangic-ar-ge-projeleri-destekleme-programi',pattern:/\b3001\b/},
 {id:'3005',label:'TÜBİTAK 3005-A Politika Geliştirme Modülü',url:T+'destekler/akademik/ulusal-destek-programlari/3005-politika-gelistirme-modulu',pattern:/\b3005(?![- ]?b\b)/i},
 {id:'3005-b',label:'TÜBİTAK 3005-B Teknolojik İlerlemelerin Toplumsal Etkileri Modülü',url:T+'destekler/akademik/ulusal-destek-programlari/3005-b-teknolojik-ilerlemelerin-toplumsal-etkileri-modulu',pattern:/\b3005[- ]?b\b/i},
 {id:'3501',label:'TÜBİTAK 3501 Kariyer Geliştirme Programı',url:T+'destekler/akademik/ulusal-destek-programlari/3501-kariyer-gelistirme-programi',pattern:/\b3501\b/},
 {id:'horizon',label:'Horizon Europe (European Commission)',url:'https://research-and-innovation.ec.europa.eu/funding/funding-opportunities/funding-programmes-and-open-calls/horizon-europe_en',pattern:/\b(horizon europe|horizon avrupa|ufuk avrupa)\b/i},
 {id:'erasmus',label:'Erasmus+ (European Commission)',url:'https://erasmus-plus.ec.europa.eu/',pattern:/\berasmus\s*\+|\berasmus plus\b/i},
 {id:'cbdc',label:'TCMB Merkezin Güncesi: Dijital Türk Lirası, Fayda ve Fırsatlar',url:'https://tcmb.gov.tr/wps/wcm/connect/blog/tr/main+menu/analizler/dijital+turk+lirasi+fayda+ve+firsatlar',pattern:/\b(cbdc|dijital t[üu]rk liras|merkez bankas[ıi] dijital para|central bank digital currenc)/i},
];
export const ALLOWED_HOSTS=new Set(['tubitak.gov.tr','research-and-innovation.ec.europa.eu','erasmus-plus.ec.europa.eu','tcmb.gov.tr']);
export function safeOfficialUrl(url:string){try{const u=new URL(url);return u.protocol==='https:'&&ALLOWED_HOSTS.has(u.hostname);}catch{return false;}}
/** Programs and concepts mentioned in an announcement, in dictionary order, deduplicated. */
export function programLinks(text:string):ProgramLink[]{const value=text.normalize('NFC');return ENTRIES.filter(e=>e.pattern.test(value)&&safeOfficialUrl(e.url)).map(({id,label,url})=>({id,label,url}));}
