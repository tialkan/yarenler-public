/**
 * Panel password digest (YONETICI_SIFRE_HASH), Node's built-in scrypt, no extra dependency.
 *
 *   scrypt:<log2 N>:<r>:<p>:<salt base64url>:<key base64url>
 *
 * Colons and base64url only: no "$", so the value is safe in Coolify and docker compose variables
 * (which would expand "$..."). When set, it is preferred over the plain YONETICI_SIFRE.
 * Defaults: N = 2^15, r = 8, p = 3 (32 MiB, about 0.1-0.3 s), 16 byte salt, 32 byte key.
 */
import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
export const DEFAULTS=Object.freeze({ln:15,r:8,p:3,saltBytes:16,keyBytes:32});
const FORMAT=/^scrypt:(\d{1,2}):(\d{1,2}):(\d{1,2}):([A-Za-z0-9_-]{22,88}):([A-Za-z0-9_-]{43,88})$/;
/** Shorter passwords keep the panel closed (plain YONETICI_SIFRE) and are refused by the digest script. */
export const MIN_PASSWORD_LENGTH=16;

/** Parsed parameters, or null when the value is not a digest this module accepts (bounded cost). */
export function parseHash(value){
 const m=FORMAT.exec(String(value||'').trim());if(!m)return null;
 const ln=Number(m[1]),r=Number(m[2]),p=Number(m[3]);
 if(ln<14||ln>20||r<1||r>16||p<1||p>16)return null;
 const salt=Buffer.from(m[4],'base64url'),key=Buffer.from(m[5],'base64url');
 if(salt.length<16||key.length<32)return null;
 return {ln,r,p,salt,key};
}
function derive(password,salt,{ln,r,p},length){
 const N=2**ln;
 return new Promise((resolve,reject)=>scrypt(password.normalize('NFC'),salt,length,{N,r,p,maxmem:256*N*r+(1<<20)},(error,key)=>error?reject(error):resolve(key)));
}
export async function hashPassword(password,options={}){
 const o={...DEFAULTS,...options};
 if(typeof password!=='string'||password.length<MIN_PASSWORD_LENGTH)throw new Error(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`);
 const salt=randomBytes(o.saltBytes),key=await derive(password,salt,o,o.keyBytes);
 return `scrypt:${o.ln}:${o.r}:${o.p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}
/**
 * Constant time comparison of the derived key. With an invalid digest it still spends one default
 * derivation so that the answer time does not reveal the configuration.
 */
export async function verifyPassword(password,stored){
 const parsed=parseHash(stored),text=typeof password==='string'?password.slice(0,1024):'';
 if(!parsed){await derive(text,Buffer.alloc(16),DEFAULTS,32);return false;}
 const key=await derive(text,parsed.salt,parsed,parsed.key.length);
 return key.length===parsed.key.length&&timingSafeEqual(key,parsed.key);
}
