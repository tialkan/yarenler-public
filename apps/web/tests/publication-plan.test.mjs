import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDoi,normalizeOpenAlex,normalizePublication,planPublications,newestSourceDate,sourceDate} from '../scripts/publication-plan.mjs';

const U1='c9d15fe9-cde4-5394-a6fb-51228f6d4674',U2='ba34a7fc-ab8d-576b-b178-095efdf970f8';
const pub=(over={})=>({baslik:'Örnek başlık',yil:2024,tur:'makale',doi:null,openalex_id:null,kaynak_adi:'Örnek Dergisi',avesis_yayin_id:U1,avesis_url:`https://avesis.aybu.edu.tr/yayin/${U1}/ornek`,...over});

test('DOI and OpenAlex ids are normalised, anything else is dropped',()=>{
 assert.equal(normalizeDoi('https://doi.org/10.33689/Spormetre.1239362'),'10.33689/spormetre.1239362');
 assert.equal(normalizeDoi('doi: 10.1000/ABC'),'10.1000/abc');
 assert.equal(normalizeDoi('not a doi'),null);
 assert.equal(normalizeDoi(null),null);
 assert.equal(normalizeOpenAlex('W4386858042'),'W4386858042');
 assert.equal(normalizeOpenAlex('https://openalex.org/W1'),null);
});

test('a publication without a title is skipped; foreign or malformed links are not kept',()=>{
 assert.equal(normalizePublication({baslik:'  '}),null);
 const r=normalizePublication(pub({avesis_url:'https://example.org/yayin/x',yil:1800,tur:null,avesis_yayin_id:'nope'}));
 assert.equal(r.avesis_url,null);assert.equal(r.yil,null);assert.equal(r.tur,'bilinmeyen');assert.equal(r.avesis_yayin_id,null);
});

test('the same work on two co-authors pages becomes one publication with two links',()=>{
 const plan=planPublications([{personId:'a',publications:[pub({doi:'10.1000/X'})]},{personId:'b',publications:[pub({avesis_yayin_id:U2,avesis_url:null,doi:'10.1000/x',kaynak_adi:null})]}]);
 assert.equal(plan.publications.length,1);
 assert.equal(plan.publications[0].anahtar,'doi:10.1000/x');
 assert.equal(plan.publications[0].kaynak_adi,'Örnek Dergisi');
 assert.deepEqual(plan.links.map(l=>l.personId).sort(),['a','b']);
});

test('records joined through a shared OpenAlex id keep one DOI and the richest fields',()=>{
 const plan=planPublications([{personId:'a',publications:[pub({openalex_id:'W5',doi:'10.2000/b',kaynak_adi:null}),pub({avesis_yayin_id:U2,openalex_id:'W5',doi:'10.2000/a'})]}]);
 assert.equal(plan.publications.length,1);
 assert.equal(plan.publications[0].anahtar,'doi:10.2000/a');
 assert.equal(plan.publications[0].openalex_id,'W5');
 assert.equal(plan.publications[0].kaynak_adi,'Örnek Dergisi');
 assert.deepEqual(plan.links,[{personId:'a',anahtar:'doi:10.2000/a',sira:0}]);
});

test('without any identifier only the same person, title and year are merged',()=>{
 const bare=over=>pub({avesis_yayin_id:null,avesis_url:null,...over});
 const plan=planPublications([{personId:'a',publications:[bare({}),bare({baslik:'ÖRNEK  başlık'})]},{personId:'b',publications:[bare({})]}]);
 assert.equal(plan.publications.length,2);
 assert.ok(plan.publications.every(p=>p.anahtar.startsWith('baslik:')));
 assert.equal(plan.links.length,2);
});

test('keys are deterministic, so a second import plans the same rows',()=>{
 const input=[{personId:'a',publications:[pub(),pub({avesis_yayin_id:U2,avesis_url:null,openalex_id:'W9'})]}];
 assert.deepEqual(planPublications(input),planPublications(structuredClone(input)));
 assert.deepEqual(planPublications(input).publications.map(p=>p.anahtar).sort(),['avesis:'+U1,'openalex:W9']);
});

test('source dates: only real timestamps count, the newest one wins',()=>{
 assert.equal(sourceDate({kaynak_tarihi:'yesterday'}),null);
 assert.equal(sourceDate({}),null);
 assert.equal(newestSourceDate([{kaynak_tarihi:'2026-10-22T16:45:19.696979+00:00'},{kaynak_tarihi:'2026-10-23T03:42:51+00:00'},{}]),'2026-10-23T03:42:51.000Z');
 assert.equal(newestSourceDate([{}]),null);
});
