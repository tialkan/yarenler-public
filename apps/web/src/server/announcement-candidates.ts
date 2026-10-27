import 'server-only';
import {announcementMatches} from './semantic';
import {proximityScores,skillMatches} from './network';
import {bandLabel,bandTitle} from './score-bands';
import type {PublishCandidate} from './announcement-moderation';

/**
 * Potential collaborators for a just published announcement (the existing matching: catalogue phrases from the
 * AI review, publication titles and, when configured, the semantic service). A field proximity band
 * (score-bands.ts) is shown when the author and the candidate share catalogue fields. Ends within timeoutMs.
 */
export async function announcementCandidates(o:{text:string;keywords:string[];author:string;lang:'tr'|'en';timeoutMs:number;skills?:string[]}):Promise<PublishCandidate[]>{
 const candidates=o.skills?.length?await skillMatches(o.skills,o.author):(await announcementMatches(o.text,o.keywords,o.author,{timeoutMs:o.timeoutMs})).candidates;
 const scores=await proximityScores(o.author,candidates.map(c=>c.id)).catch(()=>new Map<string,number>());
 return candidates.map(c=>{const score=scores.get(c.id);return {id:c.id,name:c.name,unit:c.unit,url:c.url,reasons:c.reasons,band:score===undefined?null:{label:bandLabel(score,o.lang),title:bandTitle(score,o.lang)}};});
}
