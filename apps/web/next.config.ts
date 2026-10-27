import type { NextConfig } from 'next';
const config: NextConfig = {
  // ISR keeps rendered pages only in an LRU memory cache (64 MB): unknown or random URLs (404s, slug
  // variants that redirect) can never fill the disk, and a restart simply re-renders on demand.
  output: 'standalone', serverExternalPackages:['pdf-lib'], experimental:{inlineCss:true,isrFlushToDisk:false,serverActions:{bodySizeLimit:'10mb'}}, cacheMaxMemorySize:64*1024*1024, distDir:process.env.NODE_ENV==='development'?'.next-dev':'.next', poweredByHeader: false,
  outputFileTracingRoot: process.cwd() + '/../..',
  // The front server (scripts/front-server.mjs) gzips responses after computing the HTML CSP hashes.
  compress: false,
  // Pages are cached by Next.js (ISR) and the CDN; ETag revalidation would let a 304 skip the CSP step.
  generateEtags: false,
  // Metadata always in <head>: cached HTML is the same for browsers and crawlers.
  htmlLimitedBots: /.*/,
  async redirects() { return [{source:'/',destination:'/tr',permanent:true},{source:'/site.webmanifest',destination:'/manifest.webmanifest',permanent:true}]; },
  async headers() { return [{source:'/brand/:path*',headers:[{key:'Cache-Control',value:'public, max-age=86400, stale-while-revalidate=604800'}]},{source:'/images/:path*',headers:[{key:'Cache-Control',value:'public, max-age=86400, stale-while-revalidate=604800'}]},{source:'/fonts/:path*',headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]},{source:'/(.*)',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
    // Two years, all subdomains, preload list ready (see DEVIR.md before submitting to hstspreload.org).
    {key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains; preload'},
  ]}];}
};
export default config;
