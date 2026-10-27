import {notFound} from 'next/navigation';
import {InstitutionView} from '@/views/institution';
export const dynamic='force-dynamic';
export const metadata={title:'Institutional participation',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{lang:string}>;searchParams:Promise<{sent?:string}>}){if((await params).lang!=='en')notFound();return <InstitutionView lang="en" sent={(await searchParams).sent==='1'}/>;}
