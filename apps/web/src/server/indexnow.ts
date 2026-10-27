import 'server-only';
import {db} from './db';
import {personPath} from './model';
export async function notifyIndexNow(paths:string[]){
 const key=process.env.INDEXNOW_KEY,base=process.env.PUBLIC_BASE_URL;
 if(!key||base!=='https://yarenler.org')return false;
 const urls=[...new Set(paths.filter(p=>p.startsWith('/')&&!p.startsWith('//')).map(p=>base+p))];
 if(!urls.length)return true;
 try{const response=await fetch('https://api.indexnow.org/indexnow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:'yarenler.org',key,keyLocation:base+'/indexnow-key.txt',urlList:urls.slice(0,10000)}),signal:AbortSignal.timeout(10000)});return response.status===200||response.status===202;}catch{return false;}
}
export async function notifyProfile(id:string){const p=(await db().query('SELECT kisa_kimlik,gorunen_ad FROM person WHERE id=$1',[id])).rows[0];if(p)await notifyIndexNow([personPath(p.kisa_kimlik,p.gorunen_ad),personPath(p.kisa_kimlik,p.gorunen_ad,'en')]);}
