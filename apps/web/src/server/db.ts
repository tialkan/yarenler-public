import {Pool} from 'pg';
const state=globalThis as unknown as {yarenlerPool?:Pool};
export function db(){
 if(!process.env.DATABASE_URL)throw new Error('Veritabanı yapılandırılmadı');
 if(!state.yarenlerPool){state.yarenlerPool=new Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:8000});state.yarenlerPool.on('error',()=>console.error('Veritabanı bağlantı hatası'));}
 return state.yarenlerPool;
}
