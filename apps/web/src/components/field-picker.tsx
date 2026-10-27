'use client';
import {startTransition,useActionState,useState,type KeyboardEvent} from 'react';
import {areaIntake} from '@/server/area-actions';
import type {AreaProposal,AreaState} from '@/server/area-intake';
type Field={id:string;ad:string};
const fold=(s:string)=>s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ı/g,'i').replace(/\s+/g,' ').trim();

/**
 * Field selection for the profile form. Catalog fields are picked from the list. With allowNew, a name
 * that is not listed goes through the "Alan ekle" flow (area-actions.ts): database first, then a short AI
 * check for spelling and same-meaning fields. The added field is linked to the profile at once and shows
 * up here as selected. All buttons are type="button"; Enter never submits the surrounding profile form.
 */
export function FieldPicker({fields,initial,lang,name='areas',title,allowNew=false}:{fields:Field[];initial:string[];lang:string;name?:string;title?:string;allowNew?:boolean}){
 const tr=lang!=='en',hedef=name==='interests'?'ilgi':'alan';
 const [selected,setSelected]=useState(initial),[query,setQuery]=useState(''),[added,setAdded]=useState<Field[]>([]),[phase,setPhase]=useState<'denetle'|'onayla'>('denetle');
 const catalog=added.length?[...fields,...added.filter(a=>!fields.some(f=>f.id===a.id))]:fields;
 const needle=fold(query),typed=query.trim();
 const results=needle?catalog.filter(f=>fold(f.ad).includes(needle)&&!selected.includes(f.id)).slice(0,30):[];
 const exact=needle?catalog.find(f=>fold(f.ad)===needle):undefined;
 const add=(field:Field)=>{setAdded(list=>list.some(a=>a.id===field.id)?list:[...list,field]);setSelected(list=>list.includes(field.id)||list.length>=100?list:[...list,field.id]);};
 const [state,dispatch,pending]=useActionState(async(previous:AreaState,form:FormData):Promise<AreaState>=>{
  if(form.get('islem')==='vazgec')return null;
  const next=await areaIntake(previous,form);
  if(next?.durum==='eklendi'||next?.durum==='zaten'){const area=next.alan;startTransition(()=>{add({id:area.id,ad:area.ad});setQuery('');});}
  return next;
 },null);
 const send=(values:Record<string,string>)=>{const form=new FormData();form.set('lang',tr?'tr':'en');form.set('hedef',hedef);for(const [k,v] of Object.entries(values))form.set(k,v);setPhase(values.islem==='onayla'?'onayla':'denetle');startTransition(()=>dispatch(form));};
 const checkName=(text:string)=>{if(text.trim().length>=2)send({islem:'denetle',ad:text});};
 const onSearchKey=(e:KeyboardEvent<HTMLInputElement>)=>{if(e.key!=='Enter')return;e.preventDefault();if(exact){if(!selected.includes(exact.id))add(exact);setQuery('');}else if(allowNew)checkName(query);};
 const proposal:AreaProposal|null=state?.durum==='oneri'?state:state?.durum==='hata'?state.oneri:null;
 return <fieldset className="field-picker"><legend>{title||(tr?'Çalışma alanların':'Your research fields')}</legend>
  {selected.map(id=>{const field=catalog.find(f=>f.id===id);return <label key={id}><input type="checkbox" name={name} value={id} checked onChange={()=>setSelected(selected.filter(x=>x!==id))}/>{field?.ad}</label>;})}
  <label className="field-search">{tr?'Alan ekle':'Add a field'}<input type="search" value={query} maxLength={120} onChange={e=>setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder={tr?'Alan havuzunda ara':'Search research fields'}/></label>
  {results.length>0&&<ul>{results.map(f=><li key={f.id}><button type="button" onClick={()=>{add(f);setQuery('');}}>{f.ad} <span aria-hidden="true">＋</span></button></li>)}</ul>}
  {allowNew&&typed.length>=2&&!exact&&!(proposal&&fold(proposal.girdi)===needle)&&<button type="button" className="area-new" disabled={pending} onClick={()=>checkName(query)}>{tr?`Listede yok mu? “${typed}” alanını ekle`:`Not listed? Add “${typed}”`}</button>}
  {!allowNew&&typed.length>=2&&results.length===0&&<p className="source-note area-hint">{tr?'Bu ad havuzda yok. Profilin oluşturulduktan sonra Profilim sayfasından yeni alan olarak ekleyebilirsin.':'This name is not in the catalog. Once your profile exists, you can add it as a new field on My profile.'}</p>}
  {allowNew&&<div className="area-intake" aria-live="polite">
   {pending&&<p role="status">{phase==='onayla'?(tr?'Ekleniyor…':'Adding…'):(tr?'Denetleniyor…':'Checking…')}</p>}
   {!pending&&state?.durum==='eklendi'&&<p role="status" className="area-done">{state.birebir?(tr?`“${state.alan.ad}” havuzda zaten vardı; profiline eklendi.`:`“${state.alan.ad}” was already in the catalog; it was added to your profile.`):state.yeni?(tr?`“${state.alan.ad}” yeni alan olarak eklendi ve profiline bağlandı. Herkes görebilir, diğer araştırmacılar da seçebilir.`:`“${state.alan.ad}” was added as a new field and linked to your profile. Everyone can see it and other researchers can choose it.`):(tr?`“${state.alan.ad}” profiline eklendi.`:`“${state.alan.ad}” was added to your profile.`)}</p>}
   {!pending&&state?.durum==='zaten'&&<p role="status" className="area-done">{tr?`“${state.alan.ad}” zaten profilinde.`:`“${state.alan.ad}” is already on your profile.`}</p>}
   {state?.durum==='gecersiz'&&<p role="alert" className="form-error">{state.gerekce}</p>}
   {state?.durum==='hata'&&<p role="alert" className="form-error">{state.error}</p>}
   {proposal&&<Proposal key={proposal.denetimId} p={proposal} tr={tr} pending={pending} onPick={id=>send({islem:'onayla',denetim:proposal.denetimId,secim:'mevcut',alan:id})} onNew={()=>send({islem:'onayla',denetim:proposal.denetimId,secim:'yeni'})} onRecheck={text=>{setQuery(text);checkName(text);}} onCancel={()=>send({islem:'vazgec'})}/>}
  </div>}
 </fieldset>;
}

function Proposal({p,tr,pending,onPick,onNew,onRecheck,onCancel}:{p:AreaProposal;tr:boolean;pending:boolean;onPick:(id:string)=>void;onNew:()=>void;onRecheck:(text:string)=>void;onCancel:()=>void}){
 const [draft,setDraft]=useState(p.duzeltilmisAd),edited=draft.trim()!==p.duzeltilmisAd,linked=(id:string)=>p.profilde.includes(id);
 const onKey=(e:KeyboardEvent<HTMLInputElement>)=>{if(e.key!=='Enter')return;e.preventDefault();if(edited)onRecheck(draft);else onNew();};
 return <div className="area-proposal">
  {p.karar==='mevcut'&&p.mevcut?<>
   <p className="area-question"><strong>{tr?'Bunu mu demek istediniz:':'Did you mean:'}</strong> {p.mevcut.ad}?{linked(p.mevcut.id)&&<span className="area-linked"> {tr?'(zaten profilinde)':'(already on your profile)'}</span>}</p>
   <div className="area-buttons"><button type="button" className="button" disabled={pending||linked(p.mevcut.id)} onClick={()=>onPick(p.mevcut!.id)}>{tr?'Evet, bu alanı ekle':'Yes, add this field'}</button><button type="button" className="area-secondary" disabled={pending} onClick={onNew}>{tr?'Hayır, farklı bir alan':'No, a different field'}</button></div>
   <p className="source-note">{tr?`“Hayır” derseniz yeni alan şu adla eklenir: ${p.duzeltilmisAd}`:`If you choose “No”, a new field is added as: ${p.duzeltilmisAd}`}</p>
  </>:<>
   <label className="profile-input">{tr?'Şu şekilde eklenecek':'It will be added as'}<input value={draft} maxLength={120} onChange={e=>setDraft(e.target.value)} onKeyDown={onKey}/></label>
   {p.denetlendi?p.girdi!==p.duzeltilmisAd&&<p className="source-note">{tr?`Yazdığınız: ${p.girdi}. Yazım ve büyük harfler düzeltildi.`:`You typed: ${p.girdi}. Spelling and capitals were corrected.`}</p>:<p className="source-note">{tr?'Yazım denetimi şu an yapılamadı; ad yalnız biçim kurallarıyla düzenlendi. Lütfen kontrol edin.':'The spelling check is not available right now; only formatting rules were applied. Please check the name.'}</p>}
   <div className="area-buttons">{edited?<button type="button" className="button" disabled={pending||draft.trim().length<2} onClick={()=>onRecheck(draft)}>{tr?'Yeniden denetle':'Check again'}</button>:<button type="button" className="button" disabled={pending} onClick={onNew}>{tr?'Onayla ve ekle':'Confirm and add'}</button>}</div>
   <p className="source-note">{tr?'Yeni alan hemen herkese görünür; diğer araştırmacılar da seçebilir.':'A new field is visible to everyone at once; other researchers can choose it too.'}</p>
  </>}
  {p.adaylar.length>0&&<><p className="area-similar-label">{tr?'Yakın alanlar':'Close fields'}</p><ul>{p.adaylar.map(c=><li key={c.id}><button type="button" disabled={pending||linked(c.id)} onClick={()=>onPick(c.id)}>{c.ad}<span>{linked(c.id)?(tr?'profilinde':'on your profile'):<span aria-hidden="true">＋</span>}</span></button></li>)}</ul></>}
  <button type="button" className="text-link" disabled={pending} onClick={onCancel}>{tr?'Vazgeç':'Cancel'}</button>
 </div>;
}
