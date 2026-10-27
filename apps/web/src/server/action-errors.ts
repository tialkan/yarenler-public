import {describeError} from './redact';
/** Errors a server action may show to the user, and the state returned to useActionState. */
export type ActionState={error:string}|null;
export type Lang='tr'|'en';

/** A validation or permission problem whose message is safe to show. */
export class UserError extends Error{
 readonly tr:string;readonly en:string;
 constructor(tr:string,en:string){super(tr);this.name='UserError';this.tr=tr;this.en=en;}
}

export const GENERIC_ERROR={tr:'İşlem şu anda tamamlanamadı. Lütfen biraz sonra yeniden deneyin.',en:'The action could not be completed. Please try again shortly.'} as const;
const KNOWN_DB:Record<string,{tr:string;en:string}>={
 '23505':{tr:'Bu kayıt zaten var.',en:'This record already exists.'},
 '23514':{tr:'Girilen değer kurallara uymuyor. Lütfen metni ve süreyi kontrol edin.',en:'A value does not meet the rules. Please check the text and duration.'},
};

export const formLang=(form:FormData):Lang=>form.get('lang')==='en'?'en':'tr';

/** One JSON line per server error: event name, context and a redacted error description. */
export function logServerError(event:string,error:unknown,context:Record<string,unknown>={},log:(line:string)=>void=console.error){log(JSON.stringify({level:'error',event,time:new Date().toISOString(),...context,error:describeError(error)}));}

/**
 * Maps a thrown value to a message for the user. Database and unexpected errors never expose
 * internal details: they are logged on the server (and reported when tracking is on) and a
 * generic message is returned.
 */
export function actionErrorMessage(error:unknown,lang:Lang,options:{action?:string;log?:(line:string)=>void;report?:(error:unknown)=>void}={}):string{
 if(error instanceof UserError)return error[lang];
 logServerError('server_action_failed',error,{action:options.action??null},options.log);
 try{options.report?.(error);}catch{/* reporting never breaks the response */}
 const code=describeError(error).code;
 return (code&&KNOWN_DB[code]||GENERIC_ERROR)[lang];
}
