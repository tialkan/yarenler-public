/**
 * Removes personal data and secrets from error text before it is logged or reported:
 * e-mail addresses, ORCID iDs, credentials in URLs, bearer tokens and long token-like strings.
 */
const PATTERNS:[RegExp,string][]=[
 [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi,'[credentials]@'],
 [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]'],
 [/\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g,'[orcid]'],
 [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [token]'],
 [/\b[A-Fa-f0-9]{32,}\b/g,'[token]'],
 [/[A-Za-z0-9_-]{40,}/g,'[token]'],
];
export function redact(value:string,max=1000):string{let out=value;for(const [pattern,replacement] of PATTERNS)out=out.replace(pattern,replacement);return out.length>max?out.slice(0,max)+'…':out;}

export type ErrorDetails={name:string;code:string|null;message:string;digest:string|null;stack:string|null};
/** Safe, structured description of a thrown value. Query values (pg `detail`) are never included. */
export function describeError(error:unknown):ErrorDetails{
 const e=error instanceof Error?error:null;const record=typeof error==='object'&&error!==null?error as Record<string,unknown>:{};
 const code=typeof record.code==='string'?record.code:null,digest=typeof record.digest==='string'?record.digest:null;
 return {name:e?.name||typeof error,code,digest,message:redact(e?e.message:String(error)),stack:e?.stack?redact(e.stack.split('\n').slice(1,12).join('\n'),3000):null};
}
