'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
/**
 * Session state for the static, CDN cached pages. The HTML is the same for every visitor; whether the
 * visitor is signed in is asked from /api/session (private, no-store), so personal state never enters
 * a cached page. One request per page: components on the same page share it, and a client navigation
 * (for example the redirect after signing out) asks again.
 */
export type SessionState={signedIn:boolean;canPublish:boolean};
const anonymous:SessionState={signedIn:false,canPublish:false};
let pending:{path:string;promise:Promise<SessionState>}|null=null;
function load(path:string){
 if(!pending||pending.path!==path)pending={path,promise:fetch('/api/session',{cache:'no-store',credentials:'same-origin'}).then(r=>r.ok?r.json() as Promise<SessionState>:anonymous).then(s=>({signedIn:Boolean(s.signedIn),canPublish:Boolean(s.canPublish)})).catch(()=>anonymous)};
 return pending.promise;
}
export function useSession(){const path=usePathname()||'/',[state,setState]=useState<SessionState>(anonymous);useEffect(()=>{let live=true;load(path).then(s=>{if(live)setState(s);});return()=>{live=false;};},[path]);return state;}
