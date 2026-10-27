/**
 * Heading case for unit and field names: sources capitalise connectors ("Ağız, Diş Ve Çene Cerrahisi").
 * Except for the first word, Turkish "ve", "ile", "ya da", "veya", "için", "ile ilgili" and English
 * "and", "of", "in", "for" are written in lower case; every other letter is kept as it is.
 * Same rule as db/migrations/0010_heading_case.sql and pipeline metin.baslik_duzeni.
 */
const CONNECTORS:Record<string,string>={'İle İlgili':'ile ilgili','Ile Ilgili':'ile ilgili','Ya Da':'ya da','Veya':'veya','Ve':'ve','İle':'ile','Ile':'ile','İçin':'için','Için':'için','And':'and','Of':'of','In':'in','For':'for'};
const PATTERN=new RegExp(`(\\s)(${Object.keys(CONNECTORS).join('|')})(?=[\\s,;:.)]|$)`,'gu');
export function headingCase<T extends string|null|undefined>(value:T):T{return (typeof value==='string'?value.replace(/Dijital Oyun Tasarimi/gu,'Dijital Oyun Tasarımı').replace(/ Pr\.$/u,' Programı').replace(PATTERN,(_match:string,space:string,word:string)=>space+CONNECTORS[word]):value) as T;}
