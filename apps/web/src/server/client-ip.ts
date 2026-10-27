import {BlockList,isIP} from 'node:net';
/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/). CLOUDFLARE_IPS (comma separated CIDR)
 * replaces the list when Cloudflare publishes a change before this file is updated.
 */
export const CLOUDFLARE_RANGES=['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18',
 '190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13',
 '131.0.72.0/22','2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32'];
const lists=new Map<string,BlockList>();
function cloudflare(env:string|undefined){
 const key=env?.trim()||'';let list=lists.get(key);if(list)return list;list=new BlockList();
 for(const entry of key?key.split(','):CLOUDFLARE_RANGES){const [address,prefix]=entry.trim().split('/');const type=isIP(address);if(!type||!prefix)continue;
  list.addSubnet(address,Number(prefix),type===6?'ipv6':'ipv4');}
 lists.set(key,list);return list;
}
const plain=(value:string|null|undefined)=>{const v=value?.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/,'');return v&&isIP(v)?v:null;};
/** True when the address belongs to Cloudflare's edge. */
export function fromCloudflare(ip:string|null,env=process.env.CLOUDFLARE_IPS){const type=ip?isIP(ip):0;return type?cloudflare(env).check(ip!,type===6?'ipv6':'ipv4'):false;}
/**
 * Client address. The peer is the address that connected to the reverse proxy in front of the app: X-Real-IP,
 * otherwise the last X-Forwarded-For entry (Traefik and the Next.js server append the connecting address there).
 * CF-Connecting-IP is used only when that peer is a Cloudflare edge address; a request that reaches the origin
 * directly cannot forge it and is recorded with its own peer address. Anything that is not an IP is ignored.
 */
export function clientIp(get:(name:string)=>string|null|undefined,env=process.env.CLOUDFLARE_IPS){
 const forwarded=(get('x-forwarded-for')||'').split(',').map(v=>v.trim()).filter(Boolean);
 const peer=plain(get('x-real-ip'))||plain(forwarded.at(-1));
 if(!peer)return null;
 const cf=plain(get('cf-connecting-ip'));
 return cf&&fromCloudflare(peer,env)?cf:peer;
}
/**
 * User-Agent summary for a violation record (data minimisation): browser family and major version and the
 * operating system, e.g. "Chrome 130 · Windows"; unknown agents keep their first 60 safe characters.
 */
export function userAgent(get:(name:string)=>string|null|undefined){
 const ua=(get('user-agent')||'').replace(/[\p{Cc}\p{Cf}]/gu,' ').trim();if(!ua)return null;
 const browser=[[/Edg\/(\d+)/,'Edge'],[/OPR\/(\d+)/,'Opera'],[/Firefox\/(\d+)/,'Firefox'],[/Chrome\/(\d+)/,'Chrome'],[/Version\/(\d+)[\d.]* .*Safari\//,'Safari'],[/curl\/(\d+)/,'curl']] as const;
 const os=[[/Windows/,'Windows'],[/Android/,'Android'],[/iPhone|iPad|iOS/,'iOS'],[/Mac OS X|Macintosh/,'macOS'],[/Linux/,'Linux']] as const;
 const b=browser.map(([re,name])=>{const m=ua.match(re);return m?`${name} ${m[1]}`:null;}).find(Boolean);
 const o=os.find(([re])=>re.test(ua))?.[1];
 const summary=[b,o].filter(Boolean).join(' · ');
 return summary||[...ua].slice(0,60).join('');
}

/** Coarse upload abuse key: IPv6 /64 and IPv4 address; mapped IPv4 shares the IPv4 bucket. */
export function uploadNetwork(ip:string){
 const type=isIP(ip);if(type===4)return '4:'+ip;if(type!==6)return null;
 const canonical=new URL('http://['+ip+']/').hostname.slice(1,-1),parts=canonical.split('::'),left=parts[0]?parts[0].split(':'):[],right=parts[1]?parts[1].split(':'):[];
 const words=parts.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
 const values=words.map(w=>parseInt(w,16));
 if(values.slice(0,5).every(v=>v===0)&&values[5]===65535)return '4:'+[(values[6]>>8)&255,values[6]&255,(values[7]>>8)&255,values[7]&255].join('.');
 return '6:'+values.slice(0,4).map(v=>v.toString(16).padStart(4,'0')).join(':')+'/64';
}
