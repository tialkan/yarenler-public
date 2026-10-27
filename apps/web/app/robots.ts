import type {MetadataRoute} from 'next';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{const on=process.env.INDEXABLE==='true';return {rules:{userAgent:'*',allow:on?'/':undefined,disallow:on?['/api/','/tr/profilim','/en/my-profile','/tr/arama','/en/arama']:'/'},sitemap:on?`${process.env.PUBLIC_BASE_URL}/sitemap.xml`:undefined};}
