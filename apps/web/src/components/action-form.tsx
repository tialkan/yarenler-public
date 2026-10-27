'use client';
import {useActionState,type ReactNode} from 'react';
import {useFormStatus} from 'react-dom';
import type {ActionState} from '@/server/action-errors';
export type FormAction=(state:ActionState,form:FormData)=>Promise<ActionState>;

/** Form bound to a server action through useActionState; shows the returned error as an alert. */
export function ActionForm({action,className,children}:{action:FormAction;className?:string;children:ReactNode}){const [state,formAction]=useActionState(action,null);
 return <form action={formAction} className={className}>{children}{state?.error&&<p role="alert" className="form-error">{state.error}</p>}</form>;}

/** Submit button disabled while the form is being sent. */
export function SubmitButton({children,pending,className,disabled}:{children:ReactNode;pending:ReactNode;className?:string;disabled?:boolean}){const status=useFormStatus();
 return <button type="submit" className={className} disabled={disabled||status.pending} aria-busy={status.pending||undefined}>{status.pending?pending:children}</button>;}
