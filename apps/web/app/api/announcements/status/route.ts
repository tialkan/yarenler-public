import {NextResponse} from 'next/server';
import {currentSession} from '@/server/auth';
import {announcementGate} from '@/server/announcement-gate';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
/** Form state for the publish dialog on cached pages: bans, panel restriction, today's publication and attempts. No AI call. */
export async function GET(){
 try{const session=await currentSession();if(!session?.person_id)return NextResponse.json({mesaj:'ORCID ile giriş yapın.'},{status:401,headers});
  return NextResponse.json(await announcementGate(session.person_id),{headers});}
 catch{return NextResponse.json({mesaj:'Durum alınamadı.'},{status:503,headers});}
}
