import {NextRequest,NextResponse} from 'next/server';
import {appOrigin,orcidOrigin,authConfigured,randomToken,stateName,secureCookie} from '@/server/auth';
export async function GET(request:NextRequest){
 const lang=request.nextUrl.searchParams.get('lang')==='en'?'en':'tr';
 if(!authConfigured())return NextResponse.redirect(new URL(`/${lang}/${lang==='tr'?'giris':'sign-in'}?error=configuration`,appOrigin()));
 const state=randomToken(),url=new URL('/oauth/authorize',orcidOrigin());url.search=new URLSearchParams({client_id:process.env.ORCID_CLIENT_ID!,response_type:'code',scope:'/authenticate',redirect_uri:appOrigin()+'/api/auth/orcid/callback',state}).toString();
 const response=NextResponse.redirect(url);response.cookies.set(stateName,`${state}.${lang}`,{...secureCookie,maxAge:600});response.headers.set('Cache-Control','no-store');return response;
}
