/** Pure matching rules, shared with regression tests. */
export function broad(label:string){return /\((soc|sci|eng|med|life|ahci)\)|^(genel |[^ ].* genel$|sosyal ve beşeri bilimler$|mühendislik ve teknoloji$|sağlık bilimleri$|temel bilimler)/i.test(label);}
export function foldResearch(s:string){return s.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
export function matchesResearchTerm(label:string,term:string){
 const normal=foldResearch(label),query=foldResearch(term);if(normal.length<3||query.length<3)return false;
 const words=(value:string)=>value.split(' ').filter(w=>w.length>=3&&!['and','the','for','ile','bir','genel','research','arastirma'].includes(w));
 return words(normal).some(a=>words(query).some(b=>a===b||(Math.min(a.length,b.length)>=4&&(a.startsWith(b)||b.startsWith(a)))));
}
export function compare(a:{labels:Set<string>;weight:number},b:{labels:Set<string>;weight:number},weights:Map<string,number>,display:Map<string,string>){const shared=[...a.labels].filter(key=>b.labels.has(key));if(!shared.length)return null;const intersection=shared.reduce((sum,key)=>sum+weights.get(key)!,0),min=Math.min(a.weight,b.weight),union=a.weight+b.weight-intersection;let value=.65*(min?intersection/min:0)+.35*(union?intersection/union:0);if(!shared.some(key=>!broad(display.get(key)||'')))value=Math.min(value,.15);return {score:Math.round(value*100),reasons:shared.sort((x,y)=>weights.get(y)!-weights.get(x)!).map(key=>display.get(key)!)};}

/* Announcement text matching (v3). Generic words and institution phrases are never evidence on their own. */
const STOP_STEMS=['teknoloji','technolog','sistem','system','bilim','bilgi','scien','fakulte','facult','enstitu','institu','yuksekokul','genel','general','temel','basic','fundamental','yonetim','manage','uygula','applic','applied','calisma','study','studies','proje','project','arastirma','research','gelistir','develop','analiz','analys','yontem','method','model','alan','field','konu','topic','hoca','akademi','academ','universite','univers','bolum','department','dali','ana','dijital','digital','yeni','modern','ileri','advanced','uzman','tercih','merkez','center','centre','ulusal','national','uluslararasi','international','sosyal','social','idari','administrat','iktisadi','ekonomik','economic','muhendis','engineer','saglik','health','egitim','education','turk','turkiye','turkish','tubitak','horizon','erasmus','destek','support','program','cagri','call','hafta','week','icin','olan','uzerine','ile','and','the','for','with','about','bir','ve','veya','also','tercihen','ariyorum','projem','projesi'];
const INSTITUTION_PHRASES=[/\b(iktisadi ve idari bilimler|siyasal bilgiler|muhendislik ve doga bilimleri|insan ve toplum bilimleri|saglik bilimleri|sosyal bilimler|fen bilimleri|mimarlik ve guzel sanatlar|havacilik ve uzay bilimleri|teknik bilimler|uygulamali bilimler|spor bilimleri)( fakultesi| fakulte| enstitusu| meslek yuksekokulu)?\b/g,/\b\w+ (fakultesi|enstitusu|yuksekokulu|universitesi)\b/g,/\biibf\b/g,/\b\d{4}\b/g];
export function isStopToken(token:string){return token.length<3||STOP_STEMS.some(stem=>token===stem||(stem.length>=4&&token.startsWith(stem)));}
export function researchTokens(text:string){let folded=' '+foldResearch(text)+' ';for(const pattern of INSTITUTION_PHRASES)folded=folded.replace(pattern,' ');return [...new Set(folded.split(' ').filter(token=>token&&!isStopToken(token)))];}
const SUFFIX=/^(s|es|ed|ing|al|ary|ic|ics|ial|ial|i|si|in|nin|un|lar|ler|lari|leri|larin|lerin|ci|cilik|cilig|lik|lig|sal|sel|man|e|a|ya|ye|da|de|y|ies)$/;
/** Same word with Turkish/English suffixes: exact, or the shorter (>=4) is a prefix and the rest is a common suffix, or a shared stem of >=5 letters covering the shorter minus 3. */
export function sameStem(a:string,b:string){if(a===b)return true;const [s,l]=a.length<=b.length?[a,b]:[b,a];if(s.length>=4&&l.startsWith(s)&&SUFFIX.test(l.slice(s.length)))return true;let i=0;while(i<s.length&&s[i]===l[i])i++;return i<s.length&&i>=5&&i>=s.length-3;}
export type TextReason={field:string;term:string;strength:number};
export type TextPerson={id:string;labels:string[];interests:string[];faculty?:string|null};
/**
 * Ranks people for an announcement. tokenIdf comes from tokenStatistics over the same people.
 * A label is evidence when its matched distinctive tokens carry enough IDF (one rare word, or two words).
 */
export function tokenStatistics(people:TextPerson[]){const df=new Map<string,number>();for(const p of people){const seen=new Set<string>();for(const label of p.labels)for(const t of researchTokens(label))seen.add(t);for(const t of seen)df.set(t,(df.get(t)||0)+1);}const n=people.length||1,idf=new Map<string,number>();for(const [t,c] of df)idf.set(t,Math.log((n+1)/(c+1)));return idf;}
export const MIN_SINGLE_IDF=2.5,MIN_REASON=2.5,MAX_REASONS=3;
export function rankTextMatches(people:TextPerson[],terms:string[],idf:Map<string,number>,options:{excludeId?:string|null;limit?:number;text?:string}={}){
 const queries=[...new Set(terms.map(t=>t.trim()).filter(Boolean))].slice(0,24).map(term=>({term,tokens:researchTokens(term)})).filter(q=>q.tokens.length);
 const fullText=' '+foldResearch(options.text||terms.join(' '))+' ';
 const results=people.filter(p=>p.id!==options.excludeId).map(p=>{const reasons=new Map<string,TextReason>();
  for(const label of p.labels){const labelTokens=researchTokens(label);if(!labelTokens.length)continue;let best:TextReason|null=null;
   for(const q of queries){const hit=labelTokens.filter(lt=>q.tokens.some(qt=>sameStem(lt,qt)));if(!hit.length)continue;const strength=hit.reduce((s,t)=>s+(idf.get(t)??0),0);const enough=hit.length>=2?strength>=MIN_REASON:(idf.get(hit[0])??0)>=MIN_SINGLE_IDF;if(!enough)continue;const covered=hit.length/labelTokens.length;const value=strength*(.6+.4*covered);if(!best||value>best.strength){/* A whole announcement used as a query shows only the matching words, not the full text. */const term=q.term.split(/\s+/).length>6?label.split(/\s+/).filter(w=>researchTokens(w).some(t=>hit.includes(t))).join(' ')||q.term:q.term;best={field:label+(p.interests.includes(label)?' (işbirliği ilgisi)':''),term,strength:value};}}
   if(best&&(!reasons.has(label)||reasons.get(label)!.strength<best.strength))reasons.set(label,best);}
  const top=[...reasons.values()].sort((a,b)=>b.strength-a.strength).slice(0,MAX_REASONS);let score=top.reduce((s,r,i)=>s+r.strength/(i+1),0);
  const faculty=p.faculty?foldResearch(p.faculty):'';if(score&&faculty.length>8&&fullText.includes(' '+faculty.replace(/ (fakultesi|enstitusu|meslek yuksekokulu|yuksekokulu)$/,'')+' '))score*=1.15;
  return {id:p.id,score,reasons:top};}).filter(r=>r.reasons.length&&r.reasons[0].strength>=MIN_REASON).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 return results.slice(0,options.limit??8);
}
/**
 * Deterministic tie-break for equal scores that does not favour any name: an FNV-1a hash of the
 * unordered pair. Sorting ties by name used to send many links to researchers whose names start with "A".
 */
export function pairTieBreak(a:string,b:string){const key=a<b?a+'|'+b:b+'|'+a;let h=0x811c9dc5;for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;}
