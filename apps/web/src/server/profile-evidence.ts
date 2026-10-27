import 'server-only';
import {db} from './db';
import {fingerprintRows,type EvidenceRow,type FingerprintField} from './profile-fingerprint';
import {FIELD_EVIDENCE_SQL,COAUTHOR_SQL,PROFILE_SCOPE_SQL} from './profile-evidence-sql';
export {PROFILE_SCOPE_SQL};
export async function personFieldEvidence(id:string,fields:FingerprintField[],total:number|Promise<number>){
 const evidence=db().query<EvidenceRow>(FIELD_EVIDENCE_SQL,[id]).then(result=>result.rows).catch(error=>{console.error('Profil yayın kanıtları geçici olarak kullanılamıyor:',(error as {code?:string}).code||'query_error');return [];});
 const [rows,count]=await Promise.all([evidence,total]);return fingerprintRows(fields,rows,count);
}
export async function commonPublicationCounts(id:string){const {rows}=await db().query<{id:string;count:number}>(COAUTHOR_SQL,[id]);return new Map(rows.map(r=>[r.id,r.count]));}
