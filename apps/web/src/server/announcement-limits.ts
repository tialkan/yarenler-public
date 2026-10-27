/**
 * Announcement limits: the single place for these numbers. The database receives them as parameters
 * (migrations 0016-0017: yarenler_duyuru_deneme_baslat, yarenler_duyuru_denetim_sonucu, yarenler_ihlal_temizle);
 * one published announcement per day is structural there (duyuru_gunluk_yayin primary key). The admin
 * Settings page shows them read-only. Pure module, shared with client components and tests.
 */
/** Text limits; the database CHECK is length(ham_metin) BETWEEN 20 AND 5000 (characters). */
export const ANNOUNCEMENT_MIN=20,ANNOUNCEMENT_MAX=5000;
/** Publication duration in weeks (database CHECK 1-14). */
export const ANNOUNCEMENT_MIN_WEEKS=1,ANNOUNCEMENT_MAX_WEEKS=14;
/** Calendar day used for the daily limits. */
export const ANNOUNCEMENT_TIME_ZONE='Europe/Istanbul';
/** Published announcements per person per calendar day (structural in the database). */
export const DAILY_ANNOUNCEMENTS=1;
/**
 * One initial submission and one revision: completed announcement attempts per person per calendar day (database function and per-person lock).
 * A publication and a rejection use an attempt; an AI failure does not. Only one attempt may be pending.
 */
export const DAILY_ATTEMPTS=2;
/** Hard cap on model calls per person per 24 hours, failures included (a failure loop cannot create cost). */
export const DAILY_AI_CALL_CAP=6,HOURLY_AI_CALL_CAP=3;
/** Ordinary rejection metadata; no draft, IP or identity snapshot is stored. */
export const REJECTION_RETENTION_DAYS=30;
/** Links allowed in an announcement (local pre-check, before any AI call). */
export const MAX_LINKS=3;
/** Announcement and new-field ban after a severe violation, in days. */
export const BAN_DAYS=7;
/**
 * Time limits of "Yapay Zekâ Desteğiyle Yayımla": the AI review (web search and the fallback call without it)
 * ends within AI_BUDGET_MS, the whole server action within PUBLISH_DEADLINE_MS (source checks and potential
 * collaborators included). The editor gives up after CLIENT_TIMEOUT_MS.
 */
export const AI_BUDGET_MS=30000,PUBLISH_DEADLINE_MS=38000,CLIENT_TIMEOUT_MS=50000;
/** Violation records (text, IP address, User-Agent) and attempts are deleted after this many days. */
export const VIOLATION_RETENTION_DAYS=180;
/** Character count as PostgreSQL length() counts it (code points, not UTF-16 units). */
export function textLength(value:string){return [...value].length;}
/** Shortens text to the limit, preferring the end of a sentence, then a word boundary. */
export function clampAnnouncement(value:string,max=ANNOUNCEMENT_MAX){const chars=[...value.trim()];if(chars.length<=max)return chars.join('');const head=chars.slice(0,max).join('');const sentence=Math.max(head.lastIndexOf('. '),head.lastIndexOf('.\n'),head.lastIndexOf('! '),head.lastIndexOf('? '));if(sentence>=max*.6)return head.slice(0,sentence+1).trim();const space=head.lastIndexOf(' ');return (space>=max*.6?head.slice(0,space):head).trim();}
