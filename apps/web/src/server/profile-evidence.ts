import 'server-only';
import {db} from './db';
import {fingerprintRows,type EvidenceRow,type FingerprintField} from './profile-fingerprint';
import {FIELD_EVIDENCE_SQL,COAUTHOR_SQL,PROFILE_SCOPE_SQL} from './profile-evidence-sql';
export {PROFILE_SCOPE_SQL};
export async function personFieldEvidence(id:string,fields:FingerprintField[],total:number){
 const {rows}=await db().query<EvidenceRow>(FIELD_EVIDENCE_SQL,[id]);return fingerprintRows(fields,rows,total);
}
export async function commonPublicationCounts(id:string){const {rows}=await db().query<{id:string;count:number}>(COAUTHOR_SQL,[id]);return new Map(rows.map(r=>[r.id,r.count]));}
