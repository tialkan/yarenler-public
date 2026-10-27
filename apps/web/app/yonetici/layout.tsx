import type {Metadata,Viewport} from 'next';
import './yonetici.css';
/**
 * Separate root layout for the panel: never cached (proxy and front server send no-store), never indexed
 * (X-Robots-Tag, robots meta, robots.txt Disallow, not in the sitemap). Every page reads the session cookie,
 * so all panel pages are rendered per request.
 */
export const dynamic='force-dynamic';
export const viewport:Viewport={themeColor:'#1683A8',width:'device-width',initialScale:1};
export const metadata:Metadata={title:{default:'Yönetici paneli | Yarenler',template:'%s | Yönetici paneli'},robots:{index:false,follow:false,nocache:true},referrer:'same-origin'};
export default function AdminRootLayout({children}:{children:React.ReactNode}){
 return <html lang="tr"><body className="adm">{children}</body></html>;
}
