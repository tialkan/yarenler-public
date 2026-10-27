import {notFound} from 'next/navigation';
import {AppealView} from '@/views/appeal';
export const dynamic='force-dynamic';
export const metadata={title:'Corrections and appeals',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{lang:string}>;searchParams:Promise<{sent?:string}>}){if((await params).lang!=='en')notFound();return <AppealView lang="en" sent={(await searchParams).sent==='1'}/>;}
