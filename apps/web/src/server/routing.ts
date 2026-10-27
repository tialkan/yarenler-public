/**
 * Pure request routing used by the proxy, shared with tests: which public addresses are rewritten to
 * an internal path so that the pages behind them stay static and cacheable.
 *
 *   /tr/kesfet?q=…  /en/explore?kurum=…      → /{lang}/arama (search, per request, noindex)
 *   /tr/kesfet?page=3, /tr/alan/x?page=2 …   → /tr/kesfet/3, /tr/alan/x/2 (static, ISR)
 *   /tr/duyuru/{id}-…, /en/announcement/{id} → live check (410 when expired or removed)
 *   /tr/duyurular/{id}-… (ADR 0003 form)      → 308 to /tr/duyuru/{id}-…
 */
export type Routed={kind:'announcement';id:string;lang:'tr'|'en'}|{kind:'rewrite';pathname:string;dropPage:boolean}|{kind:'redirect';pathname:string}|{kind:'next'};
const ANNOUNCEMENT=/^\/(tr\/duyuru|en\/announcement)\/([0-9a-z]{6,12})(?:-[a-z0-9-]*)?$/;
// ADR 0003 detail form "/tr/duyurular/{id}-{slug}"; the page then adds the canonical slug.
const LEGACY_ANNOUNCEMENT=/^\/(tr\/duyurular|en\/announcements)\/([0-9a-z]{6,12}(?:-[a-z0-9-]*)?)$/;
const PAGED=/^\/(tr\/(alan|birim)|en\/(field|unit))\/[^/]+$/;
export function routeRequest(rawPath:string,params:URLSearchParams):Routed{
 const path=rawPath.length>1?rawPath.replace(/\/$/,''):rawPath;
 const announcement=ANNOUNCEMENT.exec(path);
 if(announcement)return {kind:'announcement',id:announcement[2],lang:announcement[1].startsWith('tr')?'tr':'en'};
 const legacy=LEGACY_ANNOUNCEMENT.exec(path);
 if(legacy)return {kind:'redirect',pathname:(legacy[1].startsWith('tr')?'/tr/duyuru/':'/en/announcement/')+legacy[2]};
 const explore=path==='/tr/kesfet'||path==='/en/explore';
 if(explore&&(params.get('q')?.trim()||params.get('kurum')))return {kind:'rewrite',pathname:path.startsWith('/tr')?'/tr/arama':'/en/arama',dropPage:false};
 if(params.has('page')&&(explore||PAGED.test(path))){
  const raw=params.get('page')||'';
  // Invalid values go to page 0, which the page answers with 404.
  return {kind:'rewrite',pathname:/^\d{1,5}$/.test(raw)?(Number(raw)>1?`${path}/${Number(raw)}`:path):`${path}/0`,dropPage:true};
 }
 return {kind:'next'};
}
