/** Pure visual rules for the research network, shared with regression tests. */
// Faculty tones are small hue/lightness shifts around the brand colour #1683A8; colour alone never carries meaning.
const tones:[number,number,number][]=[[196,77,37],[191,58,40],[201,55,33],[196,42,48],[205,48,41],[187,52,35]];
function hex([h,s,l]:[number,number,number]){const a=s/100*Math.min(l/100,1-l/100),f=(n:number)=>{const k=(n+h/30)%12,c=l/100-a*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(255*c).toString(16).padStart(2,'0');};return `#${f(0)}${f(8)}${f(4)}`;}
export const facultyPalette=['#1683a8',...tones.slice(1).map(hex)];
export function facultyTone(group:string){let n=0;for(const c of group)n=(n*31+c.charCodeAt(0))|0;return facultyPalette[Math.abs(n)%facultyPalette.length];}
export type Edge={source:string;target:string;score:number};
export function degrees(nodeIds:string[],links:Edge[]){const result=new Map<string,number>(nodeIds.map(id=>[id,0]));for(const edge of links){result.set(edge.source,(result.get(edge.source)||0)+1);result.set(edge.target,(result.get(edge.target)||0)+1);}return result;}
/** Line width grows with the field-similarity score so closer matches read as stronger. */
export function linkWidth(score:number,touchesSelection:boolean,selectionActive:boolean){if(touchesSelection)return .6+Math.max(0,Math.min(100,score))/100*3.4;return selectionActive?.25:.3+Math.max(0,Math.min(100,score))/100*.6;}
/** Keep unconnected researchers visible in the full network. */
export function nodeAlpha({selected,isSelected,isNeighbour,degree}:{selected:boolean;isSelected:boolean;isNeighbour:boolean;degree:number}){if(isSelected||isNeighbour)return 'ee';if(selected)return '16';return degree>0?'cc':'88';}
