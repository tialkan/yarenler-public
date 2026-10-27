import {validLang} from '@/views/shared';
import {ExploreView,searchMetadata} from '@/views/explore';
import {positiveInt} from '@/server/model';
import {notFound} from 'next/navigation';
/**
 * Search results. The proxy rewrites "/tr/kesfet?q=…" and "/en/explore?q=…" (or "kurum=") here, so the
 * explore listing itself stays static. Rendered per request, noindex, canonical is the explore page.
 */
export const dynamic='force-dynamic';
type Props={params:Promise<{lang:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const one=(v:string|string[]|undefined)=>typeof v==='string'?v:'';
export async function generateMetadata({params,searchParams}:Props){return searchMetadata(validLang((await params).lang),one((await searchParams).q).trim());}
export default async function Page({params,searchParams}:Props){
 const lang=validLang((await params).lang),sp=await searchParams,q=one(sp.q).trim(),kurum=sp.kurum==='aybu'||sp.kurum==='disi'?sp.kurum:null;
 let page=1;try{page=positiveInt(one(sp.page)||null,1,10000);}catch{notFound();}
 return <ExploreView lang={lang} q={q} page={page} kurum={kurum} search/>;
}
