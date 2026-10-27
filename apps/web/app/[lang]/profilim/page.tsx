import {notFound} from 'next/navigation';
import {validLang} from '@/views/shared';
import {ProfileView,profileMetadata} from '@/views/profile';
/** Owner page (tr): reads the session cookie, rendered per request, never cached. */
export const dynamic='force-dynamic';
/** "Yapay Zekâ Desteğiyle Yayımla" runs as a server action of this page; it ends within PUBLISH_DEADLINE_MS (38 s). */
export const maxDuration=45;
type Props={params:Promise<{lang:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const check=(value:string)=>{const lang=validLang(value);if(lang!=='tr')notFound();return lang;};
export async function generateMetadata({params}:Props){return profileMetadata(check((await params).lang));}
export default async function Page({params,searchParams}:Props){return <ProfileView lang={check((await params).lang)} sp={await searchParams}/>;}
