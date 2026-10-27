/** Pure metadata text builders, shared with regression tests. */
const clean=(value:string|null|undefined)=>(value||'').replace(/\s+/g,' ').trim().replace(/[.\s]+$/,'');
const length=(value:string)=>[...value].length;
const squash=(value:string|null|undefined)=>(value||'').replace(/\s+/g,' ').trim();
export type Institution={name:string;outside:boolean}|null|undefined;
/** "Ad Soyad · AYBÜ Birim" (or the declared institution outside AYBÜ); the layout template appends " | Yarenler". */
export function profileTitle(name:string,unit?:string|null,institution?:Institution){const u=clean(unit),place=institution?.outside?clean(institution.name):'AYBÜ';return `${clean(name)} · ${place}${u?' '+u:''}`;}
/** Joins non-empty sentences with exactly one full stop each ("Arş. Gör." never becomes "Arş. Gör.."). */
export function sentences(parts:(string|null|undefined)[]){return parts.map(clean).filter(Boolean).map(part=>part+'.').join(' ');}
/** Unit names that already name an organisation read "X bünyesinde"; departments read "X bölümünde". */
const ORGANISATION=/(Fakültesi|Yüksekokulu|Enstitüsü|Müdürlüğü|Koordinatörlüğü|Merkezi|Rektörlüğü|Bölümü|Anabilim Dalı|Bilim Dalı|Programı|Okulu|Konservatuvarı|Başkanlığı|Birimi|Ofisi)$/u;
/**
 * Natural profile description, 160 characters at most when possible:
 * "Prof. Dr. Ad Soyad, AYBÜ Birim bölümünde çalışıyor. Çalışma alanları: A, B, C. Ortak alanlardan potansiyel işbirlikleri."
 */
export function profileDescription({lang,name,title,unit,institution,fields,max=160}:{lang:'tr'|'en';name:string;title?:string|null;unit?:string|null;institution?:Institution;fields:string[];max?:number}){
 const person=[squash(title),clean(name)].filter(Boolean).join(' '),u=clean(unit),outside=institution?.outside?clean(institution.name):null;
 const where=lang==='tr'
  ?(outside?`${outside}${u?' '+u:''} bünyesinde çalışıyor`:u?`AYBÜ ${u} ${ORGANISATION.test(u)?'bünyesinde':'bölümünde'} çalışıyor`:'AYBÜ’de çalışıyor')
  :(outside?`works ${u?`in ${u} `:''}at ${outside}`:u?`works in ${u} at AYBU`:'works at AYBU');
 const first=lang==='tr'?`${person}, ${where}`:`${person} ${where}`;
 const tagline=lang==='tr'?'Ortak alanlardan potansiyel işbirlikleri':'Potential collaborations through shared fields';
 const unique=[...new Set(fields.map(clean).filter(Boolean))];
 const fieldSentence=(list:string[])=>list.length?(lang==='tr'?(list.length===1?'Çalışma alanı: ':'Çalışma alanları: '):(list.length===1?'Research field: ':'Research fields: '))+list.join(list.some(field=>field.includes(','))?'; ':', '):null;
 // Prefer more fields over the generic tagline; keep within max characters when any variant fits.
 const variants:string[]=[];
 for(let count=Math.min(3,unique.length);count>=0;count--){variants.push(sentences([first,fieldSentence(unique.slice(0,count)),tagline]));variants.push(sentences([first,fieldSentence(unique.slice(0,count))]));}
 return variants.find(text=>length(text)<=max)??variants.at(-1)!;
}
const schemes:Record<string,string>={avesis:'AVESİS',wos:'WoS',scopus:'Scopus',openalex:'OpenAlex',yarenler:'Yarenler'};
const ORDER=['avesis','wos','scopus','openalex','yarenler'];
export function schemeLabel(value?:string|null){return value?schemes[value]||value:null;}
/** "AVESİS, WoS, Scopus": the classifications merged into one canonical field, in a fixed order. */
export function schemeList(values:(string|null|undefined)[]){return [...new Set(values.filter((v):v is string=>Boolean(v)))].sort((a,b)=>(ORDER.indexOf(a)+1||99)-(ORDER.indexOf(b)+1||99)).map(v=>schemeLabel(v)!).join(', ');}
export function fieldSummary(lang:'tr'|'en',{name,people,units,topUnit}:{name:string;schemes?:(string|null|undefined)[];people:number;units:number;topUnit?:string|null}){
 if(lang==='en')return sentences([`${name} appears in the profiles of ${people} researcher${people===1?'':'s'}${units>1?` across ${units} units`:''} on Yarenler`,topUnit&&units>1?`It is most frequent in ${topUnit}`:null,null]);
 return sentences([`${name}, Yarenler'de ${people} araştırmacının profilinde yer alıyor${units>1?` ve ${units} farklı birime yayılıyor`:''}`,topUnit&&units>1?`En sık görüldüğü birim ${topUnit}`:null,null]);
}
/** "A, B ve C"; names that already contain a comma or a connector are separated with semicolons. */
const listJoin=(items:string[],lang:'tr'|'en')=>{if(items.length<2)return items.join('');if(items.some(i=>/,| ve | and /.test(i)))return items.join('; ');return items.slice(0,-1).join(', ')+(lang==='tr'?' ve ':' and ')+items.at(-1);};
/**
 * Data based unit paragraph: researcher count, the most frequent fields and the units sharing the most
 * fields. Every number and name comes from stored profile relations.
 */
export function unitSummary(lang:'tr'|'en',{name,people,topFields,related}:{name:string;people:number;topFields:string[];related:string[]}){
 if(lang==='en')return sentences([`${name} has ${people} researcher${people===1?'':'s'} on Yarenler`,topFields.length?`${topFields.length===1?'Most frequent research field':'Most frequent research fields'}: ${listJoin(topFields,'en')}`:null,related.length?`${related.length===1?'Unit':'Units'} sharing the most fields: ${listJoin(related,'en')}`:null]);
 return sentences([`${name}, Yarenler'de ${people} araştırmacıyla yer alıyor`,topFields.length?`${topFields.length===1?'En sık çalışma alanı':'En sık çalışma alanları'}: ${listJoin(topFields,'tr')}`:null,related.length?`Alan ortaklığı en yüksek ${related.length===1?'birim':'birimler'}: ${listJoin(related,'tr')}`:null]);
}
