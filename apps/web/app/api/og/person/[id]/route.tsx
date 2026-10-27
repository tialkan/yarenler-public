import {NextResponse} from 'next/server';
/** Old share image address, kept for links already shared; the image now lives at /og/person/{id}.png. */
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-z]{4,12}$/.test(id))return new Response(null,{status:404});
 const url=new URL(`/og/person/${id}.png`,process.env.PUBLIC_BASE_URL||request.url);
 return NextResponse.redirect(url,{status:308,headers:{'Cache-Control':'public, max-age=86400'}});
}
