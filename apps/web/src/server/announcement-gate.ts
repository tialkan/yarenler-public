import 'server-only';
import {authDb} from './auth';
import {VIOLATION_RETENTION_DAYS} from './announcement-limits';
import {logServerError} from './action-errors';
import type {BanInfo,GateState,PlatformBan} from './announcement-moderation';

/** Bans, panel restriction and today's allowance for the announcement form (no AI involved). */
export async function announcementGate(personId:string):Promise<GateState>{
 const d=(await authDb().query<{d:{platform:PlatformBan|null;yasak:BanInfo|null;kisitli:boolean;hak_kullanildi:boolean}}>('SELECT yarenler_duyuru_durumu($1::uuid) AS d',[personId])).rows[0].d;
 return {platform:d.platform??null,yasak:d.yasak??null,kisitli:Boolean(d.kisitli),hakKullanildi:Boolean(d.hak_kullanildi)};
}

let lastCleanup=0;
/**
 * Retention (KVKK) fallback: violation records with their text, IP address and User-Agent summary, attempts and
 * expired bans older than VIOLATION_RETENTION_DAYS are deleted; ordinary rejection metadata has a 30-day limit unless an appeal is open. The daily maintenance job does the same
 * (infra/maintenance/retention.py); here it runs at most every 12 hours per process, after a review or a panel visit.
 */
export async function cleanupViolations(run:(sql:string,params:unknown[])=>Promise<unknown>=(sql,params)=>authDb().query(sql,params)){
 if(Date.now()-lastCleanup<12*3600e3)return;lastCleanup=Date.now();
 try{await run('SELECT yarenler_ihlal_temizle($1::int)',[VIOLATION_RETENTION_DAYS]);}catch(error){lastCleanup=0;logServerError('violation_cleanup_failed',error);}
}
