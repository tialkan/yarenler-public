import {notFound} from 'next/navigation';
import {InstitutionView} from '@/views/institution';
export const dynamic='force-dynamic';
export const metadata={title:'Kurumsal katılım',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{lang:string}>;searchParams:Promise<{sent?:string}>}){if((await params).lang!=='tr')notFound();return <InstitutionView lang="tr" sent={(await searchParams).sent==='1'}/>;}
