/** RSS 2.0 feed builder (with atom:link self and dc:creator), shared with tests. */
// XML 1.0 forbids most control characters; they are removed rather than escaped.
const INVALID=/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export function xml(value:string){return value.replace(INVALID,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
export type FeedItem={title:string;link:string;guid:string;description:string;pubDate:Date;creator?:string;categories?:string[]};
export function rssFeed({title,link,self,description,language,items,lastBuildDate}:{title:string;link:string;self:string;description:string;language:'tr'|'en';items:FeedItem[];lastBuildDate?:Date}){
 const built=lastBuildDate||items.reduce<Date|undefined>((max,i)=>!max||i.pubDate>max?i.pubDate:max,undefined)||new Date(0);
 const entries=items.map(i=>`<item><title>${xml(i.title)}</title><link>${xml(i.link)}</link><guid isPermaLink="true">${xml(i.guid)}</guid><pubDate>${i.pubDate.toUTCString()}</pubDate>${i.creator?`<dc:creator>${xml(i.creator)}</dc:creator>`:''}${(i.categories||[]).map(c=>`<category>${xml(c)}</category>`).join('')}<description>${xml(i.description)}</description></item>`).join('');
 return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${xml(title)}</title><link>${xml(link)}</link><description>${xml(description)}</description><language>${language==='tr'?'tr-TR':'en'}</language><lastBuildDate>${built.toUTCString()}</lastBuildDate><atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>${entries}</channel></rss>\n`;
}
