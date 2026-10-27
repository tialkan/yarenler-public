import {NextRequest,NextResponse} from 'next/server';
import {people,person,ring,areas,announcements,announcementCount} from '@/server/queries';
import {currentSession} from '@/server/auth';
import {positiveInt} from '@/server/model';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
 const {path}=await params;const q=request.nextUrl.searchParams;
 try {
  const query=q.get('q')?.trim()||'';
  if(query.length>120)return NextResponse.json({kod:'gecersiz_istek',mesaj:'Arama en fazla 120 karakter olabilir.'},{status:400});
  if(path[0]==='auth'&&path[1]==='orcid')return NextResponse.redirect(new URL('/api/auth/orcid',request.url));
  if(path[0]==='me'){const session=await currentSession();return session?NextResponse.json({orcid:session.orcid,ad:session.gorunen_ad,profil_bagli:Boolean(session.person_id)},{headers:{'Cache-Control':'private, no-store'}}):NextResponse.json({kod:'oturum_gerekli',mesaj:'Bu işlem için ORCID ile giriş yapın.'},{status:401});}
  if(path[0]==='people'){
   if(path.length===1){let page,perPage;try{page=positiveInt(q.get('page'),1,10000);perPage=positiveInt(q.get('per_page'),20,100);}catch{return NextResponse.json({kod:'gecersiz_istek',mesaj:'Sayfalama değerleri geçersiz.'},{status:400});}return NextResponse.json(await people(query,page,perPage));}
   if(!/^[0-9a-z]{4,12}$/.test(path[1]))return missing();
   const result=path.length===2?await person(path[1]):path.length===3&&path[2]==='ring'?await ring(path[1]):null;
   return result?NextResponse.json(result):missing();
  }
  if(path.length===1&&path[0]==='areas'){
   if(query.length<2)return NextResponse.json({kod:'gecersiz_istek',mesaj:'En az iki karakter yazın.'},{status:400});
   let limit;try{limit=positiveInt(q.get('limit'),10,20);}catch{return NextResponse.json({kod:'gecersiz_istek',mesaj:'Limit 1–20 arasında olmalı.'},{status:400});}
   return NextResponse.json(await areas(query,limit));
  }
  if(path.length===1&&path[0]==='announcements'){
   let page,perPage;try{page=positiveInt(q.get('page'),1,10000);perPage=positiveInt(q.get('per_page'),20,100);}catch{return NextResponse.json({kod:'gecersiz_istek',mesaj:'Sayfalama değerleri geçersiz.'},{status:400});}
   const [items,total]=await Promise.all([announcements(page,perPage),announcementCount()]);return NextResponse.json({items,page,per_page:perPage,total});
  }
  return missing();
 }catch{console.error('API veri erişim hatası');return NextResponse.json({kod:'hizmet_hatasi',mesaj:'Veriler şu anda alınamıyor. Lütfen biraz sonra tekrar deneyin.'},{status:503});}
}
function missing(){return NextResponse.json({kod:'bulunamadi',mesaj:'Kayıt bulunamadı.'},{status:404});}
export async function POST(){return NextResponse.json({kod:'oturum_gerekli',mesaj:'Bu işlem için ORCID ile giriş yapın.'},{status:401});}
export const PATCH=POST;export const DELETE=POST;
