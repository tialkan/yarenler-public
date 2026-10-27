import {apiBand} from './score-bands';
export type Area={id:string;ad_tr:string|null;ad_en:string|null;kaynak:'avesis'|'kullanici'|'oneri';slug?:string|null};
export type Person={id:string;ad:string;unvan:string|null;birim:{id:string;ad:string;ad_en?:string|null;slug:string}|null;avesis_url:string|null;orcid:string|null;sahiplenildi:boolean;kurum?:{ad:string;ad_en?:string|null;ror?:string|null;aybu_disi:boolean}|null;kaynak?:'avesis'|'orcid_kayit';yol:{tr:string;en:string};alanlar:Area[];interests?:Area[];revision?:string};
export type Match={kisi:Person;affinity:{sicaklik:number;bant:string;bilesenler:{alan:number};gerekceler:{tur:string;metin:string;metin_en?:string}[];mevcut_isbirligi:boolean;ortak_yayin?:number;zayif_eslesme?:boolean}};
export function slug(value:string){return value.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
export function personPath(id:string,name:string,lang='tr'){return `/${lang}/a/${id}-${slug(name)}`;}
/** Field address before migration 0011 ("{uuid}-{name}"); still resolves and redirects to the stored slug. */
export function areaSlug(id:string,name:string){return `${id}-${slug(name)}`;}
/** Display name of a field in a page language: the English source name when it exists. */
export function areaName(a:{ad_tr:string|null;ad_en:string|null},lang:'tr'|'en'|string){return (lang==='en'?a.ad_en||a.ad_tr:a.ad_tr||a.ad_en)||'';}
/** Field page address from the stored slug (migration 0011), legacy form only if none is stored yet. */
export function areaPath(a:{id:string;ad_tr:string|null;ad_en:string|null;slug?:string|null},lang:'tr'|'en'|string){return `/${lang}/${lang==='en'?'field':'alan'}/${a.slug||areaSlug(a.id,a.ad_tr||a.ad_en||'alan')}`;}
export function unitPath(slugValue:string,lang:'tr'|'en'|string){return `/${lang}/${lang==='en'?'unit':'birim'}/${slugValue}`;}
export function score(shared:number,left:number,right:number){const union=left+right-shared;return union>0?Math.round(100*shared/union):0;}
/** API band code; thresholds live in score-bands.ts. */
export function band(value:number){return apiBand(value);}
export function positiveInt(value:string|null,fallback:number,max:number){if(value===null)return fallback;if(!/^\d+$/.test(value))throw new Error('Geçersiz sayı');const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error('Geçersiz sayı');return n;}
export function distinctAreas<T extends {ad_tr:string|null;ad_en:string|null}>(items:T[]):T[]{const seen=new Set<string>();return items.filter(item=>{const key=(item.ad_tr||item.ad_en||'').normalize('NFKC').toLocaleLowerCase('tr-TR').trim().replace(/\s+/g,' ');if(!key||seen.has(key))return false;seen.add(key);return true;});}
/** Remaining time for an announcement: weeks from 14 days, otherwise days. */
export function remainingLabel(ends:string|Date,lang:'tr'|'en',now:Date=new Date()){const days=Math.max(0,Math.ceil((new Date(ends).getTime()-now.getTime())/86400000));if(days>=14){const w=Math.floor(days/7);return lang==='tr'?`${w} hafta kaldı`:`${w} weeks left`;}if(days<=1)return lang==='tr'?'Son gün':'Last day';return lang==='tr'?`${days} gün kaldı`:`${days} days left`;}
/** External link for a person's name: AVESİS when it exists, otherwise the ORCID record. Never a made-up AVESİS URL. */
export function profileLink(p:{avesis_url:string|null;orcid:string|null}){return p.avesis_url||(p.orcid?'https://orcid.org/'+p.orcid:null);}
