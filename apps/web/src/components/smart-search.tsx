'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
type Suggestion={kind:'person'|'field';id:string;label:string;detail:string;url:string};
type Status='idle'|'waiting'|'ready'|'error'|'submitting';
export function SmartSearch({lang,value='',label,placeholder,button,networkMode=false}:{lang:string;value?:string;label:string;placeholder:string;button:string;networkMode?:boolean}){
 const [query,setQuery]=useState(value),[items,setItems]=useState<Suggestion[]>([]),[active,setActive]=useState(-1),[open,setOpen]=useState(false),[status,setStatus]=useState<Status>(value.trim().length>=3?'waiting':'idle');
 const router=useRouter(),id=useId(),ref=useRef<HTMLDivElement>(null),en=lang==='en';
 useEffect(()=>{
  if(query.trim().length<3)return;
  const abort=new AbortController();
  const timer=setTimeout(async()=>{
   try{
    const response=await fetch(`/api/suggest?q=${encodeURIComponent(query.trim())}&lang=${lang}`,{signal:abort.signal});
    if(!response.ok)throw new Error('suggest');
    const result:Suggestion[]=await response.json();
    if(abort.signal.aborted)return;
    setItems(result);setActive(-1);setOpen(true);setStatus('ready');
   }catch{if(!abort.signal.aborted)setStatus('error');}
  },180);
  return()=>{clearTimeout(timer);abort.abort();};
 },[query,lang]);
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 const pick=(item:Suggestion)=>{
  if(item.kind==='person'&&networkMode){window.dispatchEvent(new CustomEvent('yarenler:focus-person',{detail:item.id}));window.history.replaceState(null,'',`/${lang}?person=${item.id}`);setStatus('ready');}
  else{setStatus('submitting');router.push(item.kind==='person'?`/${lang}?person=${item.id}`:item.url);}
  setOpen(false);
 };
 const visible=open&&items.length>0,busy=status==='waiting'||status==='submitting';
 const message=status==='waiting'?(en?'Searching names and fields…':'Kişi ve alanlar aranıyor…'):status==='submitting'?(en?'Loading results…':'Sonuçlar yükleniyor…'):status==='error'?(en?'Suggestions could not load. Use Search to view results.':'Öneriler yüklenemedi. Sonuçlar için Keşfet’e basabilirsiniz.'):status==='ready'&&!items.length?(en?'No suggestions. You can still search.':'Öneri bulunamadı. Aramayı yine de başlatabilirsiniz.'):status==='idle'?(en?'Type at least 3 characters for suggestions.':'Öneriler için en az 3 karakter yazın.') : '';
 return <form onSubmit={e=>{
  if(networkMode){const nameMatch=items.find(item=>item.kind==='person'&&item.label.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')));if(nameMatch){e.preventDefault();pick(nameMatch);return;}}
  setStatus('submitting');setOpen(false);
 }} action={`/${lang}/${en?'explore':'kesfet'}`} className="search-form smart-search">
  <label htmlFor={id}>{label}</label><div ref={ref}>
   <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5"/><path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.5"/></svg>
   <input id={id} name="q" value={query} onChange={e=>{const next=e.target.value;setQuery(next);setItems([]);setActive(-1);setOpen(false);setStatus(next.trim().length>=3?'waiting':'idle');}} onFocus={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);else if(visible&&e.key==='ArrowDown'){e.preventDefault();setActive((active+1)%items.length);}else if(visible&&e.key==='ArrowUp'){e.preventDefault();setActive((active-1+items.length)%items.length);}else if(visible&&e.key==='Enter'&&active>=0){e.preventDefault();pick(items[active]);}}} placeholder={placeholder} maxLength={120} role="combobox" aria-expanded={visible} aria-autocomplete="list" aria-controls={visible?id+'-options':undefined} aria-activedescendant={visible&&active>=0?id+'-'+active:undefined} aria-describedby={id+'-status'} autoComplete="off" aria-busy={busy}/>
   <button type="submit" disabled={status==='submitting'}>{status==='submitting'?(en?'Loading…':'Yükleniyor…'):button}<span aria-hidden="true"> ↗</span></button>
   {visible&&<ul id={id+'-options'} role="listbox" aria-label={label}>{items.map((item,i)=><li role="option" aria-selected={active===i} id={id+'-'+i} key={item.id}><a href={item.kind==='person'?`/${lang}?person=${item.id}`:item.url} onMouseEnter={()=>setActive(i)} onClick={e=>{if(e.ctrlKey||e.metaKey)return;e.preventDefault();pick(item);}}><strong>{item.label}</strong><span>{item.detail}</span></a></li>)}</ul>}
  </div><p id={id+'-status'} className="search-status" role="status" aria-live="polite">{message}</p>
 </form>;
}
