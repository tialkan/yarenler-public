import {NextResponse} from 'next/server';
import {profileConnections} from '@/server/network';
export const dynamic='force-dynamic';
export async function GET(request:Request){const id=new URL(request.url).searchParams.get('id')||'',headers={'Cache-Control':'private, no-store'};
 if(!/^[0-9a-z]{4,12}$/.test(id))return NextResponse.json({kod:'gecersiz_kimlik'},{status:400,headers});
 try{const result=await profileConnections(id);return result?NextResponse.json(result,{headers}):NextResponse.json({kod:'bulunamadi'},{status:404,headers});}catch{return NextResponse.json({kod:'hizmet_hatasi'},{status:503,headers});}
}
