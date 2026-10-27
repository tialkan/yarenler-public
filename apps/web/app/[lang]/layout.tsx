import type {Metadata,Viewport} from 'next';
import '../globals.css';
import {parseDsn} from '@/server/error-tracking';
import {jsonLd,organization,website} from '@/server/structured-data';
import {rssLinks} from '@/server/page-meta';
/**
 * Root layout inside [lang], so <html lang> is right in the server HTML without reading request
 * headers. Nothing here depends on the request: pages below can be cached (ISR, CDN).
 */
export const viewport:Viewport={themeColor:'#1683A8',width:'device-width',initialScale:1};
const base=()=>process.env.PUBLIC_BASE_URL||'http://localhost:3000';
export async function generateMetadata({params}:{params:Promise<{lang:string}>}):Promise<Metadata>{
 const lang=(await params).lang==='en'?'en':'tr';
 return {metadataBase:new URL(base()),title:{default:lang==='tr'?'Yarenler | Akademik yarenini bul.':'Yarenler | Find your research partner.',template:'%s | Yarenler'},applicationName:'Yarenler',authors:[{name:'Örnek Araştırmacı',url:'https://avesis.example.invalid/researcher'}],other:{'application-version':process.env.SOURCE_COMMIT||'0.4.0'},description:lang==='tr'?'AYBÜ akademisyenlerini ve çalışma alanlarını keşfet. Ortak araştırma alanlarından yeni işbirliklerine.':'Discover AYBU researchers and their research fields, from shared fields to new collaborations.',icons:{icon:[{url:'/favicon.ico',sizes:'any'},{url:'/brand/yarenler-isaret.svg',type:'image/svg+xml'}],apple:'/apple-touch-icon.png'},alternates:{types:rssLinks(lang)},robots:process.env.INDEXABLE==='true'?{index:true,follow:true}:{index:false,follow:false}};
}
export default async function RootLayout({children,params}:{children:React.ReactNode;params:Promise<{lang:string}>}){
 const lang=(await params).lang==='en'?'en':'tr';const errorDsn=parseDsn(process.env.SENTRY_DSN)?.publicDsn;
 const structured=jsonLd({'@context':'https://schema.org','@graph':[organization(base()),website(base())]});
 return <html lang={lang} data-scroll-behavior="smooth"><head><link rel="preload" href="/fonts/oswald-variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/><link rel="preload" href="/fonts/lato-regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/>{errorDsn&&<meta name="yarenler-error-dsn" content={errorDsn}/>}</head><body><script type="application/ld+json" dangerouslySetInnerHTML={{__html:structured}}/>{children}</body></html>;
}
