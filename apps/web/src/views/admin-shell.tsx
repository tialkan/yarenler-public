import Link from 'next/link';
import type {ReactNode} from 'react';
import {logout} from '@/server/admin-actions';

const NAV=[['', 'Özet'],['/alanlar','Alanlar'],['/duyurular','Duyurular'],['/profiller','Profiller'],['/talepler','Sahiplenme talepleri'],['/ihlaller','İhlaller'],['/itirazlar','İtirazlar'],['/kurumlar','Kurum başvuruları'],['/ayarlar','Ayarlar'],['/kayit','İşlem kaydı']] as const;
export type AdminSection=typeof NAV[number][0];

export function AdminShell({current,children}:{current:AdminSection;children:ReactNode}){
 return <><a className="adm-skip" href="#icerik">İçeriğe geç</a>
  <header className="adm-header"><Link className="adm-brand" href="/yonetici">Yarenler · Yönetici</Link>
   <nav className="adm-nav" aria-label="Panel">{NAV.map(([path,label])=><Link key={path} href={'/yonetici'+path} aria-current={current===path?'page':undefined}>{label}</Link>)}</nav>
   <form action={logout}><button type="submit" className="adm-link-button">Çıkış</button></form>
  </header>
  <main id="icerik" className="adm-main">{children}<p className="adm-note">Oturum en çok 8 saat sürer; 30 dakika işlem yapılmazsa kapanır. Her değişiklik işlem kaydına yazılır.</p></main></>;
}

const DATE=new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Istanbul'});
const DAY=new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeZone:'Europe/Istanbul'});
export const when=(d:Date|string|null|undefined)=>d?DATE.format(new Date(d)):'';
export const day=(d:Date|string|null|undefined)=>d?DAY.format(new Date(d)):'';
export const clip=(s:string|null|undefined,n:number)=>{const t=(s||'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n-1)+'…':t;};

/** Query string helper: keeps the given filters, drops empty ones. */
export function query(params:Record<string,string|number|undefined|null>){const q=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null&&v!==''&&!(k==='sayfa'&&Number(v)<=1))q.set(k,String(v));const s=q.toString();return s?'?'+s:'';}
export function Pager({base,sayfa,toplam,size,params}:{base:string;sayfa:number;toplam:number;size:number;params:Record<string,string>}){
 const last=Math.max(1,Math.ceil(toplam/size));if(last<=1)return null;
 return <nav className="adm-pager" aria-label="Sayfalar">{sayfa>1&&<Link href={base+query({...params,sayfa:sayfa-1})}>Önceki</Link>}<span>{sayfa} / {last}</span>{sayfa<last&&<Link href={base+query({...params,sayfa:sayfa+1})}>Sonraki</Link>}</nav>;
}
export function Filters({base,name,current,options,params}:{base:string;name:string;current:string;options:[string,string][];params:Record<string,string>}){
 return <nav className="adm-filters" aria-label="Süzgeç">{options.map(([value,label])=><Link key={value} href={base+query({...params,[name]:value,sayfa:1})} aria-current={current===value?'true':undefined}>{label}</Link>)}</nav>;
}
export const one=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]||'':v||'';
export const pageNumber=(v:string|string[]|undefined)=>{const n=Number(one(v));return Number.isInteger(n)&&n>0&&n<10000?n:1;};
export function announcementStatus(a:{durum:string;suresi_var:boolean;yonetici_kaldirdi:boolean;sahip_aktif:boolean}){
 if(a.durum==='kaldirildi')return a.yonetici_kaldirdi?'Kaldırıldı (yönetici)':'Kaldırıldı (sahibi)';
 if(!a.suresi_var)return 'Süresi doldu';
 return a.sahip_aktif?'Yayında':'Gizli profil';
}
export function visibilityLabel(p:{aktif:boolean;yonetici_gizledi:boolean}){return p.aktif?'Görünür':p.yonetici_gizledi?'Gizli (yönetici)':'Kaldırıldı (sahibi)';}
