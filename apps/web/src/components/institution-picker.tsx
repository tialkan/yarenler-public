'use client';
import {useEffect,useState} from 'react';
import type {InstitutionChoice} from '@/server/registration';
type Institution={id:string;ad:string;ulke:string|null};

/** Institution choices are optional; the independent choice never creates a fake institution. */
export function InstitutionPicker({choices,lang}:{choices:InstitutionChoice[];lang:string}){
 const tr=lang!=='en', [selection,setSelection]=useState(''),[query,setQuery]=useState(''),[results,setResults]=useState<Institution[]>([]),[loading,setLoading]=useState(false),[failure,setFailure]=useState(false),[chosen,setChosen]=useState<Institution|null>(null);
 useEffect(()=>{
  if(selection!=='__beyan'||query.trim().length<3)return;
  const controller=new AbortController();
  const timer=setTimeout(async()=>{setLoading(true);setFailure(false);try{const response=await fetch('/api/institutions/suggest?q='+encodeURIComponent(query.trim()),{signal:controller.signal});if(!response.ok)throw new Error('search');const data=await response.json();if(!controller.signal.aborted)setResults(data);}catch{if(!controller.signal.aborted){setResults([]);setFailure(true);}}finally{if(!controller.signal.aborted)setLoading(false);}},250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query,selection]);
 const choose=(value:string)=>{setSelection(value);setChosen(null);setResults([]);setLoading(false);setFailure(false);};
 return <fieldset className="institution-picker"><legend>{tr?'Kurum':'Institution'}</legend>
  <p className="source-note">{tr?'Bir kurum seçebilir veya bağımsız araştırmacı olarak katılabilirsin.':'Choose an institution or join as an independent researcher.'}</p>
  {choices.map(c=><label key={c.key}><input type="radio" name="institution" value={c.key} checked={selection===c.key} onChange={()=>choose(c.key)} required/>{c.name}{c.country&&<> · {c.country}</>}{c.detail&&<small> ({c.detail})</small>}</label>)}
  <label><input type="radio" name="institution" value="__independent" checked={selection==='__independent'} onChange={()=>choose('__independent')} required/>{tr?'Bağımsız araştırmacıyım':'I am an independent researcher'}</label>
  <label><input type="radio" name="institution" value={chosen?'pool:'+chosen.id:'__beyan'} checked={selection==='__beyan'||Boolean(chosen)} onChange={()=>choose('__beyan')} required/>{tr?'Kurumumu ara veya ekle':'Search for or add my institution'}</label>
  {(selection==='__beyan'||chosen)&&<div className="profile-input"><label>{tr?'Kurum adı':'Institution name'}<input type="search" name="kurum_beyan" value={chosen?.ad||query} onChange={e=>{setChosen(null);setSelection('__beyan');setResults([]);setLoading(false);setQuery(e.target.value);}} maxLength={120} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}} required placeholder={tr?'En az 3 harf yaz':'Type at least 3 letters'} autoComplete="off"/></label>
   <div aria-live="polite">{loading&&<p className="source-note">{tr?'Kurumlar aranıyor…':'Searching institutions…'}</p>}{failure&&<p className="source-note">{tr?'Listeye şu an ulaşılamıyor. Kurum adını yazarak devam edebilirsin.':'The list is unavailable. You can continue with the name you typed.'}</p>}</div>
   {results.length>0&&!chosen&&<ul>{results.map(item=><li key={item.id}><button type="button" onClick={()=>{setChosen(item);setResults([]);}}>{item.ad}{item.ulke?' · '+item.ulke:''}</button></li>)}</ul>}
   {!loading&&!chosen&&query.trim().length>=3&&<p className="source-note">{tr?'Listede yoksa yazdığın kurum adıyla devam edebilirsin.':'If it is not listed, continue with the name you entered.'}</p>}
  </div>}
 </fieldset>;
}
