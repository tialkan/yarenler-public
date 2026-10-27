import {notFound} from 'next/navigation';
import {validLang} from '@/views/shared';
import {AnnouncementView,announcementMetadata} from '@/views/announcements';
/**
 * Announcement page (tr). ISR, 5 minutes. Expired or removed announcements never reach this page:
 * the proxy answers them with 410 Gone and a short noindex notice.
 */
export const revalidate=300;
/** "Yapay Zekâ Desteğiyle Yayımla" runs as a server action of this page; it ends within PUBLISH_DEADLINE_MS (38 s). */
export const maxDuration=45;
export function generateStaticParams(){return [];}
type Props={params:Promise<{lang:string;slug:string}>};
const check=(value:string)=>{const lang=validLang(value);if(lang!=='tr')notFound();return lang;};
export async function generateMetadata({params}:Props){const p=await params;return announcementMetadata(check(p.lang),p.slug);}
export default async function Page({params}:Props){const p=await params;return <AnnouncementView lang={check(p.lang)} param={p.slug}/>;}
