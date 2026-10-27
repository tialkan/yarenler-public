#!/usr/bin/env node
/**
 * Panel şifre özeti üretir (YONETICI_SIFRE_HASH). Kendi bilgisayarınızda, depo kökünden:
 *
 *   node apps/web/scripts/admin-hash.mjs
 *
 * Şifre gizli girişle (ekranda görünmez) iki kez sorulur. Standart çıktıya yalnız özet yazılır;
 * şifre hiçbir yere yazılmaz ve kaydedilmez. Özeti Coolify'da YONETICI_SIFRE_HASH olarak tanımlayın;
 * tanımlıysa düz YONETICI_SIFRE yerine o kullanılır (düz şifreyi Coolify'dan silebilirsiniz).
 */
import {hashPassword,MIN_PASSWORD_LENGTH} from './admin-hash-lib.mjs';

function ask(prompt){
 return new Promise((resolve,reject)=>{
  const input=process.stdin;
  process.stderr.write(prompt);
  if(!input.isTTY){
   // Not interactive (piped): read one line. Prefer the interactive prompt; nothing is echoed either way.
   let data='';input.setEncoding('utf8');
   input.on('data',chunk=>{data+=chunk;});
   input.on('end',()=>{process.stderr.write('\n');resolve(data.split(/\r?\n/)[0]||'');});
   input.on('error',reject);return;
  }
  let value='';input.setRawMode(true);input.resume();input.setEncoding('utf8');
  const done=result=>{input.setRawMode(false);input.pause();input.removeListener('data',onData);process.stderr.write('\n');result();};
  function onData(chunk){
   for(const ch of chunk){
    if(ch==='\u0003'){done(()=>reject(new Error('İptal edildi.')));return;}
    if(ch==='\r'||ch==='\n'||ch==='\u0004'){done(()=>resolve(value));return;}
    if(ch==='\u007f'||ch==='\b'){value=value.slice(0,-1);continue;}
    if(ch>=' ')value+=ch;
   }
  }
  input.on('data',onData);
 });
}

try{
 const first=await ask(`Panel şifresi (en az ${MIN_PASSWORD_LENGTH} karakter, görünmez): `);
 if(first.length<MIN_PASSWORD_LENGTH)throw new Error(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`);
 if(process.stdin.isTTY){const second=await ask('Şifreyi yeniden yazın: ');if(second!==first)throw new Error('Şifreler aynı değil.');}
 process.stdout.write(await hashPassword(first)+'\n');
}catch(error){process.stderr.write(`${error instanceof Error?error.message:'Özet üretilemedi.'}\n`);process.exit(1);}
