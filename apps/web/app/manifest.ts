import type {MetadataRoute} from 'next';
/** Web app manifest at /manifest.webmanifest; icons are the existing brand files. */
export default function manifest():MetadataRoute.Manifest{
 return {name:'Yarenler · Akademik yarenini bul.',short_name:'Yarenler',description:'AYBÜ araştırmacılarını ve çalışma alanlarını keşfet; ortak alanlardan akademik işbirlikleri.',lang:'tr',dir:'ltr',start_url:'/tr',scope:'/',display:'standalone',background_color:'#ffffff',theme_color:'#1683A8',
  icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/apple-touch-icon.png',sizes:'180x180',type:'image/png',purpose:'any'},{src:'/brand/yarenler-isaret.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]};
}
