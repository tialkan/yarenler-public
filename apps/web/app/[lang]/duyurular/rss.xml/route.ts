import {announcementRss} from '@/views/announcements';
export const dynamic='force-dynamic';
/** RSS 2.0 feed of active announcements (tr). */
export async function GET(_request:Request,{params}:{params:Promise<{lang:string}>}){if((await params).lang!=='tr')return new Response('Not found',{status:404});return announcementRss('tr');}
