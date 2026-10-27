import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {authConfigured,currentSession,sessionName} from '@/server/auth';
export const dynamic='force-dynamic';
/**
 * Whether the visitor is signed in, for the header and the publish button on cached pages.
 * Only two booleans; never cached anywhere (private, no-store). No cookie: no database query.
 */
export async function GET(){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
 if(!authConfigured()||!(await cookies()).get(sessionName))return NextResponse.json({signedIn:false,canPublish:false},{headers});
 try{const session=await currentSession();return NextResponse.json({signedIn:Boolean(session),canPublish:Boolean(session?.person_id)},{headers});}
 catch{return NextResponse.json({signedIn:false,canPublish:false},{headers});}
}
