export const KNOWN_SCRIPTS:Set<string>;
export function isFrameworkScript(code:string):boolean;
export function inlineScripts(html:string):string[];
export function sha256(code:string):string;
export function scriptHashes(html:string):{hashes:string[];rejected:number};
export function dsnOrigin(dsn:string|undefined|null):string|null;
export function buildCsp(options?:{hashes?:string[];reportOrigin?:string|null;dev?:boolean}):string;
export function cspForHtml(html:string,options?:{reportOrigin?:string|null}):string;
