import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {paths} from '@/server/i18n';
import {validLang,pageFrom} from '@/views/shared';
import {PersonView,personMetadata} from '@/views/person';
import {FieldView,fieldMetadata} from '@/views/field';
import {UnitView,unitMetadata} from '@/views/unit';
import {ExploreView,exploreMetadata} from '@/views/explore';
import {AboutView,aboutMetadata,PrivacyView,privacyMetadata,LoginView,loginMetadata} from '@/views/static-pages';
/**
 * Public pages: profiles, fields, units, explore, about, privacy, sign-in. Nothing reads cookies,
 * headers or search parameters, so every page is ISR cached and served with s-maxage to the CDN.
 * Pagination arrives as a path part: the proxy rewrites "?page=n" to ".../n".
 */
export const revalidate=3600;
export function generateStaticParams(){return [];}
type Props={params:Promise<{lang:string;parts:string[]}>};
type Route={kind:'person'|'field'|'unit'|'explore'|'about'|'privacy'|'login';param:string;page:number};
function route(lang:'tr'|'en',parts:string[]):Route|null{
 const p=paths[lang],[head,param,extra]=parts;
 if(head==='a'&&parts.length===2)return {kind:'person',param,page:1};
 if(head===p.field&&(parts.length===2||parts.length===3))return {kind:'field',param,page:pageFrom(extra)};
 if(head===p.unit&&(parts.length===2||parts.length===3))return {kind:'unit',param,page:pageFrom(extra)};
 if(head===p.explore&&parts.length<=2)return {kind:'explore',param:'',page:pageFrom(param)};
 if(parts.length===1&&head===p.about)return {kind:'about',param:'',page:1};
 if(parts.length===1&&head===p.privacy)return {kind:'privacy',param:'',page:1};
 if(parts.length===1&&head===p.login)return {kind:'login',param:'',page:1};
 return null;
}
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const par=await params,lang=validLang(par.lang),r=route(lang,par.parts);if(!r)return {};
 switch(r.kind){
  case 'person':return personMetadata(lang,r.param);
  case 'field':return fieldMetadata(lang,r.param,r.page);
  case 'unit':return unitMetadata(lang,r.param,r.page);
  case 'explore':return exploreMetadata(lang,r.page);
  case 'about':return aboutMetadata(lang);
  case 'privacy':return privacyMetadata(lang);
  case 'login':return loginMetadata(lang);
 }
}
export default async function Page({params}:Props){
 const par=await params,lang=validLang(par.lang),r=route(lang,par.parts);if(!r)notFound();
 switch(r.kind){
  case 'person':return <PersonView lang={lang} param={r.param}/>;
  case 'field':return <FieldView lang={lang} param={r.param} page={r.page}/>;
  case 'unit':return <UnitView lang={lang} param={r.param} page={r.page}/>;
  case 'explore':return <ExploreView lang={lang} page={r.page}/>;
  case 'about':return <AboutView lang={lang}/>;
  case 'privacy':return <PrivacyView lang={lang}/>;
  case 'login':return <LoginView lang={lang}/>;
 }
}
