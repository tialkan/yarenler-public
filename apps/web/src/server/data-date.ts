/** Data dates in page language: "22 Ekim 2026" / "22 October 2026", Europe/Istanbul. Pure, shared with tests. */
export function formatDataDate(value:string|Date|null|undefined,lang:'tr'|'en'|string):string|null{
 if(!value)return null;const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return null;
 return new Intl.DateTimeFormat(lang==='en'?'en-GB':'tr-TR',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Istanbul'}).format(d);
}
/** ISO date (YYYY-MM-DD) in Europe/Istanbul for <time dateTime>. */
export function isoDate(value:string|Date|null|undefined):string|null{
 if(!value)return null;const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return null;
 return new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Europe/Istanbul'}).format(d);
}
