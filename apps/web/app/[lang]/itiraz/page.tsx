import {notFound} from 'next/navigation';
import {AppealView} from '@/views/appeal';
export const dynamic='force-dynamic';
export const metadata={title:'Düzeltme ve itiraz',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{lang:string}>;searchParams:Promise<{sent?:string}>}){if((await params).lang!=='tr')notFound();return <AppealView lang="tr" sent={(await searchParams).sent==='1'}/>;}
