/**
 * Proximity bands shown instead of exact scores ("97/100" looks more precise than it is).
 * The thresholds live only here; the about page, the API band codes and every label read them.
 * Pure module, shared with tests and client components.
 */
export type Lang='tr'|'en';
export type BandKey='cok_yakin'|'yakin'|'ilgili';
/** Lower bounds on the 0-100 field proximity score, highest band first. */
export const SCORE_BANDS:readonly {key:BandKey;min:number;tr:string;en:string}[]=[
 {key:'cok_yakin',min:85,tr:'Çok yakın',en:'Very close'},
 {key:'yakin',min:65,tr:'Yakın',en:'Close'},
 {key:'ilgili',min:0,tr:'İlgili',en:'Related'},
];
/** A network link needs at least this score (each researcher keeps up to four links above it). */
export const NETWORK_MIN_SCORE=20;
/** API band codes (contracts/openapi.yaml Affinity.bant) from the same thresholds. */
export function apiBand(score:number):'cok_sicak'|'sicak'|'ilik'|'serin'{const b=scoreBand(score).key;return b==='cok_yakin'?'cok_sicak':b==='yakin'?'sicak':score>=NETWORK_MIN_SCORE?'ilik':'serin';}
/** Every shown match has at least one shared field, so anything under "Yakın" is "İlgili". */
export function scoreBand(score:number){return SCORE_BANDS.find(b=>score>=b.min)||SCORE_BANDS[SCORE_BANDS.length-1];}
export function bandLabel(score:number,lang:Lang|string){const b=scoreBand(score);return lang==='en'?b.en:b.tr;}
/** Raw score only for a title attribute (hover) and the method text. */
export function bandTitle(score:number,lang:Lang|string){return lang==='en'?`Field proximity score ${score}/100`:`Alan yakınlığı puanı ${score}/100`;}
/** Band ranges for the method text: "85 ve üstü", "65-84", "64 ve altı". */
export function bandRanges(lang:Lang|string){
 return SCORE_BANDS.map((b,i)=>{const upper=i>0?SCORE_BANDS[i-1].min-1:100,label=lang==='en'?b.en:b.tr;
  const range=i===0?(lang==='en'?`${b.min} and above`:`${b.min} ve üstü`):b.min>0?`${b.min}-${upper}`:(lang==='en'?`${upper} and below`:`${upper} ve altı`);
  return {key:b.key,label,range};});
}
