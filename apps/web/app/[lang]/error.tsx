'use client';
import {useEffect} from 'react';
import {reportClientError} from '@/components/client-error-report';
export default function ErrorPage({error,retry}:{error:unknown;retry:()=>void}){
 // Server errors (with a digest) are already reported by instrumentation.ts; report only browser errors.
 useEffect(()=>{const digest=typeof error==='object'&&error!==null&&'digest' in error?(error as {digest?:unknown}).digest:undefined;if(!digest)reportClientError(error);},[error]);
 return <main id="main" className="inner-page"><p className="eyebrow">YARENLER</p><h1>Verilere şu anda ulaşılamıyor.</h1><p>Lütfen biraz sonra tekrar deneyin.</p><button className="button" onClick={()=>retry()}>Yeniden dene</button></main>;}
