import Link from 'next/link';
import {notFound} from 'next/navigation';
import {copy,type Lang} from '@/server/i18n';
import {SmartSearch} from '@/components/smart-search';
export const PAGE_SIZE=20;
export function validLang(value:string):Lang{if(value!=='tr'&&value!=='en')notFound();return value;}
/** Page number from an internal path part ("/alan/x/2" after the proxy rewrote "?page=2"). */
export function pageFrom(part:string|undefined){if(part===undefined)return 1;if(!/^\d{1,5}$/.test(part))notFound();const n=Number(part);if(n<1)notFound();return n;}
export function pageQuery(page:number){return page>1?`?page=${page}`:'';}
export function Search({lang,value='',networkMode=false}:{lang:Lang;value?:string;networkMode?:boolean}){const t=copy[lang];return <SmartSearch networkMode={networkMode} lang={lang} value={value} label={t.searchLabel} placeholder={t.placeholder} button={t.search}/>;}
/** Pagination links use the public "?page=" form; page 1 is the plain address. */
export function Pagination({lang,page,total,path,query=''}:{lang:Lang;page:number;total:number;path:string;query?:string}){
 const href=(n:number)=>{const q=[query,n>1?`page=${n}`:''].filter(Boolean).join('&');return q?`${path}?${q}`:path;};
 return <nav className="pagination" aria-label={lang==='tr'?'Sayfalar':'Pages'}>{page>1&&<Link href={href(page-1)}>← {copy[lang].previous}</Link>}<span>{page} / {Math.max(1,Math.ceil(total/PAGE_SIZE))}</span>{page*PAGE_SIZE<total&&<Link href={href(page+1)}>{copy[lang].next} →</Link>}</nav>;
}
/** "A, B ve C" / "A, B and C". */
export function joinList(items:string[],lang:Lang){if(items.length<2)return items.join('');return items.slice(0,-1).join(', ')+(lang==='tr'?' ve ':' and ')+items.at(-1);}
