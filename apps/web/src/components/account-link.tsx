'use client';
import Link from 'next/link';
import {useSyncExternalStore} from 'react';
import {useSession} from './session-state';
/** Header sign-in link; switches to "Profilim" in the browser when the visitor has a session. */
export function AccountLink({lang,loginPath,loginLabel}:{lang:'tr'|'en';loginPath:string;loginLabel:string}){
 const {signedIn}=useSession(),tr=lang==='tr',profile=tr?'/tr/profilim':'/en/my-profile';
 return <Link className="login-link" aria-label={signedIn?(tr?'Profilim':'My profile'):loginLabel} href={signedIn?profile:loginPath} prefetch={false}><span className="orcid-mark" aria-hidden="true">iD</span><span className="desktop-login-label">{signedIn?(tr?'Profilim':'My profile'):loginLabel}</span><span className="mobile-login-label">{signedIn?(tr?'Profilim':'Profile'):(tr?'Katıl':'Join')}</span></Link>;
}
const noop=()=>()=>{};
/** Sign-in error notice for the static sign-in page: the ?error= flag is read in the browser. */
export function LoginError({lang}:{lang:'tr'|'en'}){
 const error=useSyncExternalStore(noop,()=>new URLSearchParams(window.location.search).get('error'),()=>null);
 if(!error)return null;
 if(error==='banned')return <p role="alert">{lang==='tr'?'Bu ORCID iD ile Yarenler’e giriş yapılamaz. Bir hata olduğunu düşünüyorsanız Yarenler ile iletişime geçin.':'This ORCID iD cannot sign in to Yarenler. If you think this is a mistake, please contact Yarenler.'} <Link href={lang==='tr'?'/tr/itiraz':'/en/appeal'}>{lang==='tr'?'Karara itiraz et':'Appeal this decision'}</Link></p>;
 return <p role="alert">{lang==='tr'?'Giriş tamamlanamadı. Lütfen yeniden deneyin.':'Sign-in could not be completed. Please try again.'}</p>;
}
