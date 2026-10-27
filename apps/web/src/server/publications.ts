/**
 * Publications on a profile: counts by type, the five most recent works and their links.
 * Pure module, shared with tests. Data comes from effective, owner-visible source publications.
 */
export type Lang='tr'|'en';
export type PublicationRow={baslik:string;yil:number|null;tur:string|null;kaynak_adi:string|null;doi:string|null;openalex_id:string|null;avesis_url:string|null;trdizin_id?:string|null};
export type TypeCount={tur:string|null;count:number};
/** Display groups in a fixed order; unknown or rare AVESİS types fall into "Diğer". */
export const PUBLICATION_GROUPS:readonly {key:string;types:readonly string[];tr:string;en:string}[]=[
 {key:'makale',types:['makale'],tr:'Makale',en:'Articles'},
 {key:'bildiri',types:['bildiri'],tr:'Bildiri',en:'Conference papers'},
 {key:'kitap',types:['kitap','kitap_bolumu'],tr:'Kitap ve bölüm',en:'Books and chapters'},
 {key:'diger',types:[],tr:'Diğer',en:'Other'},
];
export const RECENT_LIMIT=5;
const groupOf=(tur:string|null)=>PUBLICATION_GROUPS.find(g=>g.types.includes(tur||''))||PUBLICATION_GROUPS[PUBLICATION_GROUPS.length-1];
/** [{key,count,label}] for groups with at least one work, plus the total. */
export function groupCounts(rows:TypeCount[],lang:Lang|string){
 const totals=new Map<string,number>();let total=0;
 for(const r of rows){if(!(r.count>0))continue;const g=groupOf(r.tur);totals.set(g.key,(totals.get(g.key)||0)+r.count);total+=r.count;}
 const groups=PUBLICATION_GROUPS.filter(g=>totals.get(g.key)).map(g=>({key:g.key,count:totals.get(g.key)!,label:lang==='en'?g.en:g.tr}));
 return {total,groups};
}
const doiUrl=(doi:string)=>'https://doi.org/'+doi.split('/').map(encodeURIComponent).join('/');
/** Best link for a work: DOI, otherwise OpenAlex, otherwise the AVESİS publication page; null if none. */
export function publicationLink(p:Pick<PublicationRow,'doi'|'openalex_id'|'avesis_url'|'trdizin_id'>):{href:string;kind:'DOI'|'OpenAlex'|'AVESİS'|'TR Dizin'}|null{
 if(p.doi&&/^10\.\d{4,9}\/\S+$/.test(p.doi))return {href:doiUrl(p.doi),kind:'DOI'};
 if(p.openalex_id&&/^W\d+$/.test(p.openalex_id))return {href:`https://openalex.org/${p.openalex_id}`,kind:'OpenAlex'};
 if(p.avesis_url&&/^https:\/\/avesis\.[a-z0-9.-]+\/yayin\//.test(p.avesis_url))return {href:p.avesis_url,kind:'AVESİS'};
 if(p.trdizin_id&&/^[0-9]{1,20}$/.test(p.trdizin_id))return {href:`https://search.trdizin.gov.tr/tr/yayin/detay/${p.trdizin_id}`,kind:'TR Dizin'};
 return null;
}
/** Meta line under a title: "2025 · Journal name"; parts that are unknown are left out. */
export function publicationMeta(p:Pick<PublicationRow,'yil'|'kaynak_adi'>){return [p.yil?String(p.yil):null,p.kaynak_adi].filter(Boolean).join(' · ');}
/** Most recent first: year descending (unknown years last), then the source list order. */
export function recentPublications<T extends PublicationRow&{sira:number}>(rows:T[],limit=RECENT_LIMIT):T[]{
 return [...rows].sort((a,b)=>(b.yil??-1)-(a.yil??-1)||a.sira-b.sira).slice(0,limit);
}
/**
 * schema.org nodes for the listed works, each pointing to the person by @id. Articles name their
 * journal, conference papers their event; books and other works stay generic CreativeWork, because
 * AVESİS mixes books and chapters in one list.
 */
export function workNodes(rows:PublicationRow[],personId:string){
 return rows.map(p=>{const link=publicationLink(p),article=p.tur==='makale'||p.tur==='bildiri';
  return {'@type':article?'ScholarlyArticle':'CreativeWork',name:p.baslik,datePublished:p.yil?String(p.yil):undefined,author:{'@id':personId},url:link?.href,sameAs:p.doi&&link?.kind==='DOI'?link.href:undefined,
   isPartOf:p.tur==='makale'&&p.kaynak_adi?{'@type':'Periodical',name:p.kaynak_adi}:undefined,
   publication:p.tur==='bildiri'&&p.kaynak_adi?{'@type':'PublicationEvent',name:p.kaynak_adi}:undefined};});
}
