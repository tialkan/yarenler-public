/**
 * English forms of Turkish academic titles (YÖK usage). Only exact known titles are mapped; an owner
 * edited free-text title without a known form returns null (the English page is then noindex).
 */
const EN:Record<string,string>={
 'Prof. Dr.':'Prof. Dr.',
 'Doç. Dr.':'Assoc. Prof. Dr.',
 'Dr. Öğr. Üyesi':'Asst. Prof. Dr.',
 'Öğr. Gör. Dr.':'Lecturer Dr.',
 'Öğr. Gör.':'Lecturer',
 'Arş. Gör. Dr.':'Res. Asst. Dr.',
 'Arş. Gör.':'Res. Asst.',
 'Dr.':'Dr.',
};
export function titleEn(title:string|null|undefined){const key=(title||'').replace(/\s+/g,' ').trim();return key?EN[key]??null:null;}
/** Title as shown on a page in the given language: English form when known, otherwise the original. */
export function displayTitle(title:string|null|undefined,lang:'tr'|'en'){return lang==='en'?titleEn(title)||title||null:title||null;}
