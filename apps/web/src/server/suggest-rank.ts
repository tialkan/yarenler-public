/** Pure ordering rules for the three-letter autocomplete, shared with regression tests. */
export type SuggestItem={kind:'person'|'field';id:string;label:string;detail:string;url:string};
const fold=(value:string)=>value.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const words=(value:string)=>fold(value).split(' ').filter(Boolean);
/** Every typed word must start a word of the label (Turkish folded): "Tarık İsmet" never reaches "İslam Tarihi". */
export function prefixMatches(label:string,query:string){const target=words(label),typed=words(query).filter(w=>w.length>=2);return typed.length>0&&typed.every(q=>target.some(t=>t.startsWith(q)));}
export function rankSuggestions(query:string,persons:SuggestItem[],fields:SuggestItem[],limit=8,enoughPeople=3){
 const named=persons.filter(p=>prefixMatches(p.label,query)),others=persons.filter(p=>!named.includes(p));
 const exact=fold(query);named.sort((a,b)=>Number(fold(b.label)===exact)-Number(fold(a.label)===exact));
 const relatedFields=named.length>=enoughPeople?[]:fields.filter(f=>prefixMatches(f.label,query));
 return [...named,...relatedFields,...(named.length?[]:others)].slice(0,limit);
}
