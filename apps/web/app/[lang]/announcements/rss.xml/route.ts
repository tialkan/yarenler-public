import {announcementRss} from '@/views/announcements';
export const dynamic='force-dynamic';
/** RSS 2.0 feed of active announcements (en). */
export async function GET(_request:Request,{params}:{params:Promise<{lang:string}>}){if((await params).lang!=='en')return new Response('Not found',{status:404});return announcementRss('en');}
