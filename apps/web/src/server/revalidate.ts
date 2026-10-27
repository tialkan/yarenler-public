import 'server-only';
import {revalidatePath} from 'next/cache';
import {invalidateSitemap} from './sitemap';
import {announcementPath} from './announcement-text';
/**
 * Cache invalidation after writes. Next.js ISR entries are dropped at once; the CDN copy expires with
 * its s-maxage (5 minutes for announcement pages, 1 hour for the rest).
 */
export function revalidateEverything(){revalidatePath('/','layout');invalidateSitemap();}
/** Pages that list or show announcements (home strip, both list pages, both detail routes). */
export function revalidateAnnouncements(){
 for(const route of ['/[lang]','/[lang]/duyurular','/[lang]/announcements','/[lang]/duyuru/[slug]','/[lang]/announcement/[slug]'])revalidatePath(route,'page');
 invalidateSitemap();
}
/** Addresses to report to IndexNow when announcements appear or disappear (removed ones now answer 410). */
export function announcementIndexNowPaths(items:{id:string;text:string}[]){
 return [...items.flatMap(a=>[announcementPath('tr',a.id,a.text),announcementPath('en',a.id,a.text)]),'/tr','/en','/tr/duyurular','/en/announcements'];
}
