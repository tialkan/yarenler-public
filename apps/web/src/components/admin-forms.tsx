'use client';
import {useActionState,useState,type ReactNode} from 'react';
import {useFormStatus} from 'react-dom';
import type {AdminState} from '@/server/admin-actions';

type Action=(state:AdminState,form:FormData)=>Promise<AdminState>;

function Feedback({state}:{state:AdminState}){
 return <>{state?.error&&<p role="alert" className="adm-error">{state.error}{state.mevcut&&<> <a href={`/yonetici/alanlar/${state.mevcut}`}>Var olan alanı aç</a></>}</p>}<p role="status" className="adm-ok">{state?.ok||''}</p></>;
}
function Submit({children,pending,className,name,value}:{children:ReactNode;pending?:ReactNode;className?:string;name?:string;value?:string}){
 const {pending:busy}=useFormStatus();
 return <button type="submit" name={name} value={value} className={className||'adm-button'} disabled={busy} aria-busy={busy||undefined}>{busy?(pending||'İşleniyor…'):children}</button>;
}

/** Form bound to a panel action; errors as role="alert", confirmations as role="status". */
export function AdminForm({action,children,className}:{action:Action;children:ReactNode;className?:string}){
 const [state,formAction]=useActionState(action,null);
 return <form action={formAction} className={className}>{children}<Feedback state={state}/></form>;
}

/**
 * Destructive submit with a confirmation step on the same page (no browser dialog): the first click
 * shows the consequence and a second, explicit button. name/value travel with that button only (the submitter),
 * so several decisions can share one form.
 */
export function ConfirmSubmit({label,confirmLabel,warning,name,value}:{label:string;confirmLabel:string;warning:string;name?:string;value?:string}){
 const [asking,setAsking]=useState(false);
 if(!asking)return <button type="button" className="adm-button adm-danger-outline" onClick={()=>setAsking(true)}>{label}</button>;
 return <span className="adm-confirm" role="group" aria-label="Onay"><span>{warning}</span><Submit className="adm-button adm-danger" name={name} value={value}>{confirmLabel}</Submit><button type="button" className="adm-link-button" onClick={()=>setAsking(false)}>Vazgeç</button></span>;
}

/** Two steps: search the target field, then choose it and confirm. */
export function MergeForm({action,id,name,people}:{action:Action;id:string;name:string;people:number}){
 const [state,formAction]=useActionState(action,null);
 const [choice,setChoice]=useState('');
 const target=state?.adaylar?.find(a=>a.id===choice);
 return <div className="adm-merge">
  <form action={formAction} className="adm-inline">
   <input type="hidden" name="id" value={id}/><input type="hidden" name="islem" value="ara"/>
   <label>Hedef alan<input name="hedef" defaultValue={state?.sorgu||''} minLength={2} maxLength={120} required placeholder="ad, adres ya da kimlik"/></label>
   <Submit pending="Aranıyor…">Ara</Submit>
  </form>
  {state?.adaylar&&<form action={formAction}>
   <input type="hidden" name="id" value={id}/><input type="hidden" name="islem" value="birlestir"/>
   <fieldset className="adm-choices"><legend>“{name}” hangi alana katılsın?</legend>
    {state.adaylar.map(a=><label key={a.id}><input type="radio" name="hedef_id" value={a.id} checked={choice===a.id} onChange={()=>setChoice(a.id)} required/> {a.ad} <span className="adm-muted">({a.kaynak}, {a.kisi} kişi)</span></label>)}
   </fieldset>
   {target&&<ConfirmSubmit label="Birleştir" confirmLabel="Evet, birleştir" warning={`“${name}” (${people} kişi) “${target.ad}” alanına katılacak. Profil bağları taşınır, eski adres yeni alana yönlenir.`}/>}
  </form>}
  <Feedback state={state?.adaylar?{...state,error:undefined}:state}/>
 </div>;
}
