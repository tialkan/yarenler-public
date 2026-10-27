/**
 * schema.org JSON-LD builders and safe serialisation, shared with tests.
 * Every page carries one <script type="application/ld+json"> with an @graph.
 */
type Json=string|number|boolean|null|undefined|Json[]|{[key:string]:Json};
/** Drops null, undefined, empty strings and empty arrays so the output only states known facts. */
export function compact<T extends Json>(value:T):T{
 if(Array.isArray(value))return value.map(v=>compact(v)).filter(v=>v!==undefined&&v!==null&&v!==''&&!(Array.isArray(v)&&!v.length)) as T;
 if(value&&typeof value==='object'){const out:{[key:string]:Json}={};for(const [k,v] of Object.entries(value)){const c=compact(v as Json);if(c===undefined||c===null||c===''||(Array.isArray(c)&&!c.length))continue;out[k]=c;}return out as T;}
 return value;
}
/**
 * JSON for an inline script: "<", ">", "&" and the line separators are escaped, so text such as
 * "</script><script>" inside a name or announcement can never close the element.
 */
export function jsonLd(data:Json){return JSON.stringify(compact(data)).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
export const ids=(base:string)=>({organization:`${base}/#organization`,website:`${base}/#website`});
/** Root Organization: the Yarenler project itself (not the university). */
export function organization(base:string){return {'@type':'Organization','@id':ids(base).organization,name:'Yarenler',url:`${base}/tr`,logo:{'@type':'ImageObject',url:`${base}/icon-512.png`,width:512,height:512},founder:{'@type':'Person',name:'Tarık İsmet Alkan',url:'https://avesis.aybu.edu.tr/tialkan'}};}
/** WebSite without SearchAction (Google no longer shows the sitelinks search box). */
export function website(base:string){return {'@type':'WebSite','@id':ids(base).website,name:'Yarenler',url:`${base}/tr`,inLanguage:['tr','en'],publisher:{'@id':ids(base).organization}};}
export type Crumb={name:string;url:string};
export function breadcrumb(items:Crumb[]){return {'@type':'BreadcrumbList',itemListElement:items.map((item,i)=>({'@type':'ListItem',position:i+1,name:item.name,item:item.url}))};}
export type Institution={name:string;ror?:string|null;university?:boolean}|null;
export function institutionNode(inst:Institution,unit?:string|null){
 if(!inst)return undefined;
 return {'@type':inst.university?'CollegeOrUniversity':'Organization',name:inst.name,sameAs:inst.ror?`https://ror.org/${inst.ror}`:undefined,department:unit?{'@type':'Organization',name:unit}:undefined};
}
/**
 * ProfilePage with the researcher as mainEntity; affiliation is the real institution from the record.
 * Recent works (publications.ts workNodes) join the graph with author pointing to the person.
 */
export function profilePage({base,url,lang,name,jobTitle,institution,unit,knowsAbout,sameAs,dateModified,crumbs,publicationCount=0,works=[]}:{base:string;url:string;lang:'tr'|'en';name:string;jobTitle?:string|null;institution:Institution;unit?:string|null;knowsAbout:string[];sameAs:(string|null|undefined)[];dateModified?:string|null;crumbs:Crumb[];publicationCount?:number;works?:Json[]}){
 return {'@context':'https://schema.org','@graph':[
  {'@type':'ProfilePage','@id':url,url,name,inLanguage:lang,dateModified:dateModified||undefined,isPartOf:{'@id':ids(base).website},mainEntity:{'@id':url+'#person'}},
  {'@type':'Person','@id':url+'#person',name,url,jobTitle:jobTitle||undefined,affiliation:institutionNode(institution,unit),knowsAbout:[...new Set(knowsAbout.filter(Boolean))],sameAs:sameAs.filter((s):s is string=>Boolean(s)),
   // Number of listed publications as the profile's own works (Google ProfilePage: agentInteractionStatistic).
   agentInteractionStatistic:publicationCount>0?{'@type':'InteractionCounter',interactionType:'https://schema.org/WriteAction',userInteractionCount:publicationCount}:undefined},
  ...works,
  breadcrumb(crumbs),
 ]};
}
/** Field and unit pages: CollectionPage whose mainEntity is an ItemList of the first 50 researchers. */
export function collectionPage({base,url,lang,name,description,total,people,crumbs}:{base:string;url:string;lang:'tr'|'en';name:string;description:string;total:number;people:{name:string;url:string}[];crumbs:Crumb[]}){
 return {'@context':'https://schema.org','@graph':[
  {'@type':'CollectionPage','@id':url,url,name,description,inLanguage:lang,isPartOf:{'@id':ids(base).website},mainEntity:{'@type':'ItemList',numberOfItems:total,itemListOrder:'https://schema.org/ItemListOrderAscending',itemListElement:people.slice(0,50).map((p,i)=>({'@type':'ListItem',position:i+1,url:p.url,name:p.name}))}},
  breadcrumb(crumbs),
 ]};
}
/** Plain page (explore, about, privacy, announcement list): WebPage + breadcrumb. */
export function webPage({base,url,lang,name,description,crumbs,type='WebPage'}:{base:string;url:string;lang:'tr'|'en';name:string;description:string;crumbs:Crumb[];type?:'WebPage'|'AboutPage'|'CollectionPage'|'SearchResultsPage'}){
 return {'@context':'https://schema.org','@graph':[{'@type':type,'@id':url,url,name,description,inLanguage:lang,isPartOf:{'@id':ids(base).website}},breadcrumb(crumbs)]};
}
/** Collaboration announcement as an Article with publication and expiry dates. */
export function announcementArticle({base,url,lang,headline,text,datePublished,dateModified,expires,author,about,crumbs}:{base:string;url:string;lang:'tr'|'en';headline:string;text:string;datePublished:string;dateModified?:string|null;expires:string;author:{name:string;url:string};about:{name:string;url:string}[];crumbs:Crumb[]}){
 return {'@context':'https://schema.org','@graph':[
  {'@type':'Article','@id':url+'#article',mainEntityOfPage:url,url,headline,articleBody:text,inLanguage:lang,datePublished,dateModified:dateModified||datePublished,expires,author:{'@type':'Person',name:author.name,url:author.url},publisher:{'@id':ids(base).organization},isPartOf:{'@id':ids(base).website},about:about.map(a=>({'@type':'Thing',name:a.name,url:a.url}))},
  breadcrumb(crumbs),
 ]};
}
