import {validLang} from '@/views/shared';
import {HomeView,homeMetadata} from '@/views/home';
/** ISR: rendered on the first request, cached, regenerated at most every 5 minutes (announcement strip). */
export const revalidate=300;
/** "Yapay Zekâ Desteğiyle Yayımla" runs as a server action of this page; it ends within PUBLISH_DEADLINE_MS (38 s). */
export const maxDuration=45;
export function generateStaticParams(){return [];}
type Props={params:Promise<{lang:string}>};
export async function generateMetadata({params}:Props){return homeMetadata(validLang((await params).lang));}
export default async function Page({params}:Props){return <HomeView lang={validLang((await params).lang)}/>;}
