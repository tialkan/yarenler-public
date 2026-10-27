import {NextRequest,NextResponse} from 'next/server';
import {currentSession} from '@/server/auth';
import {db} from '@/server/db';

/** Local catalog search for authenticated registration, with a small bounded result. */
export async function GET(request:NextRequest){
 const session=await currentSession();if(!session)return NextResponse.json([],{status:401});
 const q=(request.nextUrl.searchParams.get('q')||'').trim();
 if(q.length<3||q.length>120)return NextResponse.json([]);
 try{const {rows}=await db().query(`SELECT id::text,ad,ulke FROM institution
  WHERE strpos(yarenler_katla(ad),yarenler_katla($1::text))>0
  ORDER BY (yarenler_katla(ad)=yarenler_katla($1::text)) DESC,ad LIMIT 10`,[q]);
  return NextResponse.json(rows,{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json([],{status:503});}
}
