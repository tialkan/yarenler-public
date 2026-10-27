'use server';
import {after} from 'next/server';
import {unstable_rethrow} from 'next/navigation';
import {UserError,actionErrorMessage,formLang} from './action-errors';
import {requireMember} from './access';
import {reportError} from './error-report';
import {invalidateNetwork} from './network';
import {revalidateEverything} from './revalidate';
import {purgeCdn} from './cdn-purge';
import {notifyProfile} from './indexnow';
import {areaDbError,defaultInvalidReason,mergeCandidates,screenAreaName,type AreaProposal,type AreaRef,type AreaState} from './area-intake';
import {changedPaths,exactArea,insertAudit,lexicalCandidates,linkArea,linkedAreaIds,requestSemanticRefresh,reviewName,semanticCandidates} from './area-intake-db';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Central access check (access.ts): session, platform ban, announcement ban and panel restriction on new fields. */
async function owner(){return (await requireMember('alan')).personId;}
const target=(form:FormData)=>form.get('hedef')==='ilgi'?'ilgi' as const:'alan' as const;

/**
 * The field is visible to everyone at once: in-memory network cache, every ISR page, the CDN copies of
 * the pages that show it, IndexNow for the profile, and the semantic service is asked to embed it now.
 */
function published(personId:string,area:AreaRef){
 invalidateNetwork();revalidateEverything();
 after(async()=>{const paths=await changedPaths(personId,area);await Promise.all([purgeCdn(paths),notifyProfile(personId),requestSemanticRefresh()]);});
}

/** Step 1: screen, database, then (only without an exact match) the AI review. */
async function check(form:FormData):Promise<AreaState>{
 const personId=await owner(),lang=formLang(form),hedef=target(form);
 const screen=screenAreaName(form.get('ad'));
 if(!screen.ok)return {durum:'gecersiz',gerekce:screen.message[lang],girdi:String(form.get('ad')??'').slice(0,120)};
 const text=screen.text;
 // Exact canonical key match: no AI, the existing field is linked and the academic is told.
 const exact=await exactArea(text);
 if(exact){
  if((await linkedAreaIds(personId,[exact.id],hedef)).has(exact.id))return {durum:'zaten',alan:exact};
  const audit=await insertAudit({personId,girdi:text,hedef,durum:'birebir',karar:'mevcut',duzeltilmisAd:null,adEn:null,mevcutId:exact.id,gerekce:null,adaylar:[exact.id],model:null,hata:null,cacheKey:null});
  const linked=await linkArea(audit,personId,'mevcut',exact.id);published(personId,linked);
  return {durum:'eklendi',alan:linked,yeni:false,birebir:true};
 }
 const [lexical,semantic]=await Promise.all([lexicalCandidates(text),semanticCandidates(text)]);
 const candidates=mergeCandidates(lexical,semantic);
 const {decision,model,cacheKey}=await reviewName(text,candidates,personId);
 // A corrected or English name that already exists exactly is that field, whatever the model said.
 if(decision.karar==='yeni'&&decision.duzeltilmisAd){
  const hit=await exactArea(decision.duzeltilmisAd)||(decision.adEn?await exactArea(decision.adEn):null);
  if(hit){decision.karar='mevcut';decision.mevcutId=hit.id;if(!candidates.some(c=>c.id===hit.id))candidates.unshift({id:hit.id,ad:hit.ad,ad_en:null});}
 }
 const audit=await insertAudit({personId,girdi:text,hedef,durum:decision.durum,karar:decision.karar,duzeltilmisAd:decision.duzeltilmisAd,adEn:decision.adEn,mevcutId:decision.mevcutId,gerekce:decision.gerekce,adaylar:candidates.map(c=>c.id),model,hata:decision.hata,cacheKey});
 if(decision.karar==='gecersiz')return {durum:'gecersiz',gerekce:lang==='tr'&&decision.gerekce?decision.gerekce:defaultInvalidReason(lang),girdi:text};
 const refs=candidates.map(c=>({id:c.id,ad:c.ad,slug:null}));
 const mevcut=decision.mevcutId?refs.find(c=>c.id===decision.mevcutId)||null:null,adaylar=refs.filter(c=>c.id!==mevcut?.id).slice(0,5);
 const profilde=[...await linkedAreaIds(personId,[...(mevcut?[mevcut.id]:[]),...adaylar.map(c=>c.id)],hedef)];
 return {durum:'oneri',denetimId:audit,karar:mevcut?'mevcut':'yeni',girdi:text,duzeltilmisAd:decision.duzeltilmisAd||text,mevcut,adaylar,profilde,denetlendi:decision.durum==='denetlendi'};
}

/** Step 2: the academic picks the suggested field, one of the close fields, or "a different field" (new). */
async function confirm(form:FormData):Promise<AreaState>{
 const personId=await owner();
 const audit=String(form.get('denetim')||''),secim=form.get('secim')==='mevcut'?'mevcut' as const:'yeni' as const,area=String(form.get('alan')||'')||null;
 if(!UUID.test(audit)||(secim==='mevcut'&&(!area||!UUID.test(area))))throw new UserError('Seçim geçersiz.','The selection is invalid.');
 let linked;
 try{linked=await linkArea(audit,personId,secim,secim==='mevcut'?area:null);}
 catch(error){const message=areaDbError((error as {code?:string}).code);if(message)throw new UserError(message.tr,message.en);throw error;}
 published(personId,linked);
 return {durum:'eklendi',alan:{id:linked.id,ad:linked.ad,slug:linked.slug},yeni:linked.yeni,birebir:false};
}

/**
 * useActionState entry for the field picker. "islem" is "denetle" (check a typed name) or "onayla"
 * (confirm a proposal). Errors keep the current proposal on screen next to the alert.
 */
export async function areaIntake(previous:AreaState,form:FormData):Promise<AreaState>{
 try{return form.get('islem')==='onayla'?await confirm(form):await check(form);}
 catch(error){
  unstable_rethrow(error);
  const oneri:AreaProposal|null=previous?.durum==='oneri'?previous:previous?.durum==='hata'?previous.oneri:null;
  return {durum:'hata',error:actionErrorMessage(error,formLang(form),{action:'areaIntake',report:failure=>after(()=>reportError(failure,{kind:'action',action:'areaIntake'}))}),oneri};
 }
}
