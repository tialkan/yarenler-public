import {notFound} from 'next/navigation';
import {validLang} from '@/views/shared';
import {AnnouncementsView,announcementsMetadata} from '@/views/announcements';
/** Announcement list (tr). ISR, 5 minutes; publish and removal revalidate it at once. */
export const revalidate=300;
/** "Yapay Zekâ Desteğiyle Yayımla" runs as a server action of this page; it ends within PUBLISH_DEADLINE_MS (38 s). */
export const maxDuration=45;
export function generateStaticParams(){return [];}
type Props={params:Promise<{lang:string}>};
const check=(value:string)=>{const lang=validLang(value);if(lang!=='tr')notFound();return lang;};
export async function generateMetadata({params}:Props){return announcementsMetadata(check((await params).lang));}
export default async function Page({params}:Props){return <AnnouncementsView lang={check((await params).lang)}/>;}
