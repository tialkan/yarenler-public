'use client';
import {useActionState,useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {AnnouncementSkills,type WantedSkill} from './announcement-skills';
import {publishWithAi} from '@/server/announcement-publish';
import {ANNOUNCEMENT_MAX,ANNOUNCEMENT_MAX_WEEKS,ANNOUNCEMENT_MIN,BAN_DAYS,CLIENT_TIMEOUT_MS,textLength} from '@/server/announcement-limits';
import {MESSAGES,gateMessage,type GateState,type PublishCandidate,type PublishState} from '@/server/announcement-moderation';

/** Short community rule shown under the form, with a link to the full rules on the About page. */
export function AnnouncementRules({lang}:{lang:'tr'|'en'}){const en=lang==='en';
 return <p className="source-note rules-note">{en?`Announcements that are unrelated to academic collaboration, insulting, advertising or meaningless are not published; after a severe violation, publishing announcements is closed for ${BAN_DAYS} days.`:`Akademik işbirliği dışı, hakaret, reklam ya da anlamsız içerikli duyurular yayımlanmaz; ağır ihlallerde duyuru yayımlama ${BAN_DAYS} gün kapatılır.`} <Link href={en?'/en/about#community-rules':'/tr/hakkinda#topluluk-kurallari'}>{en?'Community rules':'Topluluk kuralları'}</Link></p>;}

function Candidates({list,lang}:{list:PublishCandidate[]|null;lang:'tr'|'en'}){const en=lang==='en';
 if(list===null)return <p className="source-note">{en?'Potential collaborators cannot be listed right now; they also appear on the announcement page.':'Potansiyel yarenler şu an listelenemiyor; duyuru sayfasında da görünürler.'}</p>;
 if(!list.length)return <p className="source-note">{en?'No potential collaborators were found for this text yet.':'Bu metin için şimdilik potansiyel yaren bulunamadı.'}</p>;
 return <section className="draft-candidates" aria-labelledby="draft-candidates-title"><h3 id="draft-candidates-title">{en?'Your potential collaborators':'Potansiyel yarenleriniz'}</h3>{list.map(c=><article className="announcement" key={c.id}><h4><Link href={en?c.url.replace('/tr/','/en/'):c.url}>{c.name}</Link>{c.band&&<span className="match-band" title={c.band.title}>{c.band.label}</span>}</h4>{c.unit&&<p>{c.unit}</p>}<ul>{c.reasons.map((r,i)=><li key={i}>{r.kind==='semantic'?<>{en?'Semantic similarity to: ':'Metninize anlamsal olarak yakın: '}{r.sourceUrl?<a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">{r.term}</a>:r.term}</>:en?`“${r.term}” matches the profile field “${r.field}”.`:`“${r.term}” kavramı, profildeki “${r.field}” alanıyla eşleşiyor.`}</li>)}</ul></article>)}<p className="source-note">{en?'Matched by research fields and publication titles; not a probability of collaboration.':'Çalışma alanları ve yayın başlıklarıyla eşleştirildi; işbirliği olasılığı değildir.'}</p></section>;}

/**
 * One step: duration (top), text, "Yapay Zekâ Desteğiyle Yayımla". The server action checks, edits, moderates,
 * publishes and finds potential collaborators in one request (at most PUBLISH_DEADLINE_MS); the editor gives up
 * after CLIENT_TIMEOUT_MS. The form state (bans, today's allowance) comes from Profilim or, in the dialog on
 * cached pages, from /api/announcements/status. Without JavaScript the form action still works.
 */
export function AnnouncementEditor({lang,gate:initial,revisionId,initialText='',initialSkills=[]}:{lang:'tr'|'en';gate?:GateState|null;revisionId?:string;initialText?:string;initialSkills?:WantedSkill[]}){
 const en=lang==='en';
 const [loaded,setLoaded]=useState<GateState|null>(null),rawGate=loaded??initial??null,gate=rawGate&&revisionId?{...rawGate,hakKullanildi:false}:rawGate;
 const [text,setText]=useState(initialText);
 const [formState,dispatch,formPending]=useActionState(publishWithAi,null);
 const [jsState,setJsState]=useState<PublishState>(null),[busy,setBusy]=useState(false);
 const state=jsState??formState,pending=busy||formPending;
 // Asked on mount when the page did not pass it, and again after any result other than a publication.
 const refresh=initial===undefined||Boolean(state&&state.durum!=='yayinlandi');
 useEffect(()=>{if(!refresh)return;let live=true;
  fetch('/api/announcements/status',{cache:'no-store',credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(g=>{if(live&&g&&typeof g.hakKullanildi==='boolean')setLoaded(g as GateState);}).catch(()=>{});
  return()=>{live=false;};},[refresh,state]);

 if(state?.durum==='yayinlandi')return <div className="publish-result">
  <p role="status" className="publish-ok">{en?'Your announcement has been published.':'Duyurunuz yayımlandı.'} <Link href={state.url}>{en?'Open the announcement page':'Duyuru sayfasını aç'}</Link></p>
  {state.duzeltildi&&<p className="source-note">{en?'Your draft was prepared as a professional announcement; your original text is kept separately.':'Taslağınız profesyonel duyuru biçiminde düzenlendi; ham metniniz ayrıca saklanır.'}</p>}
  <Candidates list={state.adaylar} lang={lang}/>
  <p className="source-note">{MESSAGES.tomorrow[lang]}</p>
 </div>;

 // A ban or the exhausted daily limit closes the form; an AI failure or a format error does not.
 const usedNow=state?.durum==='yasak'||state?.durum==='sinir';
 const closed=gate?gateMessage(gate,lang):null;
 const length=textLength(text.trim()),tooLong=length>ANNOUNCEMENT_MAX;
 const disabled=pending||usedNow||Boolean(closed)||length<ANNOUNCEMENT_MIN||tooLong;
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(disabled)return;
  const data=new FormData(event.currentTarget);setBusy(true);setJsState(null);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<PublishState>(resolve=>{timer=setTimeout(()=>resolve({durum:'hata',mesaj:MESSAGES.unavailable[lang]}),CLIENT_TIMEOUT_MS);});
  try{setJsState(await Promise.race([publishWithAi(null,data),timeout]));}
  catch{setJsState({durum:'hata',mesaj:MESSAGES.unavailable[lang]});}
  finally{clearTimeout(timer);setBusy(false);}
 };
 const notice=usedNow?null:closed;
 return <form action={dispatch} onSubmit={submit} className="announcement-form" aria-busy={pending||undefined}><input type="hidden" name="lang" value={lang}/>{revisionId&&<input type="hidden" name="revision" value={revisionId}/>}
  <label hidden={Boolean(revisionId)} className="profile-input">{en?'Publication duration':'Yayında kalma süresi'}<select name="weeks" defaultValue="4" disabled={pending}>{Array.from({length:ANNOUNCEMENT_MAX_WEEKS},(_,i)=><option key={i+1} value={i+1}>{i+1} {en?(i?'weeks':'week'):'hafta'}</option>)}</select></label>
  <label className="profile-input">{en?'Announcement text':'Duyuru metni'}<textarea name="text" minLength={ANNOUNCEMENT_MIN} required rows={6} value={text} onChange={e=>setText(e.target.value)} readOnly={pending} aria-invalid={tooLong||undefined} aria-describedby="announcement-count"/></label>
  <p id="announcement-count" className={tooLong?'char-count over':'char-count'}>{length.toLocaleString(en?'en':'tr')} / {ANNOUNCEMENT_MAX.toLocaleString(en?'en':'tr')}</p>
  {tooLong&&<p role="alert" className="form-error">{en?`The text is ${length-ANNOUNCEMENT_MAX} characters over the ${ANNOUNCEMENT_MAX} limit. Shorten it before publishing.`:`Metin ${ANNOUNCEMENT_MAX} karakter sınırını ${length-ANNOUNCEMENT_MAX} karakter aşıyor. Yayımlamadan önce kısaltın.`}</p>}
  <fieldset className="wanted-skills-wrap" disabled={pending}><AnnouncementSkills lang={lang} initial={initialSkills}/></fieldset>
  <button className="button publish-ai" type="submit" disabled={disabled} aria-busy={pending||undefined}>{revisionId?(en?'Review and publish my revision':'Revizyonumu denetle ve yayımla'):(en?'Publish with AI assistance':'Yapay Zekâ Desteğiyle Yayımla')}</button>
  <p role="status" aria-live="polite" className="publish-progress">{pending?(en?'Your announcement is being prepared and your potential collaborators are being found…':'Duyurunuz hazırlanıyor, potansiyel yarenleriniz bulunuyor…'):''}</p>
  {state&&<p role="alert" className="form-error">{state.mesaj}</p>}
  {notice&&<p role="status" className="form-notice">{notice}</p>}
  <p className="source-note">{revisionId?(en?'You have one revision. AI checks the community rules; an accepted revision is published exactly as you wrote it. A rejected revision uses this right; technical failures do not.':'Bir revizyon hakkınız vardır. AI topluluk kurallarını denetler; uygun bulunan metin sizin yazdığınız biçimde yayımlanır. Reddedilen revizyon hakkı kullanır; teknik hatalar kullanmaz.'):(en?'AI prepares a complete title and professional announcement without inventing facts, checks the community rules and finds potential collaborators. One initial submission and one revision are allowed per day; technical failures do not consume the allowance.':'AI bilgilerinizi uydurmadan tam bir başlık ve profesyonel duyuru metni hazırlar, topluluk kurallarını denetler ve potansiyel yarenleri bulur. Günde bir ilk gönderim ve bir revizyon hakkınız vardır; teknik hatalar hakkınızı tüketmez.')}</p>
  <p className="source-note"><Link href={en?'/en/appeal':'/tr/itiraz'}>{en?'Request human review of a decision':'Karara itiraz et ve insan incelemesi iste'}</Link></p>
  <AnnouncementRules lang={lang}/>
 </form>;
}
