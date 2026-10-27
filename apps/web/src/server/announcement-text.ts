/** Announcement titles, addresses and descriptions derived from the published text. Pure, tested. */
import {slugify} from './slug';
const squash=(s:string)=>s.replace(/\s+/g,' ').trim();
/** Cuts at a word boundary and adds an ellipsis when the text is longer than max characters. */
export function clip(text:string,max:number){const s=squash(text);if([...s].length<=max)return s;const cut=[...s].slice(0,max).join('');const word=cut.replace(/\s+\S*$/,'');return (word.length>=max*.5?word:cut).replace(/[\s,;:.!?-]+$/,'')+'…';}
/**
 * Title from the first sentence. Very short openings ("Merhaba.") are joined with the next sentence
 * until the title has at least 25 characters; it never exceeds max characters.
 */
export function announcementTitle(text:string,max=90){
 const first=text.split(/\r?\n/).map(s=>squash(s.replace(/^[-*•#>\s]+/,''))).filter(Boolean);
 if(first.length>1&&[...first[0]].length<=220)return first[0].replace(/[.!?…:;,\s]+$/,'');
 const parts=first.join(' ').split(/(?<=[.!?…])\s+/).filter(Boolean);let title='';
 for(const part of parts){title=title?title+' '+part:part;if([...title].length>=25)break;}
 return clip(title.replace(/[.!?…:;,\s]+$/,'')||squash(text),max);
}
export function announcementSlug(text:string){return slugify(announcementTitle(text),60);}
export const announcementSegment={tr:'duyuru',en:'announcement'} as const;
export const announcementsSegment={tr:'duyurular',en:'announcements'} as const;
/** "/tr/duyuru/{kisa_kimlik}-{slug}" or "/en/announcement/{kisa_kimlik}-{slug}". */
export function announcementPath(lang:'tr'|'en',id:string,text:string){const s=announcementSlug(text);return `/${lang}/${announcementSegment[lang]}/${id}${s?'-'+s:''}`;}
/** The short id at the start of an announcement address part; null when malformed. */
export function announcementIdFrom(param:string){const m=/^([0-9a-z]{6,12})(?:-[a-z0-9-]*)?$/.exec(param);return m?m[1]:null;}
export function announcementDescription(text:string,max=155){return clip(text,max);}
