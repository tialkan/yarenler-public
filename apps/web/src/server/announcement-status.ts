import {db} from './db';
/**
 * Live state of an announcement for the proxy: true while published and not expired, false when
 * expired or removed (the address answers 410 Gone), null when no announcement has this id (404).
 */
export async function announcementLive(id:string):Promise<boolean|null>{
 const {rows}=await db().query("SELECT (a.durum='yayinda' AND a.bitis>now() AND p.aktif) AS live FROM announcement a JOIN person p ON p.id=a.sahip_id WHERE a.kisa_kimlik=$1",[id]);
 return rows[0]?Boolean(rows[0].live):null;
}
/** Short "expired" page served with 410 and noindex. No scripts; inline style only. */
export function goneHtml(lang:'tr'|'en'){
 const tr=lang==='tr',list=tr?'/tr/duyurular':'/en/announcements';
 const title=tr?'Bu duyurunun süresi doldu':'This announcement has expired';
 const text=tr?'Duyuru yayın süresini tamamladı ya da sahibi tarafından kaldırıldı.':'The announcement reached the end of its publication period or was removed by its owner.';
 const link=tr?'Güncel duyurular':'Current announcements';
 return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, follow"><title>${title} | Yarenler</title><style>body{margin:0;font-family:Lato,system-ui,sans-serif;color:#18373e;background:#fff}main{max-width:40rem;margin:0 auto;padding:4rem 1rem}h1{font-family:Oswald,system-ui,sans-serif;font-weight:500;color:#10677f}a{color:#1683A8}</style></head><body><main><p>410 / YARENLER</p><h1>${title}</h1><p>${text}</p><p><a href="${list}">${link}</a> · <a href="/${lang}">Yarenler</a></p></main></body></html>`;
}
