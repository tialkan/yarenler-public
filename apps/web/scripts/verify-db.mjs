import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
const name='yarenler_check_'+Date.now();const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
const sql=await readFile(new URL('../../../db/migrations/0001_init.sql',import.meta.url),'utf8');
let test;
try{
 await admin.query(`CREATE DATABASE ${name}`);test=new Pool({connectionString:url.toString(),max:1});
 const up=sql.split('-- migrate:up')[1].split('-- migrate:down')[0],down=sql.split('-- migrate:down')[1];
 await test.query(up);await test.query(down);await test.query(up);
 await test.query(`DO $$ BEGIN IF yarenler_katla('Şükrü IŞIK') <> 'sukru isik' THEN RAISE EXCEPTION 'Türkçe katlama'; END IF; IF NOT ('Çağrı' > 'Cuma' COLLATE tr_icu) THEN RAISE EXCEPTION 'Türkçe sıralama'; END IF; END $$`);
 const i=(await test.query("INSERT INTO institution(kisa_ad,ad,ulke) VALUES('test','Test Kurumu','TR') RETURNING id")).rows[0].id;
 const p=(await test.query("INSERT INTO person(kisa_kimlik,institution_id,ad,soyad,gorunen_ad) VALUES('test01',$1,'Örnek','Araştırmacı','Örnek Araştırmacı') RETURNING id",[i])).rows[0].id;
 for(const weeks of [0,15]){let rejected=false;try{await test.query("INSERT INTO announcement(sahip_id,ham_metin,yayin_metni,sure_hafta,bitis) VALUES($1,repeat('a',25),repeat('b',25),$2,now()+interval '1 week')",[p,weeks]);}catch(e){if(e.code==='23514')rejected=true;else throw e;}if(!rejected)throw new Error('Geçersiz süre kabul edildi');}
 await test.query("INSERT INTO announcement(sahip_id,ham_metin,yayin_metni,sure_hafta,bitis) VALUES($1,repeat('a',25),repeat('b',25),14,now()+interval '14 weeks')",[p]);
 console.log('Göç up/down/up, Türkçe katlama/sıralama ve 0/14/15 hafta sınırları geçti.');
}finally{if(test)await test.end();await admin.query(`DROP DATABASE IF EXISTS ${name}`);await admin.end();}
