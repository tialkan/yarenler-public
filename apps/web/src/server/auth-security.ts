import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
export const randomToken=()=>randomBytes(32).toString('base64url');
export const digest=(value:string)=>createHash('sha256').update(value).digest();
export function equalState(a:string,b:string){return /^[A-Za-z0-9_-]{43}$/.test(a)&&a.length===b.length&&timingSafeEqual(digest(a),digest(b));}
export function validSessionToken(value:string){return /^[A-Za-z0-9_-]{43}$/.test(value);}
