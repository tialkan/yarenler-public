import {NextRequest,NextResponse} from 'next/server';
import {currentSession,authDb} from '@/server/auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){const h={'Cache-Control':'private, no-store','Vary':'Cookie'},id=req.nextUrl.searchParams.get('id')||'';if(!/^[0-9a-z]{6,12}$/.test(id))return NextResponse.json({}, {status:400,headers:h});const session=await currentSession();if(!session)return NextResponse.json({}, {status:401,headers:h});try{const r=await authDb().query('SELECT yarenler_duyuru_ilgi_durumu($1::uuid,$2::text) state',[session.id,id]);return NextResponse.json(r.rows[0].state||{}, {headers:h});}catch{return NextResponse.json({}, {status:503,headers:h});}}
