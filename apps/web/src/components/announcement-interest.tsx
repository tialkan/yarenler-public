'use client';
import Link from 'next/link';
import {useActionState,useEffect,useState} from 'react';
import {useSession} from './session-state';
import {setAnnouncementInterest} from '@/server/announcement-interest';
export function AnnouncementInterest({id,lang}:{id:string;lang:'tr'|'en'}){const en=lang==='en',{signedIn,canPublish}=useSession(),[loaded,setLoaded]=useState<{active:boolean;owner:boolean}|null>(null),[state,action,pending]=useActionState(setAnnouncementInterest,null),[loadError,setLoadError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!canPublish)return;const c=new AbortController();fetch('/api/announcements/interest?id='+id,{cache:'no-store',signal:c.signal}).then(r=>r.ok?r.json():null).then(s=>{if(s&&typeof s.owner==='boolean'){setLoaded(s);setLoadError(false);}else setLoadError(true);}).catch(()=>{if(!c.signal.aborted)setLoadError(true);});return()=>c.abort();},[id,canPublish,retry]);
 if(loaded?.owner)return null;
 if(!signedIn)return <p><Link className="text-link" href={en?'/en/sign-in':'/tr/giris'}>{en?'Interested? Join with ORCID':'İlgileniyor musunuz? ORCID ile katılın'}</Link></p>;
 if(!canPublish)return <p><Link href={en?'/en/my-profile':'/tr/profilim'}>{en?'Create your profile to express interest':'İlginizi bildirmek için profilinizi oluşturun'}</Link></p>;
 if(loadError)return <p role="alert">{en?'Your interest status could not be loaded. ':'İlgi durumunuz yüklenemedi. '}<button className="text-link" type="button" onClick={()=>{setLoadError(false);setRetry(v=>v+1);}}>{en?'Try again':'Yeniden dene'}</button></p>;
 const active=state?.active??loaded?.active??false;
 return <form action={action} className="announcement-interest"><input type="hidden" name="id" value={id}/><input type="hidden" name="lang" value={lang}/><input type="hidden" name="active" value={String(!active)}/><button className="button" type="submit" disabled={pending||!loaded} aria-pressed={active}>{pending?(en?'Saving…':'Kaydediliyor…'):active?(en?'Withdraw interest':'İlgimi geri çek'):(en?'I’m interested':'İlgileniyorum')}</button>{state?.error?<p role="alert">{state.error}</p>:active&&<p role="status" className="source-note">{en?'Only the announcement owner can see your profile in their interested researchers list.':'Profiliniz yalnız duyuru sahibinin ilgilenenler listesinde görünür.'}</p>}</form>;
}
