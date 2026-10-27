export const DEFAULTS:Readonly<{ln:number;r:number;p:number;saltBytes:number;keyBytes:number}>;
export const MIN_PASSWORD_LENGTH:number;
export function parseHash(value:string|undefined|null):{ln:number;r:number;p:number;salt:Buffer;key:Buffer}|null;
export function hashPassword(password:string,options?:Partial<{ln:number;r:number;p:number;saltBytes:number;keyBytes:number}>):Promise<string>;
export function verifyPassword(password:string,stored:string|undefined|null):Promise<boolean>;
