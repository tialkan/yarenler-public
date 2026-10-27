/**
 * Readable URL parts. Same rule as the SQL function yarenler_slug (migration 0011):
 * Turkish lower case (I → ı, İ → i), ı → i, diacritics removed (ş → s, ğ → g, ç → c, ö → o, ü → u),
 * every other run of characters becomes one hyphen, cut at a word boundary.
 */
const SPECIAL:Record<string,string>={'ı':'i','ß':'ss','æ':'ae','œ':'oe','ø':'o','đ':'d','ð':'d','ł':'l','þ':'th'};
export function slugify(value:string,max=80){
 let s=value.toLocaleLowerCase('tr-TR').replace(/[ıßæœøđðłþ]/g,c=>SPECIAL[c]).normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
 if(s.length>max){s=s.slice(0,max+1);s=s.includes('-')?s.replace(/-[^-]*$/,''):s.slice(0,max);s=s.replace(/^-+|-+$/g,'');}
 return s;
}
/** Field addresses before migration 0011: "/alan/{uuid}-{name}". */
export const LEGACY_FIELD=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|$)/;
/** Unit addresses before migration 0011: "/birim/birim-{12 hex}". */
export const LEGACY_UNIT=/^birim-[0-9a-f]{12}$/;
/** A stored slug: lower case letters, digits and single hyphens. */
export const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export type FieldParam={kind:'legacy';id:string}|{kind:'slug';slug:string}|{kind:'invalid'};
/** How a /alan/{param} address is looked up: legacy UUID form (then 308) or the stored slug. */
export function parseFieldParam(param:string):FieldParam{
 const legacy=LEGACY_FIELD.exec(param);if(legacy)return {kind:'legacy',id:legacy[1]};
 return param.length<=120&&SLUG.test(param)?{kind:'slug',slug:param}:{kind:'invalid'};
}
export type UnitParam={kind:'legacy';slug:string}|{kind:'slug';slug:string}|{kind:'invalid'};
export function parseUnitParam(param:string):UnitParam{
 if(param.length>120||!SLUG.test(param))return {kind:'invalid'};
 return LEGACY_UNIT.test(param)?{kind:'legacy',slug:param}:{kind:'slug',slug:param};
}
/**
 * Where a request must go: null when it is already canonical, otherwise the path to 308 to.
 * `found` is the canonical slug of the record the request resolved to.
 */
export function canonicalRedirect(prefix:string,requested:string,found:string|null){return found&&found!==requested?`${prefix}/${found}`:null;}
